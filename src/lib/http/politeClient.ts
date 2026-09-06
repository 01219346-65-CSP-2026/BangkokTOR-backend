import { env } from "../../config/env.ts";

// The only door out to a government host (NFR-07, §4.5). Never inline a fetch
// or a User-Agent at a call site.

// ─────────────────────────────────────────────────────────────────────────────
// GENERATED — the option bag. Everything below the line is yours to write.
// ─────────────────────────────────────────────────────────────────────────────

export type PoliteOptions = {
  delayMs?: number;
  timeoutMs?: number;
  maxAttempts?: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// YOURS FROM HERE.
//
// Write, in this order:
//
//   1. class HttpError extends Error
//        constructor(status: number, url: string, body: string)
//        fields: status, url, body (truncate it — an error page can be huge),
//                retryable
//        `retryable` is the whole point of the class: 429 and 5xx get better on
//        their own, 4xx does not.
//
//   2. class NetworkError extends Error
//        constructor(url: string, cause: unknown)
//        A timeout or dropped connection. No status. Always worth one more try.
//
//   3. const sleep = (ms: number) => Promise<void>
//
//   4. nextSlot(host: string, delayMs: number): Promise<void>
//        Make callers to the SAME host wait their turn, while different hosts
//        stay independent.
//
//        TRAP 1: a Map<host, lastRequestTimestamp> looks right and is wrong.
//        Eight workers read the same timestamp in the same tick, all compute
//        the same "I may go at T+400ms", and all fire together. You need each
//        caller to wait on the one BEFORE it, not on a shared clock reading.
//        Reach for a data structure that already expresses "after the previous
//        one finishes". Store it per host. One failed turn must not poison the
//        chain for every later caller.
//
//   5. export async function politeFetch(
//        url: string,
//        init: RequestInit = {},
//        options: PoliteOptions = {},
//      ): Promise<Response>
//
//        Resolve delay/timeout/maxAttempts from options, falling back to
//        env.httpDelayMs / env.httpTimeoutMs / env.httpMaxAttempts.
//        Take the host off the URL. Then loop attempt 1..maxAttempts:
//
//          await your turn on this host
//          fetch with the honest User-Agent (env.httpUserAgent) and a timeout
//          threw?      -> NetworkError, back off, try again
//          response.ok -> RETURN IT
//          non-2xx     -> read the body, build an HttpError,
//                         not retryable or out of attempts -> throw
//                         otherwise back off and try again
//
//        TRAP 2: return the Response with its body UNREAD. fetchDocument
//        streams a bundle that reaches 512MB; calling .json() or .arrayBuffer()
//        here would put half a gigabyte in the worker heap. Only the non-2xx
//        path may read the body, because an error page is small.
//
//        TRAP 3: the caller can pass its own init.signal, and documents.ts will
//        abort deliberately when it sees a non-zip or an oversize stream. That
//        abort is a DECISION, not a failure — rethrow it, never retry it. You
//        still want your own timeout signal too, so both have to apply at once.
//        (AbortSignal.timeout and AbortSignal.any exist.)
//
//   6. backoffMs(attempt: number, baseMs: number): number
//        Grow with the attempt number; cap it so a long outage can't park a
//        worker for an hour.
//
//   7. retryAfterMs(response: Response): number | undefined
//        A 429 usually says how long to wait. The header is EITHER a number of
//        seconds OR an HTTP date — handle both, and cap it, because the value
//        comes from someone else's server.
//
// When it typechecks, tell me and I'll review it before you move to Step 2.
// ─────────────────────────────────────────────────────────────────────────────
