import { env } from "../../config/env.ts";
import type { FileSpan } from "../extract/fulltext.ts";
import type { SummaryBullet, Summarizer } from "./types.ts";

// ============================================================================
// The TOR summary on Vertex AI — YOU write this file (feat/92). See LEARNING.md.
// ============================================================================
//
// One Gemini call reads the whole TOR text and returns up to MAX_BULLETS short
// Thai points, each tagged with the PDF it came from:
//
//   { points: [ { text: "วางหลักประกันการเสนอราคา ๔๖,๐๘๕,๓๔๕ บาท",
//                 filename: "doc_0701800000_68029483879.pdf" }, ... ] }
//
// Unlike a grade, these bullets are PUBLIC and written by the AI about a named
// government agency. FR-19: they must DESCRIBE the document, never JUDGE it.
// Three layers protect that: the prompt forbids judgement, parseSummary drops
// anything judgemental (isDescriptive in summaryGuard.ts), and grade.service
// screens again before saving (sanitizeBullets).
//
// The spec is src/lib/ai/vertexSummary.test.ts:
//     bun test src/lib/ai/vertexSummary.test.ts
//
// Reuse callGemini from ./vertex.ts (you wrote it in feat/91).
// ============================================================================

/**
 * The answer shape: { points: [{ text, filename }] }.
 *   - points: at most MAX_BULLETS items
 *   - text: at most MAX_BULLET_CHARS characters
 *   - filename: an enum of `filenames`, so the model can only name real files
 */
export function summarySchema(filenames: string[]): Record<string, unknown> {
  throw new Error("TODO(feat/92): summarySchema — see LEARNING.md step 3");
}

/**
 * The instructions + the whole text. Must tell the model to:
 *   - list up to MAX_BULLETS points of what the document requires/specifies
 *   - describe only — never evaluate; never say whether something is fair,
 *     restrictive or suspicious; no guessing intent; no advice
 *   - write in Thai, one sentence each, at most MAX_BULLET_CHARS characters
 *   - keep concrete figures, deadlines, quantities
 *   - give the filename (from the "=== FILE" line) each point comes from
 */
export function buildSummaryPrompt(text: string): string {
  throw new Error("TODO(feat/92): buildSummaryPrompt — see LEARNING.md step 3");
}

/**
 * Turn Gemini's raw answer into bullets. Never trust it:
 *   - `raw.points` not an array → []
 *   - skip items whose text is not a string, or is blank after trim()
 *   - skip items that fail isDescriptive (summaryGuard.ts)
 *   - filename not one of `files` → null (keep the bullet, lose the citation)
 *   - stop at MAX_BULLETS
 */
export function parseSummary(raw: unknown, files: FileSpan[]): SummaryBullet[] {
  throw new Error("TODO(feat/92): parseSummary — see LEARNING.md step 3");
}

/**
 * id: `vertex:${env.vertexModel}`
 * summarize({ text, files }): empty text → [] without calling Gemini;
 * otherwise ONE callGemini with buildSummaryPrompt + summarySchema(filenames),
 * then parseSummary. Timeout with env.aiTimeoutMs, like the grader.
 */
export function createVertexSummarizer(): Summarizer {
  throw new Error("TODO(feat/92): createVertexSummarizer — see LEARNING.md step 4");
}
