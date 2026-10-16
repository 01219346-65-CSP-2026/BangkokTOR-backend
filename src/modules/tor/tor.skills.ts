import type { Types } from "mongoose";
import { SKILL_TAGGER_VERSION, tagSkills, torSkillSources } from "../../lib/skills/tagSkills.ts";
import { TorTextModel } from "../extract/torText.model.ts";
import { TorModel } from "./tor.model.ts";

/**
 * Re-derive one TOR's keyword skill tags from its project name and its stored
 * full text. A TOR with no text yet (documents_fetched) is tagged from its name
 * alone, and re-tagged when extraction writes its tor_texts row.
 *
 * Only `source: "keyword"` entries are replaced — tags another writer added
 * survive a re-run. Returns the number of keyword tags written.
 */
export async function tagTorSkills(torId: Types.ObjectId | string): Promise<number> {
  const tor = await TorModel.findById(torId, { projectName: 1, requiredSkills: 1 }).lean();
  if (!tor) return 0;

  // fullText only: the row also carries `files`, which the tagger never reads.
  const text = await TorTextModel.findOne({ torId: tor._id }, { fullText: 1 }).lean();
  const tags = tagSkills(torSkillSources(tor.projectName, text?.fullText));

  const kept = (tor.requiredSkills ?? []).filter((s) => s.source !== "keyword");
  // A slug another source already claims keeps that entry; no duplicates.
  const keptSlugs = new Set(kept.map((s) => s.slug));

  await TorModel.updateOne(
    { _id: tor._id },
    {
      $set: {
        requiredSkills: [...kept, ...tags.filter((t) => !keptSlugs.has(t.slug))],
        skillsTaggedAt: new Date(),
        skillTaggerVersion: SKILL_TAGGER_VERSION,
      },
    },
  );

  return tags.length;
}
