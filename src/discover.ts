import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { connectMongo, disconnectMongo } from "./db/mongo.ts";
import { runDiscovery, type RejectedRow } from "./modules/ingest/ingest.service.ts";

// Stage ①, from the terminal: read the configured feed (EGP_FEED, default
// "bma") and enqueue every new software project. The same call as
// POST /api/ingest/run, without needing the admin token.
//
//   bun run discover                  # the window, new projects only
//   bun run discover --limit 10       # stop after 10 new projects
//   bun run discover --full           # audit: re-read everything at the loosest
//                                     # title bar, and report every rejection
//   bun run discover --full --days 180
//   bun run discover --page 120       # resume a scan that died at page 120
//
// Then `bun run worker` turns the queue into TORs (and reads each one's
// stage and deadline). With the BMA feed, the run ends by re-checking every
// TOR that is not awarded yet — the same as `bun run refresh-bidding`.
//
// Every rejected candidate is written to data/reports/discover-<date>.tsv,
// highest software score first: the top of that file is where a real software
// tender the classifier undervalued would be.

const arg = (flag: string) => {
  const at = process.argv.indexOf(flag);
  return at >= 0 ? Number(process.argv[at + 1]) : undefined;
};

const rejects: RejectedRow[] = [];

await connectMongo();
const result = await runDiscovery({
  limit: arg("--limit"),
  lookbackDays: arg("--days"),
  startPage: arg("--page"),
  full: process.argv.includes("--full"),
  onRejected: (row) => rejects.push(row),
});
console.log(JSON.stringify(result, null, 2));
await disconnectMongo();

rejects.sort((a, b) => b.score - a.score);

const dir = join("data", "reports");
await mkdir(dir, { recursive: true });
const path = join(dir, `discover-${new Date().toISOString().slice(0, 10)}.tsv`);
const clean = (s: string | null) => (s ?? "").replace(/[\t\n]/g, " ");
await Bun.write(
  path,
  ["projectId\treason\tscore\tsignals\tmethod\tcontract\ttitle"]
    .concat(rejects.map((r) => [r.projectId, r.reason, r.score, clean(r.signals), r.method ?? "", r.contractType ?? "", clean(r.title)].join("\t")))
    .join("\n") + "\n",
);

console.log(`\nRejected as not software: ${rejects.length}`);
console.log("Highest-scoring rejects — the likeliest misses:");
for (const r of rejects.slice(0, 20)) {
  console.log(`  ${String(r.score).padStart(4)}  ${r.reason.padEnd(12)} ${r.projectId}  ${r.title.slice(0, 80)}`);
  console.log(`        ${r.signals}`);
}
console.log(`\nFull list: ${path}`);
