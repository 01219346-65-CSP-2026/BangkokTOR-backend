import type { FetchOutcome } from "./outcome.ts";

// The Source port (§4.2). Everything portal-specific lives behind these five
// members. If an `if (source.id === …)` appears outside an adapter, the port is
// wrong, not the code.

// Resume state, mirrored from the `watermarks` collection. Neither portal
// supports incremental queries, so "what's new" is our state, not theirs.
export type Cursor = {
  lastSeenProjectId?: string;
  lastOffset?: number;
  lastFullScanAt?: Date;
};

// One row exactly as a portal returned it. Deliberately loose — typing Source B's
// Thai columns here would leak its shift defect into the pipeline.
export type RawProject = {
  // CKAN's รหัสโครงการ *is* the e-GP projectId. That join is the whole trick.
  projectId: string;
  sourceUrl?: string;
  fields: Record<string, unknown>;
  // The declared header, when the source has one. Source B ships rows shifted
  // against it, so normalize() cannot realign without knowing what was declared.
  header?: string[];
};

export type DocumentKind = "announcement" | "tor" | "bundle";

export type RawDocument = {
  projectId: string;
  kind: DocumentKind;
  url: string;
  externalId?: string;
  filename?: string;
};

// The normalized shape, typed strictly because it reaches Mongo. Money is THB
// integers, dates are CE — both converted at the adapter edge (§4.5).
// No deadline field: neither source supplies one, FR-13 is still open, don't invent it.
export type CanonicalTor = {
  sourceId: string;
  projectId: string;

  projectName: string;
  agency: string;
  department?: string;

  budget?: number;
  averageBudget?: number;

  procurementMethod?: string;
  goodsCategory?: string;
  province?: string;

  announcedAt?: Date;

  // Provenance — a TOR that can't be traced back isn't publishable (§4.5).
  sourceUrl: string;
  fetchedAt: Date;
};

export type Source = {
  readonly id: string;

  // AsyncIterable, not Promise<RawProject[]>: Source B has 511,606 rows at
  // 32,000 per page. An array holds the whole resource in memory before the
  // caller sees row one, and removes any way to stop early at a watermark.
  discover(cursor: Cursor): AsyncIterable<RawProject>;

  listDocuments(projectId: string): Promise<RawDocument[]>;

  // Returns FetchOutcome rather than throwing — the majority outcome
  // ("no-bundle") is data, not an error, and FR-24 needs failure kinds kept apart.
  fetchDocument(doc: RawDocument, dest: string): Promise<FetchOutcome>;

  // Pure. No I/O, no model import — that's what makes it checkable against a
  // fixture, which is the only way B's phantom-column defect is visible.
  normalize(raw: RawProject): CanonicalTor;
};
