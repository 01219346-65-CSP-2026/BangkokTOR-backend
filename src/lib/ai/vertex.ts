import type { Grader } from "./types.ts";

// Placeholder for the intended production grader. It exists now so the port is
// shaped by two implementations rather than one, and so switching is an env
// change instead of a refactor.
//
// When this is built, the pieces that must survive from ollama.ts are the two
// measured ones: a bounded evidence length, and a prompt that DEFINES each rule
// rather than naming it. Both were failure modes found by measurement, and
// neither is model-specific.
export function createVertexGrader(): Grader {
  return {
    id: "vertex:unconfigured",
    async gradeChunks() {
      throw new Error(
        "AI_PROVIDER=vertex is not implemented yet — set AI_PROVIDER=ollama, or build src/lib/ai/vertex.ts",
      );
    },
  };
}
