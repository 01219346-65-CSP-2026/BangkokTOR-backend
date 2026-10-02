import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { assertIngestConfig, env } from "../../config/env.ts";
import { ckanSource, discover, resolveDataset, SOURCE_ID } from "../../lib/sources/ckan/index.ts";
import { BULK_CODE } from "../../lib/sources/govspending/catalog.ts";
import { bulkVersion, headBulk } from "../../lib/sources/govspending/bulk.ts";
import { discoverBulk, ensureBulkFile, resolveBulk } from "../../lib/sources/govspending/index.ts";
import { discoverBma } from "../../lib/sources/bma/discover.ts";
import { checkBidding, refreshBidding } from "../bidding/bidding.service.ts";
import { logLine, type FetchOutcome } from "../../lib/sources/outcome.ts";
import type { RawProject } from "../../lib/sources/types.ts";
import { TorModel } from "../tor/tor.model.ts";
import { DocumentModel } from "./document.model.ts";
import { ErrorModel } from "./error.model.ts";
import { QueueModel, type QueueDoc } from "./queue.model.ts";
import { RunModel } from "./run.model.ts";
import { classifyRaw, isSoftwareCandidate, scopeOf, type Classified } from "./scope.ts";
import { WatermarkModel } from "./watermark.model.ts";

// Services take plain arguments and return plain data (§6) — that is what lets
// a worker or a scheduler call them without an HTTP request in sight.

export type DiscoverOptions = {
  limit?: number;
  resume?: boolean;
  /** BMA audit mode: re-detail held projects too, and use the loosest title bar. */
  full?: boolean;
  /** BMA: override env.bmaLookbackDays for this run. */
  lookbackDays?: number;
  /** BMA: resume the list scan from this page. */
  startPage?: number;
  /** Every row dropped by scope, with why — for the miss report (src/discover.ts). */
  onRejected?: (row: RejectedRow) => void;
};

export type RejectedRow = {
  projectId: string;
  title: string;
  reason: "not-software";
  score: number;
  signals: string;
  method: string | null;
  contractType: string | null;
};

function rejected(c: Classified, reason: RejectedRow["reason"]): RejectedRow {
  return {
    projectId: c.canonical.projectId,
    title: c.canonical.projectName,
    reason,
    score: c.classification.softwareScore,
    signals: c.classification.softwareSignals.map((s) => `${s.rule}${s.weight > 0 ? "+" : ""}${s.weight}`).join(" "),
    method: c.classification.methodId,
    contractType: c.classification.contractType,
  };
}

