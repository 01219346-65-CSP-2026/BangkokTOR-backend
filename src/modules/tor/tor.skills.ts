import type { Types } from "mongoose";
import { SKILL_TAGGER_VERSION, tagSkills, type SkillSource } from "../../lib/skills/tagSkills.ts";
import { ChunkModel } from "../extract/chunk.model.ts";
import { TorModel } from "./tor.model.ts";

/**
 * Re-derive one TOR's keyword skill tags from its project name and whatever
 * chunks it has. A TOR with no chunks yet (documents_fetched) is tagged from
 * its name alone, and gets re-tagged when extraction produces chunks.
 *
 * Only `source: "keyword"` entries are replaced — tags another writer added
 * survive a re-run. Returns the number of keyword tags written.
 */
export async function tagTorSkills(torId: Types.ObjectId | string): Promise<number> {
  const tor = await TorModel.findById(torId, { projectName: 1, requiredSkills: 1 }).lean();
  if (!tor) return 0;

  const chunks = await ChunkModel.find({ torId }, { text: 1, index: 1 }).sort({ index: 1 }).lean();

  const sources: SkillSource[] = [
    { text: tor.projectName, chunkIndex: null },
    ...chunks.map((c) => ({ text: c.text, chunkIndex: c.index })),
  ];
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
