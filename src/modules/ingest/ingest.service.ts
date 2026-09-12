import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { assertIngestConfig, env } from "../../config/env.ts";
import { classifyTor } from "../../lib/classify/index.ts";
import { ckanSource, discover, SOURCE_ID } from "../../lib/sources/ckan/index.ts";
import { normalizeExtras } from "../../lib/sources/ckan/normalize.ts";
import { logLine, type FetchOutcome } from "../../lib/sources/outcome.ts";
import type { RawProject } from "../../lib/sources/types.ts";
import { TorModel } from "../tor/tor.model.ts";
import { DocumentModel } from "./document.model.ts";
import { ErrorModel } from "./error.model.ts";
import { QueueModel, type QueueDoc } from "./queue.model.ts";
import { RunModel } from "./run.model.ts";
import { WatermarkModel } from "./watermark.model.ts";

// Services take plain arguments and return plain data (§6) — that is what lets
// a worker or a scheduler call them without an HTTP request in sight.

export type DiscoverOptions = {
  limit?: number;
  resume?: boolean;
};

// Stage ①: page the source, upsert one queue row per project.
export async function runDiscovery(options: DiscoverOptions = {}) {
  assertIngestConfig();

  const run = await RunModel.create({ sourceId: SOURCE_ID, kind: "discover" });

  const watermark = options.resume
    ? await WatermarkModel.findOne({ sourceId: SOURCE_ID }).lean()
    : null;

  let scanned = 0;
  let enqueued = 0;
  let skipped = 0;

  try {
    const stream = discover(
      { lastOffset: watermark?.lastOffset ?? 0 },
      async ({ offset, total }) => {
        // Persisted per page: a 511k-row scan WILL be interrupted, and this is
        // the only thing that makes it resumable rather than restarted.
        await WatermarkModel.updateOne(
          { sourceId: SOURCE_ID },
          { $set: { lastOffset: offset, totalRows: total } },
          { upsert: true },
        );
      },
    );

    for await (const raw of stream) {
      scanned++;

      const result = await enqueue(raw, String(run._id));
      if (result === "enqueued") enqueued++;
      else skipped++;

      if (options.limit && enqueued >= options.limit) break;

      if (scanned % 5_000 === 0) {
        await RunModel.updateOne(
          { _id: run._id },
          {
            $set: {
              "counts.scanned": scanned,
              "counts.enqueued": enqueued,
              "counts.skipped": skipped,
            },
          },
        );
      }
    }

    await RunModel.updateOne(
      { _id: run._id },
      {
        $set: {
          status: "finished",
          finishedAt: new Date(),
          "counts.scanned": scanned,
          "counts.enqueued": enqueued,
          "counts.skipped": skipped,
        },
      },
    );

    await WatermarkModel.updateOne(
      { sourceId: SOURCE_ID },
      { $set: { lastFullScanAt: new Date() } },
      { upsert: true },
    );
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

  return { runId: String(run._id), scanned, enqueued, skipped };
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

  const canonical = ckanSource.normalize(raw);
  const extras = normalizeExtras(raw);

  // Classify before the write: portal Thai free text into the vocabulary the
  // dashboard filters by. Pure and free, so every TOR carries it on arrival.
  const classification = classifyTor({
    projectName: canonical.projectName,
    goodsCategory: canonical.goodsCategory,
    procurementType: extras.procurementType,
    procurementMethod: canonical.procurementMethod,
    projectStatus: extras.projectStatus,
  });

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

export async function getStatus() {
  const [counts, latestRun, watermark, recentErrors, torCount, docCount] = await Promise.all([
    QueueModel.aggregate<{ _id: string; n: number }>([
      { $group: { _id: "$status", n: { $sum: 1 } } },
    ]),
    RunModel.findOne({ sourceId: SOURCE_ID }).sort({ startedAt: -1 }).lean(),
    WatermarkModel.findOne({ sourceId: SOURCE_ID }).lean(),
    ErrorModel.find().sort({ createdAt: -1 }).limit(20).lean(),
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
          lastOffset: watermark.lastOffset,
          totalRows: watermark.totalRows,
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
      projectId: e.projectId,
      message: e.message,
      at: e.createdAt,
    })),
  };
}
