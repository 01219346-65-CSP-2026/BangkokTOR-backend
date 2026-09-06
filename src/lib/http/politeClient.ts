import { env } from "../../config/env.ts";

// The only door out to a government host (NFR-07, §4.5). Never inline a fetch
// or a User-Agent at a call site.

// ─────────────────────────────────────────────────────────────────────────────
// GENERATED — the option bag.
// ─────────────────────────────────────────────────────────────────────────────

export type PoliteOptions = {
  delayMs?: number;
  timeoutMs?: number;
  maxAttempts?: number;
};

// ═════════════════════════════════════════════════════════════════════════════
// CHUNK 1 — the two error classes.
//
// Syntax reminder: a subclass constructor MUST call super(...) before it can
// touch `this`. `readonly` means "set once in the constructor, never reassigned".
//
//   export class Foo extends Error {
//     readonly bar: string;
//     constructor(bar: string) {
//       super(`some message using ${bar}`);
//       this.name = "Foo";
//       this.bar = bar;
//     }
//   }
//
// Write HttpError with: status (number), url (string), body (string),
// retryable (boolean). Truncate body — an HTML error page can be enormous.
// There's a BODY_SNIPPET-style constant's worth of judgement here; pick a size.
//
// YOUR DECISION: what makes `retryable` true? Two status conditions get better
// on their own. Every other 4xx will fail identically forever.
//
// Then NetworkError with: url, cause, and retryable. A timeout or a dropped
// socket has no status code at all. Ask yourself whether its `retryable` is
// even a question, or a constant.
//
// (`this.cause = cause` is valid — Error has a `cause` field built in.)
// ═════════════════════════════════════════════════════════════════════════════
const BODY_SNIPPET = 500;

export class HttpError extends Error {
  readonly status: number;
  readonly url: string;
  readonly body: string;
  readonly retryable: boolean;

  constructor(status: number, url: string, body:string) {
    super(`HTTP ${status} for ${url}`);
    this.name = "HttpError";
    this.status = status;
    this.url = url;
    this.body = body.slice(0, BODY_SNIPPET);
    // 429 = Too Many Request
    this.retryable = status === 429 || status >= 500;
  }
}

export class NetworkError extends Error {
  readonly url: string;
  readonly retryable = true;

