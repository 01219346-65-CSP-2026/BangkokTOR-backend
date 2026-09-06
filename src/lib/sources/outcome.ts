export type FetchOutcome = 
| {ok: true, bytes: number, sha256: string, path: string}
| {ok: false, bytes: number, reason: "oversize"}
| {ok: false, reason: "no-bundle"}
| {ok: false, reason: "not-a-zip"}
| {ok: false, reason: "no-file-attached"}

export function logLine(o: FetchOutcome): string {
    if (o.ok) {
        return `ok ${o.bytes} bytes -> ${o.path}`
    } else if (o.reason == "no-bundle" || o.reason == "not-a-zip") {
        return o.reason
    } else if (o.reason == "oversize") {
        return `oversize at ${o.bytes} bytes`
    } else if (o.reason == "no-file-attached") {
        return 'no files attached'
    }
    const impossible: never = o;
    throw new Error(`unhandled outcome: ${JSON.stringify(impossible)}`);
}