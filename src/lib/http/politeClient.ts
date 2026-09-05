import { env } from "../../config/env";

// politeFetch(url)
// │
// ├─ resolve settings: delay, timeout, maxAttempts (options → env defaults)
// ├─ extract the host from the URL
// │
// └─ loop, attempt 1..maxAttempts:
//    │
//    ├─ 1. await nextSlot(host, delay)      ← wait your turn on this host
//    │
//    ├─ 2. fetch, with:
//    │        User-Agent header (honest, has a contact address)
//    │        signal = timeout ∪ caller's own signal
//    │
//    ├─ 3a. threw?
//    │        caller aborted deliberately → rethrow, don't retry
//    │        otherwise → NetworkError, sleep backoff, try again
//    │
//    ├─ 3b. response.ok?
//    │        → RETURN it, body unread
//    │
//    └─ 3c. non-2xx:
//             read body (small, it's an error page)
//             build HttpError
//             not retryable (4xx) or out of attempts → throw
//             otherwise → sleep Retry-After or backoff, try again


/**
 * The only door out to a government host (NFR-07, AGENTS.md §4.5).
 *
 * No auth means the only thing owed the portal is courtesy: an honest
 * User-Agent with a contact address, a delay between requests to the same host,
 * a timeout, and exponential backoff on failures worth retrying.
 *
 * Never inline a `fetch` or a User-Agent at a call site.
 */

/** Truncated so a government HTML error page cannot flood a log line. */
const BODY_SNIPPET = 500;

export class HttpError extends Error {
    readonly status: number;
    readonly url: string;
    readonly body: string;
    /** 429 and 5xx get better on their own. 4xx does not. */
    readonly retryable: boolean;

    constructor(status: number, url: string, body: string) {
        super(`HTTP ${status} for ${url}`);
        this.name = "HttpError";
        this.status = status;
        this.url = url;
        this.body = body.slice(0, BODY_SNIPPET);
        this.retryable = status === 429 || status >= 500;
    }
}

/** A timeout or a dropped connection — no status, always worth one more try. */
export class NetworkError extends Error {
    readonly url: string;
    readonly retryable = true;

    constructor(url: string, cause: unknown) {
        super(`Network failure for ${url}: ${String(cause)}`);
        this.name = "NetworkError";
        this.url = url;
        this.cause = cause;
    }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Per-host serialization.
 *
 * The naive version — a Map of host to last-request time, read it, sleep the
 * remainder — breaks the moment two callers hit the same host at once: both
 * read the same timestamp, both decide the delay has passed, and both fire.
 * With eight workers pulling from the queue that is the normal case, not an
 * edge case.
 *
 * So each host holds a promise chain instead of a timestamp. A new request
 * appends itself to that host's chain and waits its turn, which makes requests
 * to one host strictly sequential while different hosts stay independent.
 */
const hostChains = new Map<string, Promise<void>>();

function nextSlot(host: string, delayMs: number): Promise<void> {
    const previous = hostChains.get(host) ?? Promise.resolve();
    const mine = previous.then(() => sleep(delayMs));
    // Swallow rejections so one failed turn cannot poison the whole chain.
    hostChains.set(host, mine.catch(() => {}));
    return mine;
}

export type PoliteOptions = {
    delayMs?: number;
    timeoutMs?: number;
    maxAttempts?: number;
};

/**
 * Fetch one URL politely, retrying what is worth retrying.
 *
 * Returns the Response with its body UNCONSUMED — `fetchDocument` streams
 * bundles up to 512MB, and `await response.arrayBuffer()` on one of those puts
 * half a gigabyte in the worker heap.
 *
 * Throws HttpError on a non-2xx that ran out of attempts, NetworkError on a
 * timeout or dropped connection.
 */
export async function politeFetch(
    url: string,
    init: RequestInit = {},
    options: PoliteOptions = {},
): Promise<Response> {
    const delayMs = options.delayMs ?? env.httpDelayMs;
    const timeoutMs = options.timeoutMs ?? env.httpTimeoutMs;
    const maxAttempts = options.maxAttempts ?? env.httpMaxAttempts;

    const host = new URL(url).host;
    let lastError: HttpError | NetworkError | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await nextSlot(host, delayMs);

        // The caller's own signal still wins; the timeout is added to it.
        const signals = [AbortSignal.timeout(timeoutMs)];
        if (init.signal) signals.push(init.signal);

        let response: Response;
        try {
            response = await fetch(url, {
                ...init,
                signal: AbortSignal.any(signals),
                headers: {
                    "User-Agent": env.httpUserAgent,
                    ...init.headers,
                },
            });
        } catch (cause) {
            // A caller-initiated abort is a decision, not a failure to retry.
            if (init.signal?.aborted) throw cause;
            lastError = new NetworkError(url, cause);
            if (attempt < maxAttempts) {
                await sleep(backoffMs(attempt, delayMs));
                continue;
            }
            throw lastError;
        }

        if (response.ok) return response;

        // Read the body here: it is the only place the error text is available,
        // and a failed response is small enough to hold.
        const body = await response.text().catch(() => "");
        lastError = new HttpError(response.status, url, body);

        if (!lastError.retryable || attempt === maxAttempts) throw lastError;

        const after = retryAfterMs(response);
        await sleep(after ?? backoffMs(attempt, delayMs));
    }

    // Unreachable: the loop either returns or throws. Here for the type checker.
    throw lastError ?? new NetworkError(url, "no attempts made");
}

/** Exponential, from the politeness delay, capped so a retry never parks a worker. */
function backoffMs(attempt: number, baseMs: number): number {
    return Math.min(baseMs * 2 ** attempt, 30_000);
}

/** Honour the portal's own instruction when it sends one. Seconds or a date. */
function retryAfterMs(response: Response): number | undefined {
    const header = response.headers.get("retry-after");
    if (!header) return undefined;

    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.min(seconds * 1000, 60_000);

    const date = Date.parse(header);
    if (Number.isNaN(date)) return undefined;
    return Math.min(Math.max(date - Date.now(), 0), 60_000);
}
