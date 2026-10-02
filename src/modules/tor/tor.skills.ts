import type { Types } from "mongoose";
import { SKILL_TAGGER_VERSION, tagSkills, type SkillSource } from "../../lib/skills/tagSkills.ts";
import { TorModel } from "./tor.model.ts";

/**
 * Re-derive one TOR's keyword skill tags from its project name.
 *
 * Only `source: "keyword"` entries are replaced — tags another writer added
 * survive a re-run. Returns the number of keyword tags written.
 */
export async function tagTorSkills(torId: Types.ObjectId | string): Promise<number> {
  const tor = await TorModel.findById(torId, { projectName: 1, requiredSkills: 1 }).lean();
  if (!tor) return 0;

  const sources: SkillSource[] = [{ text: tor.projectName }];
  const tags = tagSkills(sources);

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
