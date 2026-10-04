import { afterAll, expect, test } from "bun:test";
import { politeFetch } from "./politeClient.ts";

// A local server that rate-limits the first request (Retry-After: 1) and then
// answers. politeFetch must wait it out, not fail the way it did on e-GP.
let hits = 0;
const server = Bun.serve({
  port: 0,
  fetch() {
    hits++;
    return hits === 1
      ? new Response("Rate limit exceeded. Try again later.", { status: 429, headers: { "Retry-After": "1" } })
      : new Response("ok");
  },
});
afterAll(() => server.stop(true));

test("a 429 is waited out (Retry-After), and the request then succeeds", async () => {
  const started = Date.now();
  const response = await politeFetch(`http://localhost:${server.port}/x`, {}, { delayMs: 10, maxAttempts: 2 });
  expect(await response.text()).toBe("ok");
  expect(hits).toBe(2);
  expect(Date.now() - started).toBeGreaterThanOrEqual(900);
});
