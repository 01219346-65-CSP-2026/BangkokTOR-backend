import { env } from "../../../config/env.ts";
import { politeFetch } from "../../http/politeClient.ts";

// Which CKAN resources hold "this year".
//
// data.go.th publishes one package per fiscal year, split into ~10 datastore
// resources, and only months after the year closes (FY2568 appeared 2026-05).
// So "this year" means the newest year it has published, resolved here at the
// start of every discovery run — when FY2569 lands, the next run moves to it
// with no code change.
//
// Metadata lives on the main CKAN API, which needs no key; row data goes
// through the keyed gateway (client.ts).

const CKAN_API = "https://data.go.th/api/3/action";

// The package slugs are inconsistent across years (cgd-contract-2558,
// cdg-contract-2567, egp-contact-2568), so the title is the only stable handle.
export const PACKAGE_TITLE = "ข้อมูลโครงการจัดซื้อจัดจ้างจากระบบการจัดซื้อจัดจ้างภาครัฐ ปีงบประมาณ";

export type CkanDataset = {
  fiscalYear: number;
  packageId: string;
  resourceIds: string[];
};

type CkanResource = { id: string; name?: string; datastore_active?: boolean };
type CkanPackage = { id: string; title?: string; resources?: CkanResource[] };

/** `…ปีงบประมาณ 2568 egp-contact-2568` → 2568. Null for any other package. */
export function fiscalYearFromTitle(title: string | undefined): number | null {
  if (!title?.startsWith(PACKAGE_TITLE)) return null;
  const match = /ปีงบประมาณ\s*(\d{4})/.exec(title);
  return match ? Number(match[1]) : null;
}

/**
 * The package for `pinned`, or the newest one when nothing is pinned. Only
 * resources the datastore can page are kept, in name order
 * (2568-egp-contract-1, -2, …) — natural, so -10 sorts after -9.
 */
export function pickDataset(packages: CkanPackage[], pinned?: number): CkanDataset | null {
  const candidates = packages
    .map((p) => ({ p, year: fiscalYearFromTitle(p.title) }))
    .filter((c): c is { p: CkanPackage; year: number } => c.year !== null)
    .filter((c) => pinned === undefined || c.year === pinned)
    .sort((a, b) => b.year - a.year);

  const best = candidates[0];
  if (!best) return null;

  const resourceIds = (best.p.resources ?? [])
    .filter((r) => r.datastore_active)
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", undefined, { numeric: true }))
    .map((r) => r.id);

  return { fiscalYear: best.year, packageId: best.p.id, resourceIds };
}

export async function resolveDataset(pinned: number | undefined = env.egpFiscalYear): Promise<CkanDataset> {
  const params = new URLSearchParams({ q: PACKAGE_TITLE, rows: "50" });
  const response = await politeFetch(`${CKAN_API}/package_search?${params}`);
  const payload = (await response.json()) as { result?: { results?: CkanPackage[] } };

  const dataset = pickDataset(payload.result?.results ?? [], pinned);
  if (!dataset) {
    throw new Error(
      pinned
        ? `data.go.th has no e-GP package for fiscal year ${pinned}`
        : "data.go.th returned no e-GP fiscal-year packages",
    );
  }
  if (dataset.resourceIds.length === 0) {
    throw new Error(`e-GP package ${dataset.packageId} (FY${dataset.fiscalYear}) has no datastore resources`);
  }
  return dataset;
}
