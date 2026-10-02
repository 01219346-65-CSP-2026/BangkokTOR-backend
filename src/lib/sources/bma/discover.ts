import { classifySoftware } from "../../classify/index.ts";
import { egpListingUrl } from "../ckan/normalize.ts";
import type { RawProject } from "../types.ts";
import * as client from "./client.ts";
import { createdMonth, toCkanFields } from "./columns.ts";

export type BmaDiscoverOptions = {
  /** How far back to read. Open tenders are weeks old, not months. */
  lookbackDays: number;
  /** Hard stop, whatever the dates say. */
  maxPages: number;
  now?: Date;
  onPage?: (p: { page: number; rows: number; candidates: number }) => Promise<void> | void;
  /**
   * Projects already held. Their detail is not re-read: the server takes
   * seconds per call, and their stage and deadline are refreshed separately
   * (modules/bidding refreshBidding).
   */
  isHeld?: (projectNumber: string) => boolean;
  /** Title-score bar for a detail request. 1 = any software term at all
   *  (the `discover --full` audit); default TITLE_CANDIDATE_SCORE. */
  minTitleScore?: number;
  /** A project whose detail could not be read. Discovery carries on. */
  onError?: (projectNumber: string, error: unknown) => Promise<void> | void;
};

type Client = Pick<typeof client, "searchPage" | "projectDetail" | "announcements">;

/**
 * Worth a detail request? The list row has only a title, so this asks whether
 * the title alone points at software. The full verdict (with contract type and
 * goods category, which can sink it) is classifyRaw's, after detail.
 *
 * The bar is one real term (ดิจิทัล/ออนไลน์ at 15 and up). "ระบบ" alone (8)
 * is in a third of all titles — air conditioning, water, lighting — and each
 * candidate costs ~4 s of a slow server. A title that is software but says
 * only "ระบบ" would also need a hire contract AND an IT goods category to pass
 * classifyRaw, which BMA rows rarely carry.
 */
export const TITLE_CANDIDATE_SCORE = 15;

export function isTitleCandidate(title: string, minScore = TITLE_CANDIDATE_SCORE): boolean {
  return classifySoftware({ title, category: "other", contractType: null }).score >= minScore;
}

/**
 * Newest-first over the BMA portal, yielding software candidates as CKAN-keyed
 * rows. A page counts as past the window when most of its projects were
 * created before the cutoff — the portal sorts by publish date, and an old
 * project can be published late, so one old row is not a stopping signal.
 */
export async function* discoverBma(options: BmaDiscoverOptions, api: Client = client): AsyncIterable<RawProject> {
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - options.lookbackDays * 86_400_000);
  // Project numbers carry a month, not a day.
  cutoff.setUTCDate(1);

  for (let page = 1; page <= options.maxPages; page++) {
    const result = await api.searchPage(page);
    const rows = result.data ?? [];
    let candidates = 0;
    let old = 0;

    for (const row of rows) {
      const created = createdMonth(row.projectNumber);
      if (created && created < cutoff) old++;
      if (!row.projectNumber || !isTitleCandidate(row.projectName ?? "", options.minTitleScore)) continue;
      if (options.isHeld?.(row.projectNumber)) continue;

      candidates++;
      let raw: RawProject;
      try {
        const [detail, list] = await Promise.all([api.projectDetail(row.projectId), api.announcements(row.projectId)]);
        raw = {
          projectId: row.projectNumber,
          sourceUrl: egpListingUrl(row.projectNumber),
          fields: toCkanFields(detail, list),
        };
      } catch (error) {
        await options.onError?.(row.projectNumber, error);
        continue;
      }
      yield raw;
    }

    await options.onPage?.({ page, rows: rows.length, candidates });
    if (!result.hasNextPage || rows.length === 0 || old > rows.length / 2) return;
  }
}
