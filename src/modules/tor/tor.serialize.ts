import { sanitizeBullets } from "../../lib/ai/summaryGuard.ts";
import { ruleByCode } from "../../lib/grade/rules.ts";
import type { IngestDocumentLean } from "../ingest/document.model.ts";
import type { TorLean } from "./tor.model.ts";
import type { TorTextLean } from "../extract/torText.model.ts";
import { biddingStatus, procurementStage, type BiddingStatus } from "./tor.bidding.ts";
import type { BiddingStage } from "../../lib/sources/egp/procurement.ts";
import { egpListingUrl, isLegacyEgpUrl, SOURCE_ID as CKAN_SOURCE_ID } from "../../lib/sources/ckan/normalize.ts";

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

/** Fields that must never reach a guest response. */
const PRIVATE_GRADE_FIELDS = [
  "grade",
  "gradeScore",
  "gradePhaseFailed",
  "ruleFindings",
  "graderVersion",
  "graderModel",
  // Not private, but not raw either. serializeDetail re-publishes these as
  // `summaryPoints` after screening them and attaching a page citation.
  // Leaving the stored field in `...rest` shipped the unscreened text straight
  // past the gate — caught by tor.serialize.test.ts, which is what that test
  // is for.
  "summaryBullets",
  "summarizedAt",
  "summaryVersion",
  "summaryModel",
] as const;

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

export type PublicTor = Omit<
  TorLean,
  (typeof PRIVATE_GRADE_FIELDS)[number] | "_id" | "__v" | "requiredSkills" | "skillTaggerVersion"
> & {
  id: string;
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

/** Guest/public shape. Strips the grade entirely and emits neutral signals. */
export function serialize(tor: TorLean): PublicTor {
  const {
    _id,
    grade: _grade,
    gradeScore: _gradeScore,
    gradePhaseFailed: _phase,
    ruleFindings,
    graderVersion: _gv,
    graderModel: _gm,
    summaryBullets: _bullets,
    summarizedAt: _summarizedAt,
    summaryVersion: _sv,
    summaryModel: _sm,
    requiredSkills,
    skillTaggerVersion: _stv,
    ...rest
  } = tor as TorLean & Record<string, unknown>;

  const fired = (ruleFindings ?? []).filter((f) => f.fired);

  return {
    ...(rest as Omit<PublicTor, "id" | "signalCount" | "signals" | "requiredSkills" | "biddingStatus" | "stage">),
    id: String(_id),
    biddingStatus: biddingStatus(tor),
    stage: procurementStage(tor),
    sourceUrl: publicSourceUrl(tor),
    requiredSkills: (requiredSkills ?? []).map((s) => ({ slug: s.slug, evidence: s.evidence ?? "" })),
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
      (tor.summaryBullets ?? []).map((bullet) => ({ text: bullet.text ?? "" })),
    ).map((bullet, position) => {
      return {
        // Bullets carry no _id of their own (_id: false on the subdocument),
        // so the id is positional — stable for a given stored summary, which
        // is all a React key needs.
        id: `${String(tor._id)}-s${position}`,
        text: bullet.text,
        filename: null,
        pageStart: 0,
        pageEnd: 0,
      };
    }),
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
    })),
  };
}
