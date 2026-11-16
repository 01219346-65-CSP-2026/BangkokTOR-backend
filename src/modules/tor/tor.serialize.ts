import { sanitizeBullets } from "../../lib/ai/summaryGuard.ts";
import { ruleByCode, type RulePhase } from "../../lib/grade/rules.ts";
import type { IngestDocumentLean } from "../ingest/document.model.ts";
import type { TorLean } from "./tor.model.ts";
import type { TorTextLean } from "../extract/torText.model.ts";
import { biddingStatus, procurementStage, type BiddingStatus } from "./tor.bidding.ts";
import type { BiddingStage } from "../../lib/sources/egp/procurement.ts";
import { egpListingUrl, isLegacyEgpUrl, SOURCE_ID as CKAN_SOURCE_ID } from "../../lib/sources/ckan/normalize.ts";
import type { SummarySection } from "../../lib/ai/types.ts";

// THE FR-19 GATE.
//
// AGENTS.md 1: legitimacy signals are advisory, never accusatory. A public
// "Grade C - Legitimacy Failed" on a named government agency is precisely the
// shape that forbids. The grade IS computed and stored (auditability), but the
// public surface carries only neutral observations.
//
// The frontend already defines the compliant vocabulary in
// ../BangkokTOR-frontend/src/lib/torSignals.ts: {id, tone, titleKey, bodyKey}
// with a notable/routine split. Backend findings JOIN notable; they do not
// replace it.
//
// If you add a field here, ask whether a client could render it as an
// accusation. If it could, it does not belong in this function.

/**
 * The ONLY TorLean fields a guest response copies verbatim (T09, FR-19).
 *
 * An allowlist, not a denylist: a field added to the schema is private until
 * someone names it here. The old shape stripped a list of grade fields and
 * spread the remainder, so every new field shipped publicly by default — one raw
 * grade letter or red-flag quote away from accusing an agency.
 *
 * Deliberately absent: grade, gradeScore, gradePhaseFailed, ruleFindings,
 * graderVersion, graderModel (the grade — serializeGrade, admin only);
 * summaryBullets and summary* bookkeeping (re-published as screened
 * `summaryPoints` by serializeDetail); requiredSkills (re-shaped below) and
 * skillTaggerVersion; _id (becomes `id`).
 *
 * Before adding a field, ask whether a client could render it as an
 * accusation. If it could, it does not belong here.
 */
export const PUBLIC_TOR_FIELDS = [
  "sourceId",
  "projectId",
  "projectName",
  "agency",
  "department",
  "budget",
  "averageBudget",
  "procurementMethod",
  "procurementType",
  "goodsCategory",
  "projectStatus",
  "fiscalYear",
  "announcedAt",
  "province",
  "district",
  "subdistrict",
  "location",
  "winnerName",
  "winnerTaxId",
  "contractNumber",
  "contractSignedAt",
  "contractEndsAt",
  "bmaProjectId",
  "trackBidding",
  "biddingStage",
  "stageFlowName",
  "stageCheckedAt",
  "bidOpensAt",
  "bidClosesAt",
  "deadlineEvidence",
  "category",
  "contractType",
  "methodId",
  "statusId",
  "isSoftware",
  "softwareScore",
  "softwareConfidence",
  "softwareSignals",
  "workTypes",
  "workTypeSignals",
  "classifiedAt",
  "classifierVersion",
  "legitimacySignals",
  "legitimacyCheckedAt",
  "gradedAt",
  "skillsTaggedAt",
  "status",
  "statusReason",
  "fetchedAt",
  "createdAt",
  "updatedAt",
] as const satisfies readonly (keyof TorLean)[];

type PublicTorField = (typeof PUBLIC_TOR_FIELDS)[number];

export type PublicSignal = {
  id: string;
  tone: "notable" | "routine";
  titleKey: string;
  bodyKey: string;
};

/** A fired rule becomes an observation about the DOCUMENT, not a claim about
 *  the agency. "This contract does not state a termination clause" is a fact;
 *  "this tender is rigged" is an accusation. Only the first shape is produced. */
function toSignal(code: string): PublicSignal | null {
  const rule = ruleByCode(code);
  if (!rule) return null;
  return {
    id: code.toLowerCase(),
    // Everything from the grader is `notable`; `routine` is the frontend's own.
    tone: "notable",
    titleKey: `signals.${code.toLowerCase()}.title`,
    bodyKey: `signals.${code.toLowerCase()}.body`,
  };
}

/** A skill the TOR asks for, with the quote it was found in. */
export type PublicRequiredSkill = { slug: string; evidence: string };

