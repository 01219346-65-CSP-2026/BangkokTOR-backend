import { politeFetch } from "../../http/politeClient.ts";
import { env } from "../../../config/env.ts";
import { PHANTOM_COLUMNS } from "./columns.ts";

const CKAN_URL = "https://opend.data.go.th/get-ckan/datastore_search";

// The gateway silently clamps anything larger.
export const CKAN_PAGE_SIZE = 32_000;

export type CkanRow = Record<string, unknown>;

export type CkanPage = {
  total: number;
  records: CkanRow[];
  fields: string[];
};


export async function fetchPage(
  resourceId: string,
  offset: number,
  limit: number = CKAN_PAGE_SIZE,
): Promise<CkanPage> {
  const params = new URLSearchParams({
    resource_id: resourceId,
    limit: String(limit),
    offset: String(offset),
  });

  const response = await politeFetch(
    `${CKAN_URL}?${params}`,
    { headers: { "api-key": env.datagothKey }},
    { timeoutMs: 100_000 },
  )
  const payload = (await response.json()) as {
    result?: {
      total?: number;
      records?: CkanRow[];
      fields?: Array<{ id?: string }>;
    };
  };

  const result = payload.result;
  if (!result?.records) {
    throw new Error(`CKAN returned no records for resource ${resourceId} at offset ${offset}`);
  }

  return {
    total: result.total ?? 0,
    records: result.records,
    fields: (result.fields ?? []).map((f) => f.id ?? "").filter(Boolean)
  }
}

// Return true only when the row is actually shifted.
// shifted row:  populated = 29  →  29 <= 29  →  TRUE, realign it
// clean row:    populated = 32  →  32 <= 29  →  FALSE, leave it alone
// Cause the data last 3 row is missing
export function detectPhantomColumns(
  fields: string[],
  sample: CkanRow | undefined,
): boolean {
  if (!sample || fields.length === 0) return false;

  const declared = PHANTOM_COLUMNS.filter((c) => fields.includes(c));
  if (declared.length === 0) return false;

  const populated = fields.filter((f) => {
    const v = sample[f];
    return v !== undefined && v !== null && v !== "";
  }).length;

  return populated <= fields.length - declared.length;
}


export function realignRow(row: CkanRow, fields: string[]): CkanRow {
  const realFields = fields.filter(
    (f) => !(PHANTOM_COLUMNS as readonly string[]).includes(f),
  );

  const values = fields.map((f) => row[f]).filter((v) => v !== undefined);
  const out: CkanRow = {};
  realFields.forEach((name, i) => {
    out[name] = values[i] ?? null;
  });
  return out;
}
