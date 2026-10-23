import { env } from "../../config/env.ts";
import type { FileSpan } from "../extract/fulltext.ts";
import { isDescriptive } from "./summaryGuard.ts";
import { type SummaryBullet, type Summarizer, MAX_POINTS_PER_SECTION, MAX_BULLET_CHARS, SUMMARY_SECTIONS } from "./types.ts";
import { callGemini } from "./vertex.ts";

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
  const points = {
    type: "ARRAY",
    maxItems: MAX_POINTS_PER_SECTION,
    items: {
      type: "OBJECT",
      properties: {
        text: {
          type: "STRING",
          maxLength: MAX_BULLET_CHARS,
        },
        filename: {
          type: "STRING",
          enum: filenames,
        },
      },
      required: ["text", "filename"],
    },
  };

  return {
    type: "OBJECT",
    properties: Object.fromEntries(
      SUMMARY_SECTIONS.map((section) => [section, points]),
    ),
    required: [...SUMMARY_SECTIONS],
  };
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
  return `You are reading a Thai government procurement document.

  Return a JSON object with exactly these three keys:

  - objective: the purpose of the procurement — why the agency is buying or commissioning the work.
  - scope: the scope of work — what the successful bidder must deliver, perform, or provide.
  - qualifications: bidder qualifications — who is allowed to submit an offer and what qualifications or evidence they must have.

  Each key must contain an array of points, with at most ${MAX_POINTS_PER_SECTION} points per topic. If the document does not state anything for a topic, return an empty list for that key. Never invent a point.

  Rules:
  - Describe only what the document states; never evaluate it.
  - Do not say that any condition is fair, unfair, reasonable, unreasonable, restrictive, or suspicious.
  - Do not infer or describe the agency's intent beyond what the document explicitly states.
  - Do not give advice, recommendations, or instructions to the reader.

  Write each point in Thai, using one sentence per point and no more than ${MAX_BULLET_CHARS} characters. Preserve concrete figures, prices, percentages, dates, deadlines, durations, quantities, and other measurable details.

  For every point, include the filename of the source PDF. Use the filename from the corresponding "=== FILE: ... ===" line in the document. Do not invent filenames.

  The document may contain multiple files. Read the entire document before sorting points into objective, scope, and qualifications.

  DOCUMENT:
  ${text}
  `;
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
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return [];
  }

  const answer = raw as Record<string, unknown>;
  const validFilenames = new Set(files.map((file) => file.filename));
  const bullets: SummaryBullet[] = [];

  for (const section of SUMMARY_SECTIONS) {
    const points = answer[section];

    // A missing topic or a topic with the wrong shape contributes nothing.
    if (!Array.isArray(points)) continue;

    let acceptedForSection = 0;

    for (const point of points) {
      if (acceptedForSection >= MAX_POINTS_PER_SECTION) break;

      if (point === null || typeof point !== "object" || Array.isArray(point)) {
        continue;
      }

      const item = point as Record<string, unknown>;

      if (typeof item.text !== "string") continue;

      const text = item.text.trim();
      if (!text) continue;
      if (!isDescriptive(text)) continue;

      const filename =
        typeof item.filename === "string" && validFilenames.has(item.filename)
          ? item.filename
          : null;

      bullets.push({
        section,
        text,
        filename,
      });

      acceptedForSection++;
    }
  }

  return bullets;
}

/**
 * id: `vertex:${env.vertexModel}`
 * summarize({ text, files }): empty text → [] without calling Gemini;
 * otherwise ONE callGemini with buildSummaryPrompt + summarySchema(filenames),
 * then parseSummary. Timeout with env.aiTimeoutMs, like the grader.
 */
export function createVertexSummarizer(): Summarizer {
  //throw new Error("TODO(feat/92): createVertexSummarizer — see LEARNING.md step 4");
  return {
    id: `vertex:${env.vertexModel}`,

    async summarize(input) {
      if (!input.text.trim()) return [];

      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        env.aiTimeoutMs,
      );

      try {
        const raw = await callGemini({
          prompt: buildSummaryPrompt(input.text),
          schema: summarySchema(input.files.map((file) => file.filename)),
          signal: controller.signal,
        });

        return parseSummary(raw, input.files);
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
