import { Schema, model, type HydratedDocument, type InferSchemaType, type Types } from "mongoose";

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
export const TOR_STATUS_IDS = [
  "inProgress", "contracted", "deliveredOnTime", "deliveredComplete",
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
  "published",
  "error",
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
          chunkIndex: { type: Number, default: null },
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
    // detail page shows where raw document chunks used to be.
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
          // Which chunk produced it, so the serializer can cite a filename and
          // page range. A point a reader cannot check is worth less.
          chunkIndex: { type: Number, default: null },
        },
      ],
      default: [],
    },
    summarizedAt: { type: Date, default: null },
    summaryVersion: { type: Number, default: null },
    summaryModel: { type: String, default: null },

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

export type Tor = InferSchemaType<typeof torSchema>;
export type TorDoc = HydratedDocument<Tor>;
export type TorLean = Tor & { _id: Types.ObjectId };

export const TorModel = model<Tor>("Tor", torSchema);
