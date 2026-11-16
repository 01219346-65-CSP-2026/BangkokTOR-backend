import { afterEach, expect, mock, test } from "bun:test";
import { EgpFieldError, listDocuments } from "./documents.ts";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

test("rejects an upstream ZIP identifier that is not 32 hexadecimal characters", async () => {
  globalThis.fetch = mock(async () =>
    new Response(
      JSON.stringify({
        response: { responseCode: "0" },
        data: { zipId: "../x" },
      }),
      { status: 200 },
    ),
  ) as unknown as typeof fetch;

  await expect(listDocuments("project-1")).rejects.toBeInstanceOf(EgpFieldError);
});
