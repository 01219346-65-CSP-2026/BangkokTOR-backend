# TypeScript cheatsheet: everything these branches use

Each item gives the syntax, what it means, and a real example from this repo. You don't need to memorise these; come back here when a line confuses you.

---

## Files talk to each other: `import` / `export`

```ts
export function buildFullText(...) { ... }     // fulltext.ts: "other files may use this"
import { buildFullText } from "../../lib/extract/fulltext.ts";  // extract.service.ts uses it
import type { LoadedPdf } from "./loader.ts";  // `type`: only the shape, no code
```
`./` means "this folder" and `../` means "one folder up".

## Variables: `const` and `let`

```ts
const files: FileSpan[] = [];   // const: this name always points at the same thing
let text = "";                  // let: this name can be reassigned (text += "...")
```
Use `const` unless you really need to reassign.

## Types: describing the shape of data

```ts
type FileSpan = {
  filename: string;
  pages: number;
  start: number;
};
```
- `string[]` means an array of strings.
- `string | null` means either a string OR null (a **union**).
- `count?: number` means the field may be missing (optional).
- `LoadedPdf & { triage: Triage }` means everything in LoadedPdf PLUS a `triage` field.

Types don't run. They're checked by `bun run typecheck` so mistakes show up before you run the code.

## Functions

```ts
function fileAt(files: FileSpan[], offset: number): string | null { ... }
//              ^ input name: its type               ^ what it returns

const double = (n: number) => n * 2;          // arrow function, same idea, shorter
files.map((f) => f.filename)                  // arrow functions are often passed to other functions
function build(pdfs: LoadedPdf[], maxChars = 400_000) // `= 400_000` is a default value
```
`400_000` is just 400000. The `_` is only there to make it easier to read.

## `if`, loops, early exit

```ts
for (const pdf of pdfs) {        // do this once per item
  if (!body) continue;           // skip to the next item
  if (truncated) break;          // stop the loop completely
}
if (!stored) return { ok: false, reason: "no-text" };   // leave the function early
```
`!x` means "not x". An empty string `""`, `0`, `null` and `undefined` all count as false.

## Objects and arrays

```ts
const out = { text, chars: text.length };   // `text` alone is short for `text: text`
out.chars                                   // read a field
rows[0]                                     // first item of an array
const { text, files } = stored;             // destructuring: pull fields into variables
const all = [...a, ...b];                   // spread: a new array with a's and b's items
{ ...chunk, index: 3 }                      // copy an object, overriding one field
```

## Handy array methods

```ts
files.map((f) => f.pages)                 // transform each item      → new array
files.filter((f) => f.pages > 0)          // keep only some items     → new array
files.find((f) => f.filename === name)    // first match, or undefined
files.some((f) => f.pages === 0)          // is at least one true?    → boolean
files.every((f) => f.pages > 0)           // are all true?            → boolean
files.reduce((sum, f) => sum + f.pages, 0) // fold into one value (here: a total)
lines.join("\n")                          // array of strings → one string
```

## Strings

```ts
`=== FILE: ${filename} ===\n`     // template string: ${...} inserts a value
text.slice(0, 100)                // characters 0..99
text.indexOf("ค่าปรับ")            // position of the first match, or -1 if missing
text.includes("บาท")               // true or false
s.replace(/\s+/g, " ")            // regex: every run of whitespace → one space
s.trim()                          // remove spaces at both ends
```

## Missing values: `?.` and `??`

```ts
node.kids ?? []                 // use node.kids, or [] if it's null/undefined
payload.candidates?.[0]         // if candidates is missing, give undefined instead of crashing
```

## Waiting for slow things: `async` / `await`

Database calls and HTTP calls take time. They return a **Promise** (a value that arrives later).

```ts
async function gradeTor(id) {                       // `async`: this function may wait
  const tor = await TorModel.findById(id).lean();   // `await`: pause here until the database answers
}
await Promise.all([a(), b()]);                       // start both, wait for both
```
You can only use `await` inside an `async` function.

## Errors

```ts
throw new Error("VERTEX_API_KEY is not set");   // stop and report a problem

try {
  await riskyThing();
} catch (error) {
  console.error(error);                         // handle it instead of crashing
} finally {
  clearTimeout(timer);                          // runs either way
}
```

## Mongoose (MongoDB) in five lines

```ts
await TorTextModel.findOne({ torId }).lean();          // one document or null (.lean() = plain object)
await TorModel.find({ status: "graded" }).limit(5);    // many documents
await TorModel.updateOne({ _id: id }, { $set: { grade: "A" } });            // change fields
await TorTextModel.updateOne({ torId }, { $set: {...} }, { upsert: true }); // update, or create if missing
await TorTextModel.countDocuments();                   // how many
```

## Calling an HTTP API: `fetch`

```ts
const response = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ hello: "world" }),   // object → JSON text
});
if (!response.ok) throw new Error(`HTTP ${response.status}`);
const data = await response.json();           // JSON text → object
```

## Tests (`bun test`)

```ts
import { describe, expect, test } from "bun:test";

describe("fileAt", () => {
  test("finds the file", () => {
    expect(fileAt(files, 5)).toBe("a.pdf");      // must be exactly equal
    expect(list).toHaveLength(2);
    expect(obj).toEqual({ a: 1 });               // same contents (deep compare)
  });
});
```
Run one file with `bun test src/lib/extract/fulltext.test.ts`.
