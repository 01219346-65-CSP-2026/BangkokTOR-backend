import { Schema, model, type HydratedDocument, type InferSchemaType, type Types } from "mongoose";
import { WORK_TYPES } from "../../lib/classify/workType.ts";
import { BIDDING_STAGES } from "../../lib/sources/egp/procurement.ts";

// The canonical TOR document (§4.3). Money is THB integers, dates are CE —
// both converted at the adapter edge, never here.

// Mirrors ../BangkokTOR-frontend/src/types/tor.ts — a contract to satisfy, not
// a vocabulary to invent. The mapping tables live in lib/classify.
export const TOR_CATEGORIES = [
  "medical", "it", "office", "agriculture", "electrical", "education",
  "equipment", "construction", "dataEntry", "inspection", "services",
  "lease", "other",
] as const;
export const TOR_CONTRACTS = ["purchase", "hire", "construction", "lease"] as const;
export const TOR_METHODS = ["eBidding", "specific", "competitive"] as const;
// `bestMatch` needs the caller's skills (ListInput.skills); without them it
// falls back to `closingSoon`, the default — see tor.service.ts listTors.
export const TOR_SORTS = ["closingSoon", "newest", "oldest", "budgetHigh", "budgetLow", "bestMatch"] as const;
export const SKILL_TAG_SOURCES = ["keyword", "llm"] as const;
export const TOR_STATUS_IDS = [
  "inProgress", "contracted", "deliveredOnTime", "deliveredComplete", "contractEnded",
] as const;

export const TOR_GRADES = ["A", "B", "C"] as const;
export const GRADE_PHASES = ["legitimacy", "fairness"] as const;
/** Bump when weights or prompts change — see graderVersion on the schema. */
export const GRADER_VERSION = 1;
/** Bump when the summary prompt or the FR-19 screen changes, so stale bullets
 *  are findable. Separate from GRADER_VERSION: the prompt can be reworded
 *  without the rulebook moving, and vice versa. */
export const SUMMARY_VERSION = 1;

export const TOR_STATUSES = [
  "discovered",
  "documents_fetched",
  "extraction_pending",
  "extraction_incomplete",
  "graded",
  // Reserved for an editorial promotion step that does not exist yet: nothing
  // writes this, and listTors reads it so the day it lands needs no migration.
  "published",
] as const;
export type TorStatus = (typeof TOR_STATUSES)[number];

