import { sanitizeBullets } from "../../lib/ai/summaryGuard.ts";
import { ruleByCode } from "../../lib/grade/rules.ts";
import type { IngestDocumentLean } from "../ingest/document.model.ts";
import type { TorChunkLean } from "../extract/chunk.model.ts";
import type { TorLean } from "./tor.model.ts";

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

export type PublicTor = Omit<
  TorLean,
  (typeof PRIVATE_GRADE_FIELDS)[number] | "_id" | "__v"
> & {
  id: string;
  signalCount: number;
  signals: PublicSignal[];
};

export type PublicTorDocument = {
  id: string;
  kind: "announcement" | "tor" | "bundle";
  filename: string | null;
  url: string;
  textLayer: "digital" | "scanned" | "unreadable" | "missing";
  pages: number;
  fetchedAt: string | null;
};

/**
 * One summary point, with the page it came from.
 *
 * This replaced `extractedSections`, which shipped the raw PDF chunks — up to
 * 24 of them at ~6,000 characters. The PDF is linked from `documents`, so a
 * reader who wants the source text has it; what the record owes them here is
 * the gist. It also takes a ~144 KB worst case off the detail response.
 *
 * `filename` is null when the bullet's chunk can no longer be resolved, which
 * happens if chunks were re-extracted after the summary was written. The point
 * is still true, it just cannot be cited.
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
    ...rest
  } = tor as TorLean & Record<string, unknown>;

  const fired = (ruleFindings ?? []).filter((f) => f.fired);

  return {
    ...(rest as Omit<TorLean, (typeof PRIVATE_GRADE_FIELDS)[number] | "_id">),
    id: String(_id),
    signalCount: fired.length,
    signals: fired
      .map((f) => toSignal(f.code ?? ""))
      .filter((s): s is PublicSignal => s !== null),
  };
}

/**
 * Detail-only content: the documents, and the summary points read off them.
 *
 * `chunks` is still a parameter even though no chunk text is emitted — it is
 * how a bullet's chunkIndex resolves to a filename and page range, which is
 * what makes a generated point checkable against the source.
 */
export function serializeDetail(
  tor: TorLean,
  documents: IngestDocumentLean[],
  chunks: TorChunkLean[],
): PublicTorDetail {
  const pagesByDocument = new Map<string, number>();
  for (const chunk of chunks) {
    const current = pagesByDocument.get(String(chunk.documentId)) ?? 0;
    pagesByDocument.set(String(chunk.documentId), Math.max(current, chunk.pageEnd));
  }

  const chunkByIndex = new Map(chunks.map((chunk) => [chunk.index, chunk]));

  return {
    ...serialize(tor),
    documents: documents.map((document) => ({
      id: String(document._id),
      kind: document.kind,
      filename: document.filename ?? null,
      url: document.url,
      textLayer: document.textLayer ?? "missing",
      pages: pagesByDocument.get(String(document._id)) ?? 0,
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
        text: bullet.text ?? "",
        chunkIndex: bullet.chunkIndex ?? -1,
      })),
    ).map((bullet, position) => {
      const chunk = chunkByIndex.get(bullet.chunkIndex);
      return {
        // Bullets carry no _id of their own (_id: false on the subdocument),
        // so the id is positional — stable for a given stored summary, which
        // is all a React key needs.
        id: `${String(tor._id)}-s${position}`,
        text: bullet.text,
        filename: chunk?.filename ?? null,
        pageStart: chunk?.pageStart ?? 0,
        pageEnd: chunk?.pageEnd ?? 0,
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
      chunkIndex: f.chunkIndex,
    })),
  };
}
