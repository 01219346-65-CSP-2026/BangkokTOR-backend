import { env } from "../../config/env.ts";
import { createOllamaGrader, createOllamaSummarizer } from "./ollama.ts";
import { createVertexGrader, createVertexSummarizer } from "./vertex.ts";
import type { Grader, Summarizer } from "./types.ts";

export * from "./types.ts";
export { routeChunks, unroutedRules, MAX_CHUNKS_PER_RULE } from "./route.ts";
export { isDescriptive, sanitizeBullets } from "./summaryGuard.ts";

/** The one place a provider is chosen. Callers depend on Grader, never on a
 *  concrete client — that is what makes the Vertex swap an env change. */
export function createGrader(): Grader {
  switch (env.aiProvider) {
    case "ollama":
      return createOllamaGrader();
    case "vertex":
      return createVertexGrader();
    default:
      throw new Error(`Unknown AI_PROVIDER: ${env.aiProvider}`);
  }
}

/** Same contract as createGrader, for the other port. Kept separate so a
 *  provider can implement one capability without stubbing the other. */
export function createSummarizer(): Summarizer {
  switch (env.aiProvider) {
    case "ollama":
      return createOllamaSummarizer();
    case "vertex":
      return createVertexSummarizer();
    default:
      throw new Error(`Unknown AI_PROVIDER: ${env.aiProvider}`);
  }
}
