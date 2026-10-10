import { connectMongo, disconnectMongo } from "./db/mongo.ts";
import { refreshBidding } from "./modules/bidding/bidding.service.ts";

// Re-check every BMA TOR that has not been awarded yet: its e-GP stage, and
// the bid deadline in its newest ประกาศเชิญชวน. Each BMA discovery run does
// this at the end; this runs it on its own.
//
//   bun run refresh-bidding              # all of them
//   bun run refresh-bidding --limit 5    # a few, for a quick look
//
// Network only to e-GP and the BMA portal, through politeFetch. Failures go to
// ingest_errors, never silently.

const at = process.argv.indexOf("--limit");
const limit = at >= 0 ? Number(process.argv[at + 1]) : undefined;

await connectMongo();
const result = await refreshBidding({ limit, log: (line) => console.log(line) });
console.log(JSON.stringify(result));
await disconnectMongo();
