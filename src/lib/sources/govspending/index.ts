import type { ZipEntry } from "../../extract/unzip.ts";
import { egpListingUrl, isUsableRow } from "../ckan/normalize.ts";
import { COL } from "../ckan/columns.ts";
import type { RawProject } from "../types.ts";
import { listCsvEntries, streamEntry } from "./bulk.ts";
import { toCkanFields } from "./columns.ts";
import { csvRecords } from "./csv.ts";

export { resolveBulk, redactKey, type BulkRef } from "./catalog.ts";
export { ensureBulkFile, type BulkFile, type BulkHead } from "./bulk.ts";

/** Where a scan of one bulk file stopped: a CSV entry, and data rows read from it. */
export type BulkCursor = {
  fiscalYear?: number;
  entry?: string;
  row?: number;
};

export type BulkProgress = { entry: string; row: number; scanned: number };

export type DiscoverBulkDeps = {
  listEntries: (path: string) => Promise<ZipEntry[]>;
  readEntry: (path: string, entry: ZipEntry) => AsyncIterable<string>;
};

const DEFAULT_DEPS: DiscoverBulkDeps = { listEntries: listCsvEntries, readEntry: streamEntry };

// How often progress is reported mid-entry. Each report is a watermark write,
// so this is the most rows an interrupted scan has to re-read.
const PROGRESS_EVERY = 5_000;

/**
 * Every usable row of one fiscal year's bulk file, already re-keyed to CKAN
 * column names (columns.ts), so normalize/classify treat it like any CKAN row.
 * `header` is empty on purpose: these rows are not shifted, so alignRow must
 * leave them alone.
 *
 * Resume: entries before `cursor.entry` are skipped unopened; inside it the
 * first `cursor.row` rows are parsed and discarded — CSV has no seek.
 */
export async function* discoverBulk(
  path: string,
  fiscalYear: number,
  cursor: BulkCursor = {},
  onProgress?: (p: BulkProgress) => Promise<void> | void,
  deps: DiscoverBulkDeps = DEFAULT_DEPS,
): AsyncIterable<RawProject> {
  const entries = await deps.listEntries(path);

  const sameYear = cursor.fiscalYear === fiscalYear;
  const resumeAt = sameYear && cursor.entry ? entries.findIndex((e) => e.name === cursor.entry) : -1;

  let scanned = 0;

  for (let i = Math.max(resumeAt, 0); i < entries.length; i++) {
    const entry = entries[i]!;
    const skip = i === resumeAt ? (cursor.row ?? 0) : 0;
    let row = 0;

    for await (const record of csvRecords(deps.readEntry(path, entry))) {
      row++;
      if (row <= skip) continue;
      scanned++;

      const fields = toCkanFields(record);
      if (isUsableRow(fields)) {
        const projectId = String(fields[COL.projectId] ?? "").trim();
        yield { projectId, sourceUrl: egpListingUrl(projectId), fields, header: [] };
      }

      if (row % PROGRESS_EVERY === 0) await onProgress?.({ entry: entry.name, row, scanned });
    }

    await onProgress?.({ entry: entry.name, row, scanned });
  }
}