// Stage ①: read the newest fiscal year, upsert one queue row per SOFTWARE
// project. Everything else is counted and dropped here — see scope.ts.
//
// Three feeds of e-GP projects (env.egpFeed; the default "all" reads
// govspending then bma in one run):
//   bma         — the BMA portal, newest first. The only feed that lists a
//                 project before it has a contract, i.e. while it can be bid
//                 on. Bangkok agencies only.
//   govspending — DGA's bulk export. Current fiscal year, contracted projects.
//   ckan        — data.go.th's datastore. About a year behind; kept for older years.
// All yield rows keyed by CKAN column names, so everything after this point is
// feed-agnostic. Records keep sourceId "ckan-egp" either way: it names the e-GP
// project identity (same ids, same document chain), not the feed.
export async function runDiscovery(options: DiscoverOptions = {}) {
  assertIngestConfig();

  const run = await RunModel.create({ sourceId: SOURCE_ID, kind: "discover" });
  const counts = { scanned: 0, enqueued: 0, skipped: 0, notSoftware: 0, notBiddable: 0, refreshed: 0 };
  const saveCounts = (extra: Record<string, unknown> = {}) =>
    RunModel.updateOne(
      { _id: run._id },
      {
        $set: {
          ...extra,
          "counts.scanned": counts.scanned,
          "counts.enqueued": counts.enqueued,
          "counts.skipped": counts.skipped,
          "counts.notSoftware": counts.notSoftware,
          "counts.refreshed": counts.refreshed,
          "counts.notBiddable": counts.notBiddable,
        },
      },
    );

  // "all" reads the national export first — fast, and a no-op when the
  // published file has not changed — then the slow BMA portal for open tenders.
  const feedNames: Array<"ckan" | "govspending" | "bma"> =
    env.egpFeed === "all" ? ["govspending", "bma"] : [env.egpFeed];

  try {
    let stoppedEarly = false;
    for (const name of feedNames) {
      if (stoppedEarly) break;
      const watermark = await loadWatermark();
      const feed =
        name === "bma"
          ? await openBmaFeed(String(run._id), options)
          : name === "ckan"
            ? await openCkanFeed(watermark, options)
            : await openBulkFeed(watermark, options);

      if (feed.unchanged) {
        console.log(`${name}: unchanged since the last full scan — skipped`);
        continue;
      }
      stoppedEarly = await drain(feed);
      // A limited run read part of the source; it is not a full scan, and the
      // resume point must survive for the next run.
      if (!stoppedEarly) await feed.completed();
    }

    await saveCounts({ status: "finished", finishedAt: new Date(), error: null });

    // Stages move and re-announcements change dates, so every TOR still
    // short of an award is re-checked on each run (NFR-02).
    if (feedNames.includes("bma")) {
      const bidding = await refreshBidding();
      await RunModel.updateOne({ _id: run._id }, { $set: { "counts.biddingChecked": bidding.checked, "counts.open": bidding.open } });
      return { runId: String(run._id), feeds: feedNames, ...counts, bidding };
    }
  } catch (error) {
    await RunModel.updateOne(
      { _id: run._id },
      { $set: { status: "failed", finishedAt: new Date(), error: String(error) } },
    );
    await recordError({
      runId: String(run._id),
      kind: "discover-failed",
      message: String(error),
    });
    throw error;
  }

  return { runId: String(run._id), feeds: feedNames, ...counts };

  /** Classify and enqueue one feed's rows. True when `limit` stopped it early. */
  async function drain(feed: Feed): Promise<boolean> {
    for await (const raw of feed.stream) {
      counts.scanned++;

      // The cheap check first: it rejects ~99% of rows without normalizing them.
      // BMA rows are few and already title-filtered: classify them all, so
      // every rejection reaches the miss report with its score.
      const classified = feed.classifyAll || isSoftwareCandidate(raw) ? classifyRaw(raw) : null;
      if (!classified || scopeOf(classified, feed.fiscalYear) !== "in-scope") {
        counts.notSoftware++;
        // Only rows that were classified are worth reporting; the cheap
        // pre-check rejects millions on the national feeds.
        if (classified) options.onRejected?.(rejected(classified, "not-software"));
      } else if (await refresh(raw, classified)) {
        counts.refreshed++;
      } else if ((await enqueue(raw, String(run._id))) === "enqueued") {
        counts.enqueued++;
      } else {
        // Already queued — most often a second contract row of the same project.
        counts.skipped++;
      }

      if (options.limit && counts.enqueued >= options.limit) return true;
      // A BMA run yields a few hundred rows over many slow minutes; without
      // frequent saves its run record reads zero until the very end.
      if (counts.scanned % (feed.progressEvery ?? 5_000) === 0) await saveCounts();
    }
    await saveCounts();
    return false;
  }
}

type WatermarkLean = Awaited<ReturnType<typeof loadWatermark>>;
const loadWatermark = () => WatermarkModel.findOne({ sourceId: SOURCE_ID }).lean();

type Feed = {
  /** The year the feed was read for. Undefined when rows carry no year (bma). */
  fiscalYear?: number;
  /** Classify every row, skipping the cheap pre-check: rows are few and
   *  already title-filtered, so every rejection reaches the miss report. */
  classifyAll?: boolean;
  /** Save run counts every N rows. Default 5,000 (the national bulk feeds). */
  progressEvery?: number;
  stream: AsyncIterable<RawProject>;
  /** Called once the whole year has been read. */
  completed: () => Promise<void>;
  /** The source has not changed since the last completed scan; nothing to read. */
  unchanged?: boolean;
};

async function setWatermark($set: Record<string, unknown>): Promise<void> {
  await WatermarkModel.updateOne({ sourceId: SOURCE_ID }, { $set }, { upsert: true });
}

/**
 * govspending's bulk zip for the newest year. Downloaded once per published
 * version (resuming a broken download), scanned as a stream, and deleted after
 * a full scan — the watermark keeps its size and date, so the next run knows
 * from a HEAD request whether there is anything new to read.
 */
