import { env } from "../../../config/env.ts";
import type { Cursor, RawProject, Source } from "../types.ts";
import { CKAN_PAGE_SIZE, fetchPage, type CkanRow } from "./client.ts";
import { COL } from "./columns.ts";
import { fetchDocument, listDocuments } from "./documents.ts";
import { egpListingUrl, isUsableRow, normalizeCkanRow, SOURCE_ID } from "./normalize.ts";

export type DiscoverProgress = {
  offset: number;
  total: number;
  scanned: number;
};

// Paged bulk scan. AsyncIterable, not an array: 511,606 rows at 32,000 per page
// would mean holding the whole resource in memory before the caller sees row
// one, and would remove any way to stop early.
//
// onPage fires after each page so the caller can persist the watermark. A scan
// this long WILL be interrupted; resuming from lastOffset is not optional.
export async function* discover(
  cursor: Cursor = {},
  onPage?: (p: DiscoverProgress) => Promise<void> | void,
): AsyncIterable<RawProject> {
  let offset = cursor.lastOffset ?? 0;
  let total = Infinity;
  let scanned = 0;

  while (offset < total) {
    const page = await fetchPage(env.ckanResourceId, offset, CKAN_PAGE_SIZE);
    total = page.total || page.records.length;

    for (const record of page.records) {
      scanned++;
      if (!isUsableRow(record)) continue;

      const projectId = String(record[COL.projectId] ?? "").trim();
      yield {
        projectId,
        sourceUrl: egpListingUrl(projectId),
        fields: record as Record<string, unknown>,
        header: page.fields,
      };
    }

    offset += page.records.length;
    await onPage?.({ offset, total, scanned });

    // A short page means the resource is exhausted, whatever `total` claimed.
    if (page.records.length === 0) break;
  }
}

export const ckanSource: Source = {
  id: SOURCE_ID,
  discover: (cursor: Cursor) => discover(cursor),
  listDocuments,
  fetchDocument,
  normalize: normalizeCkanRow,
};

export { SOURCE_ID, normalizeCkanRow, isUsableRow, type CkanRow };
