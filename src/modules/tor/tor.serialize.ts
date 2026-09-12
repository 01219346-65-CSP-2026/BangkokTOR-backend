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

export type PublicTorSection = {
  id: string;
  heading: string;
  text: string;
  filename: string;
  pageStart: number;
  pageEnd: number;
};

export type PublicTorDetail = PublicTor & {
  documents: PublicTorDocument[];
  extractedSections: PublicTorSection[];
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
 * Clean a PDF chunk for display without destroying its shape.
 *
 * The previous version collapsed every run of whitespace — newlines included —
 * into single spaces and then cut at 360 characters. That produced one
 * unbroken wall of Thai text ending mid-word, which is what made the detail
 * page's document section unreadable.
 *
 * Instead: collapse the spaces and single line breaks that PDF extraction
 * introduces mid-sentence, but keep blank lines, because those are the only
 * paragraph boundaries the source gives us. No truncation — a detail response
 * is allowed to be large (at most 24 chunks, capped in lib/extract/chunk.ts),
 * and a half-sentence is worse than a long one.
 */
function tidyChunkText(raw: string): string {
  return (
    raw
      // Normalise line endings first so the paragraph rule below sees \n only.
      .replace(/\r\n?/g, "\n")
      // Split on blank lines — the only paragraph boundary the PDF gives us.
      .split(/\n[ \t]*\n\s*/)
      // Within a paragraph every remaining break is soft wrapping from the page
      // layout rather than meaning, so it collapses to a single space.
      .map((paragraph) => paragraph.replace(/[ \t\n]+/g, " ").trim())
      .filter((paragraph) => paragraph.length > 0)
      .join("\n\n")
  );
}

/** Detail-only document content. It exposes the extracted reading material,
 * never the worker's local paths or the private grading evidence. */
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
    extractedSections: chunks.map((chunk) => ({
      id: String(chunk._id),
      heading: chunk.headingPath.length > 0
        ? chunk.headingPath.join(" / ")
        : chunk.filename,
      text: tidyChunkText(chunk.text),
      filename: chunk.filename,
      pageStart: chunk.pageStart,
      pageEnd: chunk.pageEnd,
    })),
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