  constructor(url: string, cause: unknown) {
    super(`Network failure for ${url}: ${String(cause)}`);
    this.name = "NetworkError"
    this.url = url;
    this.cause = cause;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// CHUNK 2 — sleep, and the per-host turn-taking.
//
// sleep is one line. The syntax, because the shape is fiddly:
//
//   const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
//
// Now nextSlot(host, delayMs) — the interesting part of this file.
//
// GOAL: two calls for the SAME host must not fire at once; they queue and each
// waits delayMs after the one before. Two calls for DIFFERENT hosts must not
// wait on each other at all.
//
// THE TRAP, concretely. Say you keep the time of the last request per host:
//
//     const lastAt = new Map<string, number>();
//     const wait = lastAt.get(host) + delayMs - Date.now();   // ← broken
//
// Eight workers hit this line in the same tick. All eight read the SAME stored
// number, all eight compute the same wait, all eight wake together and fire at
// once. The portal sees a burst of 8. Reading a shared clock value cannot
// serialize anything, because reading doesn't reserve your place.
//
// What you need instead: each caller waits on THE PREVIOUS CALLER, not on a
// timestamp. If caller #5 holds a reference to "the thing caller #4 is waiting
// on", it can append itself to the end and the chain stays ordered.
//
// The value you already know that means "not done yet, ask me later, and you
// can attach follow-up work with .then()" is a Promise.
//
// So the state you store per host is a Promise, not a number:
//
//     const hostChains = new Map<string, Promise<void>>();
//
//     function nextSlot(host: string, delayMs: number): Promise<void> {
//       const previous = /* what's stored for this host, or a fresh
//                           already-finished Promise if this host is new
//                           — Promise.resolve() gives you one */;
//       const mine = previous.then(() => /* wait your delay */);
//       /* store `mine` as the new tail for this host */
//       return mine;
//     }
//
// YOUR DECISIONS, two of them:
//   (a) `previous.then(...)` — what goes in the callback so that YOUR turn
//       starts only after the previous one finished AND the delay has passed?
//   (b) If one caller's fetch rejects, its promise rejects. If you store that
//       rejected promise as the tail, every later caller chained onto it
//       rejects too — one failed request poisons the host forever. What do you
//       store so the chain survives a failure? (Hint: you can store a
//       *different* promise than the one you return. `.catch(() => {})` turns a
//       rejected promise into a resolved one.)
// ═════════════════════════════════════════════════════════════════════════════

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const hostChains = new Map<string, Promise<void>>();

// host is procurement URL
export function nextSlot(host: string, delayMs: number): Promise<void> {
  const previous = hostChains.get(host) ?? Promise.resolve();
  const mine = previous.then(() => sleep(delayMs));
  hostChains.set(host, mine.catch(() => {}))
  // console.log(hostChains.get(host));
  return mine
}

// ═════════════════════════════════════════════════════════════════════════════
// CHUNK 3 — the two small helpers. Do these BEFORE politeFetch so the loop has
// everything it needs when you write it.
//
//   function backoffMs(attempt: number, baseMs: number): number
//     Grow the wait with each attempt, capped so an outage can't park a worker
//     for an hour. `2 ** attempt` is exponentiation; Math.min caps it.
//
//   function retryAfterMs(response: Response): number | undefined
//     Read the "retry-after" header: response.headers.get("retry-after")
//     returns string | null.
//     The header is EITHER a count of seconds ("120") OR an HTTP date
//     ("Wed, 21 Oct 2026 07:28:00 GMT"). Handle both, return undefined if the
//     header is absent or unparseable.
//     Syntax: Number("120") -> 120, and Number("Wed, 21...") -> NaN, so
//     Number.isFinite() tells the two apart. Date.parse(str) gives you epoch ms
//     or NaN.
//
//     YOUR DECISION: this number came from someone else's server. What stops a
//     hostile or buggy `retry-after: 999999` from parking a worker for days?
//     Also: a date in the past would give you a negative wait — clamp it.
// ═════════════════════════════════════════════════════════════════════════════

// ...write chunk 3 here, then typecheck.

// ═════════════════════════════════════════════════════════════════════════════
// CHUNK 4 — politeFetch. The loop that uses everything above.
//
// export async function politeFetch(
//   url: string,
//   init: RequestInit = {},
//   options: PoliteOptions = {},
// ): Promise<Response> {
//
//   1. Resolve the three settings. `options.delayMs ?? env.httpDelayMs` — the
//      ?? operator takes the right side only when the left is null/undefined
//      (unlike ||, which would also replace a legitimate 0).
//
//   2. const host = new URL(url).host;
//
//   3. Declare `let lastError: HttpError | NetworkError | undefined;` before
//      the loop so it survives across attempts.
//
//   4. for (let attempt = 1; attempt <= maxAttempts; attempt++) {
//
//        a. await your turn on this host.
//
//        b. Build the signal. You need YOUR timeout and, if the caller passed
//           one, THEIR signal — whichever fires first wins:
//
//             const signals = [AbortSignal.timeout(timeoutMs)];
//             if (init.signal) signals.push(init.signal);
//             // then pass AbortSignal.any(signals) as the signal
//
//        c. try { response = await fetch(url, { ...init, signal, headers: {
//             "User-Agent": env.httpUserAgent, ...init.headers } }) }
//           catch (cause) { ... }
//
//           TRAP 3 lives in that catch. A throw here is USUALLY a timeout or a
//           dead socket — retry those. But documents.ts will deliberately abort
//           mid-stream when it sees a non-zip or an oversize body, and that
//           abort also lands here as a throw.
//
//           YOUR DECISION: how do you tell "the network died" from "my caller
//           chose to stop"? You have `init.signal` in hand and it has a boolean
//           telling you whether IT was the one that aborted. Retrying a
//           deliberate abort would re-download the thing you just refused.
//
//           Otherwise: build a NetworkError, and if attempts remain, sleep the
//           backoff and `continue`. If none remain, throw.
//
//        d. if (response.ok) return response;
//
//           RETURN IT UNREAD. Do not call .json() or .text() or .arrayBuffer()
//           on a success here — a bundle reaching 512MB streams through this
//           function, and reading it would put it all in the worker heap. The
//           caller decides how to consume the body.
//
//        e. Non-2xx: NOW you may read the body (an error page is small):
//             const body = await response.text().catch(() => "");
//           Build an HttpError. Then: if it isn't retryable, or this was the
//           last attempt, throw it. Otherwise sleep — and here's where a 429's
//           retry-after beats your own backoff if the server gave you one —
//           then loop.
//      }
//
//   5. After the loop, TypeScript can't prove you never fall through, so it
//      demands a return or throw. `throw lastError ?? new NetworkError(url,
//      "no attempts made");` — and a comment saying it's unreachable.
// }
// ═════════════════════════════════════════════════════════════════════════════

// ...write chunk 4 here, then typecheck, then tell me and I'll review.
