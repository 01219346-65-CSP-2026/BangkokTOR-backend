import type { Cursor, RawProject, Source } from "../types.ts";
import { resolveDataset, type CkanDataset } from "./catalog.ts";
import { CKAN_PAGE_SIZE, fetchPage, type CkanRow } from "./client.ts";
import { COL } from "./columns.ts";
import { fetchDocument, listDocuments } from "./documents.ts";
import { egpListingUrl, isUsableRow, normalizeCkanRow, SOURCE_ID } from "./normalize.ts";

export type DiscoverProgress = {
  resourceId: string;
  offset: number;
  total: number;
  scanned: number;
};

type PageFetcher = typeof fetchPage;

// Paged bulk scan over every resource of one fiscal year's package.
// AsyncIterable, not an array: a year is ~10 resources of ~500k rows, and
// holding them before the caller sees row one would remove any way to stop
// early.
//
// CKAN filters on ปีงบประมาณ server-side, so offsets and totals count only
// that year's rows. Resources are scanned in order; the cursor's resourceId
// says where an interrupted scan stopped, and everything before it is skipped.
//
// onPage fires after each page so the caller can persist the watermark. A scan
// this long WILL be interrupted; resuming is not optional.
export async function* discover(
  dataset: CkanDataset,
  cursor: Cursor = {},
  onPage?: (p: DiscoverProgress) => Promise<void> | void,
  fetch: PageFetcher = fetchPage,
): AsyncIterable<RawProject> {
  const filters = { [COL.fiscalYear]: String(dataset.fiscalYear) };

  // A cursor from another year, or naming a resource the package no longer
  // lists, can't be resumed — start the year from the top.
  const sameYear = cursor.fiscalYear === dataset.fiscalYear;
  const resumeAt = sameYear && cursor.resourceId ? dataset.resourceIds.indexOf(cursor.resourceId) : -1;
  const first = Math.max(resumeAt, 0);

  let scanned = 0;

  for (let i = first; i < dataset.resourceIds.length; i++) {
    const resourceId = dataset.resourceIds[i]!;
    let offset = i === resumeAt ? (cursor.lastOffset ?? 0) : 0;
    let total = Infinity;

    while (offset < total) {
      const page = await fetch(resourceId, offset, CKAN_PAGE_SIZE, filters);
      total = page.total;

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
      await onPage?.({ resourceId, offset, total, scanned });

      // An empty page means the resource is exhausted, whatever `total` claimed.
      if (page.records.length === 0) break;
    }
  }
}

export const ckanSource: Source = {
  id: SOURCE_ID,
  // The port takes only a cursor, so the adapter resolves the year itself.
  // The ingest service calls discover() directly: it needs the resolved year
  // up front to decide whether its watermark still applies.
  async *discover(cursor: Cursor) {
    yield* discover(await resolveDataset(), cursor);
  },
  listDocuments,
  fetchDocument,
  normalize: normalizeCkanRow,
};

export { SOURCE_ID, normalizeCkanRow, isUsableRow, resolveDataset, type CkanRow, type CkanDataset };