async function openBulkFeed(watermark: WatermarkLean, options: DiscoverOptions): Promise<Feed> {
  const bulk = await resolveBulk();
  const head = await headBulk(bulk.url);
  const version = bulkVersion(head);

  const noop = async () => {};
  if (options.resume !== false && watermark?.bulkCompletedVersion === version) {
    return { fiscalYear: bulk.fiscalYear, stream: (async function* () {})(), completed: noop, unchanged: true };
  }

  await mkdir(env.sourceDir, { recursive: true });
  const dest = join(env.sourceDir, `${bulk.fiscalYear}-${BULK_CODE}.zip`);

  const sameVersion =
    watermark?.feed === "govspending" &&
    watermark.bulkBytes === head.bytes &&
    watermark.bulkLastModified === head.lastModified;
  const file = await ensureBulkFile(bulk.url, dest);

  // A resume point only means something inside the same published file.
  const cursor =
    options.resume !== false && sameVersion
      ? { fiscalYear: watermark?.fiscalYear ?? undefined, entry: watermark?.entry ?? undefined, row: watermark?.row ?? 0 }
      : {};

  await setWatermark({
    feed: "govspending",
    fiscalYear: bulk.fiscalYear,
    bulkUrl: bulk.url,
    bulkBytes: file.bytes,
    bulkLastModified: file.lastModified,
    ...(sameVersion ? {} : { entry: null, row: 0 }),
  });

  return {
    fiscalYear: bulk.fiscalYear,
    // Persisted every few thousand rows: a 4.4M-row scan WILL be interrupted,
    // and this is what makes it resumable rather than restarted.
    stream: discoverBulk(file.path, bulk.fiscalYear, cursor, ({ entry, row }) => setWatermark({ entry, row })),
    completed: async () => {
      await setWatermark({ lastFullScanAt: new Date(), bulkCompletedVersion: version, entry: null, row: 0 });
      await rm(file.path, { force: true });
      await rm(`${file.path}.version`, { force: true });
    },
  };
}

/**
 * The BMA portal, newest first. Every run reads the whole window — list pages
 * are the cheap part — and details only projects not seen before, so there is
 * no resume point to keep.
 *
 * The window is the site's own: from 1 October of the previous Thai fiscal
 * year (tor.service.ts publicScope shows this FY and last), unless
 * BMA_LOOKBACK_DAYS or --days says otherwise. Every software TOR in Bangkok is
 * kept — open, closed, awarded, and direct awards alike; tor.bidding.ts sorts
 * them into open / upcoming / closed.
 */
export function daysSincePreviousFiscalYear(now: Date = new Date()): number {
  const bkk = new Date(now.getTime() + 7 * 3_600_000);
  const fyStartYear = bkk.getUTCMonth() >= 9 ? bkk.getUTCFullYear() : bkk.getUTCFullYear() - 1;
  const previousStart = Date.UTC(fyStartYear - 1, 9, 1);
  return Math.ceil((now.getTime() - previousStart) / 86_400_000);
}

async function openBmaFeed(runId: string, options: DiscoverOptions): Promise<Feed> {
  // Held already → not re-detailed. Queued but not yet processed counts too.
  const [tors, queued] = await Promise.all([
    TorModel.find({ bmaProjectId: { $ne: null } }, { projectId: 1 }).lean(),
    QueueModel.find({ "payload.bmaProjectId": { $exists: true } }, { projectId: 1 }).lean(),
  ]);
  const held = new Set([...tors, ...queued].map((r) => r.projectId));

  return {
    classifyAll: true,
    // Each row costs seconds of a slow server, so a save per row is noise.
    progressEvery: 1,
    stream: discoverBma({
      lookbackDays: options.lookbackDays ?? env.bmaLookbackDays ?? daysSincePreviousFiscalYear(),
      maxPages: env.bmaMaxPages,
      // The audit re-reads everything, at the loosest bar.
      isHeld: options.full ? undefined : (projectNumber) => held.has(projectNumber),
      minTitleScore: options.full ? 1 : undefined,
      startPage: options.startPage,
      onPage: ({ page, rows, candidates }) =>
        console.log(`bma page ${page}: ${rows} projects, ${candidates} new software candidates`),
      onError: (projectId, error) =>
        recordError({ runId, projectId, kind: "bma-detail-failed", message: String(error) }),
    }),
    // Its own field, not `feed`: one watermark row is shared with the
    // national export, whose resume check reads `feed`. A BMA scan has no
    // cursor to keep — only when it last finished.
    completed: () => setWatermark({ bmaLastFullScanAt: new Date() }),
  };
}

/** data.go.th's CKAN datastore: every resource of the newest package, year-filtered server-side. */
async function openCkanFeed(watermark: WatermarkLean, options: DiscoverOptions): Promise<Feed> {
  const dataset = await resolveDataset();
  const resume = options.resume !== false && watermark?.feed !== "govspending" && watermark?.feed !== "bma";

  return {
    fiscalYear: dataset.fiscalYear,
    stream: discover(
      dataset,
      resume
        ? {
            fiscalYear: watermark?.fiscalYear ?? undefined,
            resourceId: watermark?.resourceId ?? undefined,
            lastOffset: watermark?.lastOffset ?? 0,
          }
        : {},
      ({ resourceId, offset, total }) =>
        setWatermark({ feed: "ckan", fiscalYear: dataset.fiscalYear, resourceId, lastOffset: offset, totalRows: total }),
    ),
    completed: () => setWatermark({ lastFullScanAt: new Date() }),
  };
}