const torSchema = new Schema(
  {
    sourceId: { type: String, required: true },
    projectId: { type: String, required: true },

    projectName: { type: String, required: true, trim: true },
    agency: { type: String, default: "", trim: true },
    department: { type: String, default: null },

    budget: { type: Number, default: null, min: 0 },
    averageBudget: { type: Number, default: null, min: 0 },

    procurementMethod: { type: String, default: null },
    procurementType: { type: String, default: null },
    goodsCategory: { type: String, default: null },
    projectStatus: { type: String, default: null },

    fiscalYear: { type: Number, default: null },
    announcedAt: { type: Date, default: null },

    province: { type: String, default: null },
    district: { type: String, default: null },
    subdistrict: { type: String, default: null },
    location: {
      type: { type: String, enum: ["Point"], default: undefined },
      coordinates: { type: [Number], default: undefined },
    },

    winnerName: { type: String, default: null },
    winnerTaxId: { type: String, default: null },
    contractNumber: { type: String, default: null },
    contractSignedAt: { type: Date, default: null },
    contractEndsAt: { type: Date, default: null },

    // ── Bidding (modules/bidding). Where the project stands in e-GP's flow,
    // and the bid deadline read out of its ประกาศเชิญชวน. Null until checked;
    // a null deadline means "not published yet" or "could not be read", never
    // a guess (FR-13). See AGENTS.md §3 for where each comes from.
    bmaProjectId: { type: String, default: null },
    // Keep this TOR's stage and deadline current (refreshBidding). Set for
    // tenders seen while biddable — BMA rows and e-GP captures — not for the
    // awarded national history, which has nothing left to move.
    trackBidding: { type: Boolean, default: false },
    biddingStage: { type: String, enum: [...BIDDING_STAGES, null], default: null },
    // e-GP's own step name, kept so a stage can be audited, not trusted.
    stageFlowName: { type: String, default: null },
    stageCheckedAt: { type: Date, default: null },
    bidOpensAt: { type: Date, default: null },
    bidClosesAt: { type: Date, default: null },
    deadlineEvidence: {
      type: new Schema(
        {
          // The sentence the date was read from, verbatim.
          quote: { type: String, default: "" },
          // The ประกาศเชิญชวน PDF on the source portal.
          documentUrl: { type: String, default: "" },
          publishedAt: { type: Date, default: null },
        },
        { _id: false },
      ),
      default: null,
    },

    category: { type: String, enum: TOR_CATEGORIES, default: null },
    contractType: { type: String, enum: TOR_CONTRACTS, default: null },
    methodId: { type: String, enum: TOR_METHODS, default: null },
    statusId: { type: String, enum: TOR_STATUS_IDS, default: null },

    // Null, not false, until the classifier has actually run — false would
    // claim a judgement nothing has made.
    isSoftware: { type: Boolean, default: null },
    softwareScore: { type: Number, default: null },
    softwareConfidence: { type: Number, default: null },
    // The rules that fired, kept so a verdict can be audited rather than trusted.
    softwareSignals: {
      type: [{ _id: false, rule: String, weight: Number }],
      default: [],
    },
    // What kind of software work (lib/classify/workType.ts) — the หมวดหมู่
    // filter. Multi-label; ["other"] when nothing matched, never empty once
    // classified. The terms that fired are kept for audit, like softwareSignals.
    workTypes: { type: [{ type: String, enum: WORK_TYPES }], default: [] },
    workTypeSignals: {
      type: [{ _id: false, type: { type: String }, term: String }],
      default: [],
    },
    classifiedAt: { type: Date, default: null },
    classifierVersion: { type: Number, default: null },

    // FR-18/19. The detector is not built; the field is present and honest that
    // nothing was checked. Advisory vocabulary only, never accusatory — zero
    // signals is a result to report, not an empty field.
    signalCount: { type: Number, default: 0 },
    legitimacySignals: { type: [String], default: [] },
    legitimacyCheckedAt: { type: Date, default: null },

    // ── Grading (steps 5-7). Stored in full; the public API never emits it.
    // AGENTS.md 1 / FR-19 forbids an accusatory shape, and "Grade C" on a named
    // agency is exactly that. tor.service.ts serialize() is the gate.
    grade: { type: String, enum: TOR_GRADES, default: null },
    gradeScore: { type: Number, default: null },
    gradePhaseFailed: { type: String, enum: GRADE_PHASES, default: null },
    // One entry per rule in the rulebook, including the ones that did NOT fire
    // and the ones nothing checked — a grade is only auditable if the misses
    // are recorded too.
    ruleFindings: {
      type: [
        {
          _id: false,
          code: String,
          fired: Boolean,
          weight: Number,
          phase: String,
          // Verbatim quote from the document. Enforced at write time: a fired
          // finding without one is rejected, not stored.
          evidence: { type: String, default: "" },
          checked: { type: Boolean, default: true },
        },
      ],
      default: [],
    },
    gradedAt: { type: Date, default: null },
    // Bump when weights or prompts change, so stale grades are findable.
    graderVersion: { type: Number, default: null },
    // Which model produced this, e.g. "ollama:qwen2.5:7b". When Vertex replaces
    // Ollama this is how you know which rows to regrade.
    graderModel: { type: String, default: null },

    // ── Summary (step 8). Unlike the grade, this IS public — it is what the
    // detail page shows as the gist of the documents.
    //
    // Which is why it is the one piece of model output that has to be built
    // incapable of accusing anyone: a bullet is generated prose about a named
    // government agency. lib/ai/summaryGuard.ts screens it, and the screen runs
    // twice — once leaving the model, once before this field is written.
    summaryBullets: {
      type: [
        {
          _id: false,
          text: String,
        },
      ],
      default: [],
    },
    summarizedAt: { type: Date, default: null },
    summaryVersion: { type: Number, default: null },
    summaryModel: { type: String, default: null },

    // ── Required skills, in the profile vocabulary's slugs (techstack.vocabulary.ts).
    // What best-match sorting scores a reader's profile against. Written by
    // lib/skills/tagSkills.ts (`keyword`); an LLM pass may add `llm` entries
    // later, and each writer only ever replaces its own source's entries.
    // Public: a skill requirement says nothing about the agency (FR-19).
    requiredSkills: {
      type: [
        {
          _id: false,
          slug: { type: String, required: true },
          source: { type: String, enum: SKILL_TAG_SOURCES, required: true },
          // Verbatim window around the hit, so a tag can be checked, not trusted.
          evidence: { type: String, default: "" },
        },
      ],
      default: [],
    },
    skillsTaggedAt: { type: Date, default: null },
    skillTaggerVersion: { type: Number, default: null },

    status: { type: String, enum: TOR_STATUSES, default: "discovered", required: true },
    statusReason: { type: String, default: null },

    // Provenance (§4.5). A TOR that can't be traced back isn't publishable.
    sourceUrl: { type: String, default: "" },
    fetchedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false, collection: "tors" },
);

torSchema.index({ sourceId: 1, projectId: 1 }, { unique: true });
torSchema.index({ agency: 1 });
torSchema.index({ announcedAt: -1 });
torSchema.index({ budget: -1 });
torSchema.index({ status: 1, isSoftware: 1 });
// The dashboard's main filter: software tenders, by category.
torSchema.index({ category: 1, isSoftware: 1 });
// Finding rows to (re)grade: ungraded ones, and ones graded by an old version.
torSchema.index({ status: 1, graderVersion: 1 });
// The public list (tor.service.ts listTors) filters on status and sorts by
// announcedAt on every request. With only the separate {status,isSoftware} and
// {announcedAt:-1} indexes, Mongo can use one or the other — so it either
// scanned, or sorted every matching TOR in memory and risked the 32MB sort
// limit as the corpus grows. This compound serves filter, sort and pagination
// as one index range scan.
torSchema.index({ status: 1, announcedAt: -1 });
// The public scope (tor.service.ts publicScope) puts software + fiscal year in
// front of every listing, so the listing index has to start with them.
torSchema.index({ isSoftware: 1, fiscalYear: 1, status: 1, announcedAt: -1 });
torSchema.index({ projectStatus: 1 });
// The default listing: what is open, soonest deadline first.
torSchema.index({ biddingStage: 1, bidClosesAt: 1 });
torSchema.index({ workTypes: 1 });
// Best-match scoring reads requiredSkills.slug; the backfill finds stale tags.
torSchema.index({ "requiredSkills.slug": 1 });
torSchema.index({ skillTaggerVersion: 1 });

export type Tor = InferSchemaType<typeof torSchema>;
export type TorDoc = HydratedDocument<Tor>;
export type TorLean = Tor & { _id: Types.ObjectId };

export const TorModel = model<Tor>("Tor", torSchema);
