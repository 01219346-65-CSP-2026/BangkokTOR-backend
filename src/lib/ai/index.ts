import { env } from "../../config/env.ts";
import { createVertexGrader } from "./vertex.ts";
import type { Grader, Summarizer } from "./types.ts";
import { createVertexSummarizer } from "./vertexSummary.ts";

export * from "./types.ts";
export { isDescriptive, sanitizeBullets } from "./summaryGuard.ts";

/** The one place a provider is chosen. Callers depend on Grader, never on a
 *  concrete client — that is what makes the Vertex swap an env change. */
export function createGrader(): Grader {
  return createVertexGrader();
}

/** Same contract as createGrader, for the other port. Kept separate so a
 *  provider can implement one capability without stubbing the other. */
export function createSummarizer(): Summarizer {
  return createVertexSummarizer();
}