/**
 * A project we already hold gets its portal fields rewritten from the newer
 * row — that is how สถานะโครงการ moves to สิ้นสุดสัญญา on the site after a
 * monthly refresh. Only source facts: pipeline state, documents, grades and
 * skills are untouched. False when there is no TOR yet (the row is enqueued).
 */
async function refresh(raw: RawProject, c: Classified): Promise<boolean> {
  const res = await TorModel.updateOne(
    { sourceId: SOURCE_ID, projectId: raw.projectId },
    { $set: { ...c.canonical, ...c.extras, ...c.classification } },
  );
  return res.matchedCount > 0;
}

// Upsert, not insert: re-discovering a project must not enqueue it twice, and
// must not reset a row a worker already finished.
async function enqueue(raw: RawProject, runId: string): Promise<"enqueued" | "skipped"> {
  const res = await QueueModel.updateOne(
    { sourceId: SOURCE_ID, projectId: raw.projectId },
    {
      $setOnInsert: {
        sourceId: SOURCE_ID,
        projectId: raw.projectId,
        status: "pending",
        attempts: 0,
        payload: raw.fields,
        header: raw.header ?? [],
        sourceUrl: raw.sourceUrl ?? "",
        runId,
      },
    },
    { upsert: true },
  );

  return res.upsertedCount > 0 ? "enqueued" : "skipped";
}

// Stage ②–③: one claimed row. Normalize into `tors`, then try for documents.
//
// The TOR is saved BEFORE the document fetch, deliberately: normalization is
// free and never fails on the network, so a failed download must not cost us
// the structured record we already have.
export async function processRow(
  row: QueueDoc,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const raw: RawProject = {
    projectId: row.projectId,
    sourceUrl: row.sourceUrl ?? undefined,
    fields: (row.payload ?? {}) as Record<string, unknown>,
    header: row.header ?? [],
  };

  // Classify before the write, so every TOR carries it on arrival.
  const classified = classifyRaw(raw);
  const { canonical, extras, classification } = classified;

  // Discovery only enqueues software rows, but a queue row from before that
  // rule (or from a classifier version that has since changed) can still be
  // claimed. Finish it without writing a TOR the website would never show.
  if (scopeOf(classified) !== "in-scope") return { ok: true };

  const tor = await TorModel.findOneAndUpdate(
    { sourceId: canonical.sourceId, projectId: canonical.projectId },
    { $set: { ...canonical, ...extras, ...classification } },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  );

  // An upsert "always" returns a document — except on a write conflict retry,
  // or if something deletes the row between the two operations. Four `tor!`
  // assertions below used to paper over that, which turned a rare null into a
  // TypeError thrown deep inside a detached loop, where the only trace is a
  // console line. Failing as a typed outcome instead keeps it in the queue's
  // retry path.
  if (!tor) {
    await recordError({
      sourceId: SOURCE_ID,
      projectId: row.projectId,
      kind: "tor-upsert-returned-null",
      message: "findOneAndUpdate with upsert returned no document",
    });
    return { ok: false, reason: "tor-upsert-failed" };
  }

  // BMA rows can be bid on: find out where they stand and when bids close.
  // A failure here costs the deadline, not the record — it is recorded and
  // the daily refresh tries again.
  if (tor.bmaProjectId) {
    try {
      await checkBidding(tor);
    } catch (error) {
      await recordError({
        sourceId: SOURCE_ID,
        projectId: row.projectId,
        kind: "bidding-check-failed",
        message: String(error),
      });
    }
  }

  let docs;
  try {
    docs = await ckanSource.listDocuments(row.projectId);
  } catch (error) {
    await recordError({
      sourceId: SOURCE_ID,
      projectId: row.projectId,
      kind: "list-documents-failed",
      message: String(error),
    });
    return { ok: false, reason: `list-documents: ${String(error)}` };
  }

  if (docs.length === 0) {
    // The expected outcome for most projects (responseCode "1"/E0001). Data,
    // not an error — this must never reach ingest_errors.
    await TorModel.updateOne(
      { _id: tor._id },
      { $set: { status: "extraction_incomplete", statusReason: "no-bundle" } },
    );
    return { ok: true };
  }

  await mkdir(env.blobDir, { recursive: true });

  for (const doc of docs) {
    const dest = join(env.blobDir, `${doc.externalId ?? doc.projectId}.zip`);

    let outcome: FetchOutcome;
    try {
      outcome = await ckanSource.fetchDocument(doc, dest);
    } catch (error) {
      // A throw here is a network failure, not a typed outcome — FetchOutcome
      // deliberately has no arm for it. Retry is the caller's business.
      await recordError({
        sourceId: SOURCE_ID,
        projectId: row.projectId,
        kind: "fetch-document-threw",
        message: String(error),
        url: doc.url,
      });
      return { ok: false, reason: `fetch: ${String(error)}` };
    }

    if (!outcome.ok) {
      await recordError({
        sourceId: SOURCE_ID,
        projectId: row.projectId,
        kind: outcome.reason,
        message: logLine(outcome),
        url: doc.url,
      });
      await TorModel.updateOne(
        { _id: tor._id },
        { $set: { status: "extraction_incomplete", statusReason: outcome.reason } },
      );
      // Not a retry: oversize and not-a-zip won't improve on a second attempt.
      return { ok: true };
    }

    await DocumentModel.updateOne(
      { sourceId: SOURCE_ID, projectId: row.projectId, externalId: doc.externalId ?? null },
      {
        $set: {
          torId: tor._id,
          sourceId: SOURCE_ID,
          projectId: row.projectId,
          kind: doc.kind,
          url: doc.url,
          externalId: doc.externalId ?? null,
          filename: doc.filename ?? null,
          sha256: outcome.sha256,
          bytes: outcome.bytes,
          localPath: outcome.path,
          fetchedAt: new Date(),
        },
      },
      { upsert: true },
    );
  }

  await TorModel.updateOne({ _id: tor._id }, { $set: { status: "documents_fetched" } });
  return { ok: true };
}