export type PublicTor = Pick<TorLean, PublicTorField> & {
  id: string;
  sourceUrl: string;
  signalCount: number;
  signals: PublicSignal[];
  requiredSkills: PublicRequiredSkill[];
  /** Open / upcoming / closed, derived on read so it is never stale against
   *  the clock (tor.bidding.ts). The deadline itself is `bidClosesAt`. */
  biddingStatus: BiddingStatus;
  /** สถานะโครงการ: the procurement stage, the same rule the filter uses
   *  (tor.bidding.ts procurementStage). Null when nothing says. */
  stage: BiddingStage | null;
  /** Only on a list request that sent the reader's skills — see listScored. */
  fitScore?: number | null;
  matchedSkillCount?: number;
};

export type PublicTorDocument = {
  id: string;
  kind: "announcement" | "tor" | "bundle" | "extractedPdf";
  filename: string | null;
  /** The source portal's link, except for `extractedPdf`, which is served by
   *  this API at GET /api/tors/:id/documents/:documentId/file. */
  url: string;
  textLayer: "digital" | "scanned" | "unreadable" | "missing";
  pages: number;
  bytes: number | null;
  fetchedAt: string | null;
};

/**
 * One summary point. The PDF is linked from `documents`, so a reader who wants
 * the source text has it; what the record owes them here is the gist.
 *
 * `filename`, `pageStart` and `pageEnd` are kept for the frontend's type and
 * are always null/0 — a point is not cited to a page.
 */
export type PublicTorSummaryPoint = {
  id: string;
  section: SummarySection | null;
  text: string;
  filename: string | null;
  pageStart: number;
  pageEnd: number;
};

export type PublicTorDetail = PublicTor & {
  documents: PublicTorDocument[];
  summaryPoints: PublicTorSummaryPoint[];
};

/**
 * The "open the original" link. e-GP rows ingested before the portal moved
 * still store the retired process3 URL, so rebuild it from the project number
 * on read — cheaper and safer than a migration, and it keeps working if the
 * portal moves again (change egpListingUrl, nothing else).
 */
export function publicSourceUrl(tor: Pick<TorLean, "sourceId" | "projectId" | "sourceUrl">): string {
  if (tor.sourceId === CKAN_SOURCE_ID && tor.projectId && isLegacyEgpUrl(tor.sourceUrl)) {
    return egpListingUrl(tor.projectId);
  }
  return tor.sourceUrl ?? "";
}

/** Guest/public shape. Copies only PUBLIC_TOR_FIELDS, never the grade, and
 *  emits neutral signals in its place. */
export function serialize(tor: TorLean): PublicTor {
  const picked: Partial<Pick<TorLean, PublicTorField>> = {};
  for (const field of PUBLIC_TOR_FIELDS) {
    // Skip absent keys rather than writing `undefined`, so a projected row
    // serializes the same shape the spread used to produce.
    if (Object.hasOwn(tor, field)) {
      (picked as Record<string, unknown>)[field] = tor[field];
    }
  }

  // T16: a finding held for review is not published until an admin resolves it.
  const fired = (tor.ruleFindings ?? []).filter((f) => f.fired && !f.needsReview);

  return {
    ...(picked as Pick<TorLean, PublicTorField>),
    id: String(tor._id),
    biddingStatus: biddingStatus(tor),
    stage: procurementStage(tor),
    sourceUrl: publicSourceUrl(tor),
    requiredSkills: (tor.requiredSkills ?? []).map((s) => ({ slug: s.slug, evidence: s.evidence ?? "" })),
    signalCount: fired.length,
    signals: fired
      .map((f) => toSignal(f.code ?? ""))
      .filter((s): s is PublicSignal => s !== null),
  };
}

/**
 * Detail-only content: the documents, and the summary points read off them.
 */
