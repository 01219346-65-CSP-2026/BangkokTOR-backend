import { connectMongo, disconnectMongo } from "./db/mongo.ts";
import { SKILL_TAGGER_VERSION } from "./lib/skills/tagSkills.ts";
import { TorModel } from "./modules/tor/tor.model.ts";
import { tagTorSkills } from "./modules/tor/tor.skills.ts";

// Give every TOR keyword skill tags, or refresh ones made by an older tagger.
// Safe to re-run: rows already at SKILL_TAGGER_VERSION are skipped, and only
// `source: "keyword"` entries are ever replaced.
//
//   bun run backfill-skills            # report only
//   bun run backfill-skills --apply    # write
//   bun run backfill-skills --apply --all   # re-tag even current rows
//
// New TORs are tagged by extraction (extract.service.ts processBundle); this
// covers the ones extracted before tagging existed, and those still waiting on
// documents, which are tagged from their project name alone.

const apply = process.argv.includes("--apply");
const all = process.argv.includes("--all");

await connectMongo();

const filter = all ? {} : { skillTaggerVersion: { $ne: SKILL_TAGGER_VERSION } };
const todo = await TorModel.find(filter, { _id: 1 }).lean();

console.log(`${todo.length} TORs need skill tags (tagger v${SKILL_TAGGER_VERSION}).`);

if (apply) {
  let tagged = 0;
  let tags = 0;
  for (const [i, tor] of todo.entries()) {
    const n = await tagTorSkills(tor._id);
    if (n > 0) tagged++;
    tags += n;
    if ((i + 1) % 500 === 0) console.log(`  ${i + 1}/${todo.length}`);
  }
  console.log(`Done: ${tags} tags on ${tagged} of ${todo.length} TORs; the rest mention no known skill.`);
} else {
  console.log("Dry run. Re-run with --apply to write.");
}

await disconnectMongo();
