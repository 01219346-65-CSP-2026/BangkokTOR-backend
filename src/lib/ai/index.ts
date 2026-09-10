import { env } from "../../config/env.ts";
import { createOllamaGrader } from "./ollama.ts";
import { createVertexGrader } from "./vertex.ts";
import type { Grader } from "./types.ts";

export * from "./types.ts";
export { routeChunks, unroutedRules, MAX_CHUNKS_PER_RULE } from "./route.ts";

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
