import { connectMongo, disconnectMongo } from "./db/mongo.ts";
import { politeFetch } from "./lib/http/politeClient.ts";
import { agencyProvince } from "./lib/sources/egp/procurement.ts";
import { TorModel } from "./modules/tor/tor.model.ts";

// Fill in จังหวัด for TORs that came in without one — the e-GP captures made
// before procurementFields read the agency's location (2026-10-03). Reads each
// buying agency from e-GP (not gated), at e-GP's polite pace.
//
//   bun run backfill-province            # report only
//   bun run backfill-province --apply    # write

const apply = process.argv.includes("--apply");
const EGP = "https://process5.gprocurement.go.th/egp-oann10-service/pb/a-egp-allt-project/announcement";

await connectMongo();
const todo = await TorModel.find({ province: null }, { projectId: 1, agency: 1 }).lean();
console.log(`${todo.length} TORs without a province.`);

let found = 0;
for (const tor of todo) {
  const response = await politeFetch(`${EGP}/getProcurementDetail?projectId=${encodeURIComponent(tor.projectId)}`);
  const detail = ((await response.json()) as { data?: { deptId?: string; deptSubId?: string } | null }).data;
  const province = await agencyProvince(detail?.deptId, detail?.deptSubId);
  console.log(`  ${tor.projectId}  ${province ?? "—"}  ${tor.agency}`);
  if (!province) continue;
  found++;
  if (apply) await TorModel.updateOne({ _id: tor._id }, { $set: { province } });
}

console.log(apply ? `Done: ${found} provinces written.` : `Would write ${found}. Re-run with --apply.`);
await disconnectMongo();