export async function recordError(input: {
  runId?: string;
  sourceId?: string;
  projectId?: string;
  kind: string;
  message: string;
  status?: number;
  url?: string;
}) {
  await ErrorModel.create({
    runId: input.runId ?? null,
    sourceId: input.sourceId ?? SOURCE_ID,
    projectId: input.projectId ?? null,
    kind: input.kind,
    message: input.message.slice(0, 2000),
    status: input.status ?? null,
    url: input.url ?? null,
  });
}

/** `oversize at 200014417 bytes` → 200014417. Null when the message has another shape. */
export function parseOversizeBytes(message: string | null | undefined): number | null {
  const match = /oversize at (\d+) bytes/.exec(message ?? "");
  return match ? Number(match[1]) : null;
}

export async function getStatus() {
  const [counts, latestRun, watermark, recentErrors, torCount, docCount] = await Promise.all([
    QueueModel.aggregate<{ _id: string; n: number }>([
      { $group: { _id: "$status", n: { $sum: 1 } } },
    ]),
    RunModel.findOne({ sourceId: SOURCE_ID }).sort({ startedAt: -1 }).lean(),
    WatermarkModel.findOne({ sourceId: SOURCE_ID }).lean(),
    ErrorModel.find().sort({ createdAt: -1 }).limit(100).lean(),
    TorModel.countDocuments(),
    DocumentModel.countDocuments(),
  ]);

  const queue: Record<string, number> = { pending: 0, working: 0, done: 0, failed: 0 };
  for (const c of counts) queue[c._id] = c.n;

  return {
    queue,
    tors: torCount,
    documents: docCount,
    watermark: watermark
      ? {
          feed: watermark.feed ?? null,
          fiscalYear: watermark.fiscalYear ?? null,
          lastOffset: watermark.lastOffset,
          totalRows: watermark.totalRows,
          // govspending: the CSV entry and row a scan stopped at.
          entry: watermark.entry ?? null,
          row: watermark.row ?? 0,
          lastFullScanAt: watermark.lastFullScanAt,
        }
      : null,
    latestRun: latestRun
      ? {
          id: String(latestRun._id),
          kind: latestRun.kind,
          status: latestRun.status,
          startedAt: latestRun.startedAt,
          finishedAt: latestRun.finishedAt,
          counts: latestRun.counts,
        }
      : null,
    recentErrors: recentErrors.map((e) => ({
      id: String(e._id),
      kind: e.kind,
      sourceId: e.sourceId,
      projectId: e.projectId,
      message: e.message,
      // The size only survives inside the message string (logLine in
      // outcome.ts), so parse it back out for the dashboard to format.
      bytes: e.kind === "oversize" ? parseOversizeBytes(e.message) : null,
      status: e.status ?? null,
      url: e.url ?? null,
      at: e.createdAt,
    })),
  };
}
