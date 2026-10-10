import { env } from "../../config/env.ts";
import type { FileSpan } from "../extract/fulltext.ts";
import type { SummaryBullet, Summarizer } from "./types.ts";

// ============================================================================
// The TOR summary on Vertex AI — YOU write this file (feat/92). See LEARNING.md.
// ============================================================================
//
// One Gemini call reads the whole TOR text and returns short Thai points under
// THREE topics — the three cards on the TOR detail page — each point tagged
// with the PDF it came from:
//
//   {
//     objective:      [ { text: "เพื่อจัดหาระบบ ...", filename: "doc_1.pdf" } ],
//     scope:          [ { text: "ต่ออายุสิทธิ์การใช้งาน UiPath จำนวน 6 ไลเซนส์", filename: ... } ],
//     qualifications: [ { text: "มีผลงานประเภทเดียวกันไม่น้อยกว่า 1,800,000 บาท", filename: ... } ],
//   }
//
// parseSummary flattens that into SummaryBullet[], each with its `section`.
// A topic the document doesn't state is an EMPTY list — the card then says
// so — never an invented point.
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
 * The answer shape: an OBJECT with one ARRAY per topic, keys from
 * SUMMARY_SECTIONS (in that order), all three `required`.
 *   - each array: at most MAX_POINTS_PER_SECTION items
 *   - each item: { text, filename }, both required
 *   - text: at most MAX_BULLET_CHARS characters
 *   - filename: an enum of `filenames`, so the model can only name real files
 * Hint: build the array schema once, then
 * Object.fromEntries(SUMMARY_SECTIONS.map((s) => [s, points])).
 */
export function summarySchema(filenames: string[]): Record<string, unknown> {
  throw new Error("TODO(feat/92): summarySchema — see LEARNING.md step 3");
}

/**
 * The instructions + the whole text. Must tell the model to:
 *   - sort its points into the three topics, named by their schema keys
 *     (objective / scope / qualifications), and say what each one means
 *   - at most MAX_POINTS_PER_SECTION per topic; a topic the document doesn't
 *     state → an empty list, never an invented point
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
 *   - `raw` not an object → []
 *   - walk SUMMARY_SECTIONS in order (so the output is in page order, whatever
 *     order the JSON came in); a key that isn't an array is skipped; any other
 *     key is ignored
 *   - skip items whose text is not a string, or is blank after trim()
 *   - skip items that fail isDescriptive (summaryGuard.ts)
 *   - filename not one of `files` → null (keep the bullet, lose the citation)
 *   - stop at MAX_POINTS_PER_SECTION per topic
 *   - each bullet: { section, text, filename }
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