export function serializeDetail(
  tor: TorLean,
  documents: IngestDocumentLean[],
  torText: TorTextLean | null,
): PublicTorDetail {
  const pagesByDocument = new Map<string, number>();
  if (torText) {
    pagesByDocument.set(
      String(torText.documentId),
      torText.files.reduce((total, file) => total + file.pages, 0),
    );
  }

  return {
    ...serialize(tor),
    documents: documents.map((document) => ({
      id: String(document._id),
      kind: document.kind,
      filename: document.filename ?? null,
      // Our own file route only while the PDF is still on disk. Extraction
      // normally deletes it (extract.service.ts discardFiles), and then the
      // row's url is the e-GP bundle it came from.
      url:
        document.kind === "extractedPdf" && document.localPath
          ? `/api/tors/${String(tor._id)}/documents/${String(document._id)}/file`
          : document.url,
      textLayer: document.textLayer ?? "missing",
      pages: document.pages ?? pagesByDocument.get(String(document._id)) ?? 0,
      bytes: document.bytes ?? null,
      fetchedAt: document.fetchedAt?.toISOString() ?? null,
    })),
    // sanitizeBullets again here, at the last boundary before a reader.
    //
    // It already ran when the model answered and again before the write, so a
    // third pass should be redundant — and that is the point. This function is
    // the FR-19 gate, and a gate that trusts its input is not a gate. Rows
    // written by an older SUMMARY_VERSION, or by a future caller that forgets,
    // are screened here regardless.
    summaryPoints: sanitizeBullets(
      (tor.summaryBullets ?? []).map((bullet) => ({
        section: bullet.section ?? null,
        text: bullet.text ?? "",
        filename: bullet.filename ?? null,
      })),
    ).map((bullet, position) => {
      return {
        // Bullets carry no _id of their own (_id: false on the subdocument),
        // so the id is positional — stable for a given stored summary, which
        // is all a React key needs.
        id: `${String(tor._id)}-s${position}`,
        section: bullet.section,
        text: bullet.text,
        filename: bullet.filename,
        pageStart: 0,
        pageEnd: 0,
      };
    }),
  };
}

/** One rule that fired, for a signed-in reader. `evidence` is null when there is
 *  nothing to quote: the rule fired on something the document does not say. */
export type PublicAdvisoryFinding = {
  code: string;
  evidence: string | null;
  filename: string | null;
};

export type PublicTorAdvisory = {
  /** 1-3, higher means more to check. Null until the TOR has been reviewed, so
   *  "not reviewed" can never read as "nothing found". */
  level: 1 | 2 | 3 | null;
  patternCount: number;
  /** The first phase stopped the review, so the second has no results at all. */
  laterPhaseSkipped: boolean;
  phases: Array<{ phase: RulePhase; findings: PublicAdvisoryFinding[] }>;
};

const ADVISORY_LEVELS = { A: 1, B: 2, C: 3 } as const;
const ADVISORY_PHASES: RulePhase[] = ["legitimacy", "fairness"];

/**
 * FR-20: the fired rules behind the Advisory section, for signed-in readers.
 *
 * This is the one place quotes leave the backend outside the admin route, so the
 * shape stays narrow. The grade becomes a neutral level, never the letter, and
 * the score, weights and grader details stay out. The wording itself is the
 * frontend's: this sends rule codes, not claims.
 */
export function serializeAdvisory(tor: TorLean): PublicTorAdvisory {
  const known = (tor.ruleFindings ?? []).flatMap((finding) => {
    // T16: held findings stay out of the advisory until reviewed.
    const rule = finding.fired && !finding.needsReview ? ruleByCode(finding.code ?? "") : undefined;
    return rule ? [{ rule, finding }] : [];
  });

  return {
    level: tor.grade ? (ADVISORY_LEVELS[tor.grade as keyof typeof ADVISORY_LEVELS] ?? null) : null,
    patternCount: known.length,
    laterPhaseSkipped: tor.gradePhaseFailed === "legitimacy",
    phases: ADVISORY_PHASES.map((phase) => ({
      phase,
      findings: known
        .filter(({ rule }) => rule.phase === phase)
        .map(({ rule, finding }) => ({
          code: rule.code,
          // ABSENCE is the grader's marker, not a quote. Older rows store "".
          evidence: finding.evidence && finding.evidence !== "ABSENCE" ? finding.evidence : null,
          filename: finding.filename ?? null,
        })),
    })).filter((group) => group.findings.length > 0),
  };
}

/** Team/admin shape: the full grade, on its own route behind authorisation. */
export function serializeGrade(tor: TorLean) {
  return {
    id: String(tor._id),
    projectId: tor.projectId,
    grade: tor.grade,
    gradeScore: tor.gradeScore,
    gradePhaseFailed: tor.gradePhaseFailed,
    gradedAt: tor.gradedAt,
    graderModel: tor.graderModel,
    graderVersion: tor.graderVersion,
    findings: (tor.ruleFindings ?? []).map((f) => ({
      code: f.code,
      fired: f.fired,
      weight: f.weight,
      phase: f.phase,
      checked: f.checked,
      evidence: f.evidence,
      filename: f.filename ?? null,
      needsReview: f.needsReview ?? false,
    })),
  };
}
