import type { FetchOutcome } from "./outcome";

/**
 * The Source port (AGENTS.md §4.2).
 *
 * Everything portal-specific lives behind these five members. The pipeline never
 * learns which portal it is talking to — if an `if (source.id === …)` appears
 * outside an adapter, the port is wrong, not the code.
 */

/**
 * Resume state for one source, mirrored from the `watermarks` collection.
 *
 * Exists because neither portal supports incremental queries: Source A's date
 * filter is broken, Source B has no server-side filtering at all. So "what's
 * new" is our state, not the portal's. Every field is optional — a first run
 * has none of them.
 */
export type Cursor = {
    /** Stop paging when this id is seen again (Source A, publishDateDesc). */
    lastSeenProjectId?: string;
    /** Where the last bulk scan stopped (Source B, 32,000-row pages). */
    lastOffset?: number;
    /** When a complete pass last finished, for deciding a full re-scan. */
    lastFullScanAt?: Date;
};

/**
 * One row exactly as a portal returned it, before any cleaning.
 *
 * Deliberately loose: the two portals agree on almost nothing. Source A serves
 * JSON from an API; Source B serves Thai-named columns that are shifted against
 * their header. Typing those columns here would leak B's defects into the
 * pipeline — that knowledge belongs inside B's adapter.
 */
export type RawProject = {
    /** The join key. CKAN's `รหัสโครงการ` *is* the e-GP projectId. */
    projectId: string;
    /** The listing this row came from, kept for provenance. */
    sourceUrl?: string;
    /** Untouched source fields. The adapter's normalize() is what reads these. */
    fields: Record<string, unknown>;
};

/** What kind of file a document is, which decides how it is fetched. */
export type DocumentKind = "announcement" | "tor" | "bundle";

/** Enough identity to fetch one file and attribute it afterwards. */
export type RawDocument = {
    projectId: string;
    kind: DocumentKind;
    url: string;
    /** Portal-side id where one exists — e.g. Source B's zipId. */
    externalId?: string;
    /** Declared filename, when the portal offers one. Never trusted for a path. */
    filename?: string;
};

/**
 * The normalized shape. This is what reaches Mongo, so it is typed strictly
 * where RawProject is loose.
 *
 * Money is THB integers and dates are CE, both converted at the adapter edge
 * (§4.5) — a Buddhist-era year reaching Mongo is 543 years of silent wrong.
 *
 * There is no deadline field. Neither source supplies one and FR-13 is still
 * open; do not invent it.
 */
export type CanonicalTor = {
    sourceId: string;
    projectId: string;

    projectName: string;
    agency: string;
    department?: string;

    /** THB, integer. Not a float, not a string. */
    budget?: number;
    /** ราคากลาง — THB, integer. */
    averageBudget?: number;

    procurementMethod?: string;
    goodsCategory?: string;
    province?: string;

    /** CE, converted from BE at the adapter edge. */
    announcedAt?: Date;

    /** Provenance — a TOR that cannot be traced back is not publishable (§4.5). */
    sourceUrl: string;
    fetchedAt: Date;
};

/**
 * The port. Three real operations plus an id and a pure normalizer — the only
 * things both portals genuinely share.
 */
export type Source = {
    readonly id: string;

    /**
     * Paged listing on A, bulk scan on B.
     *
     * AsyncIterable, not Promise<RawProject[]>: Source B has 511,606 rows at
     * 32,000 per page, so an array would mean holding the whole resource in
     * memory before the caller sees its first row, and would remove any way to
     * stop early at a known watermark.
     */
    discover(cursor: Cursor): AsyncIterable<RawProject>;

    /** An announcements call on A, a bundle probe on B. */
    listDocuments(projectId: string): Promise<RawDocument[]>;

    /**
     * A direct PDF GET on A, a streamed zip on B.
     *
     * Returns FetchOutcome rather than throwing, because the majority outcome
     * ("no-bundle") is data, not an error, and FR-24 needs the failure kinds
     * kept apart.
     */
    fetchDocument(doc: RawDocument, dest: string): Promise<FetchOutcome>;

    /**
     * Pure. Source row in, canonical fields out, no I/O and no model import —
     * that is what makes it checkable against a saved fixture, which is the
     * only way B's phantom-column defect is visible at all (§4.5).
     */
    normalize(raw: RawProject): CanonicalTor;
};
