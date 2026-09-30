import { env } from "../../../config/env.ts";
import { politeFetch } from "../../http/politeClient.ts";

// govspending.data.go.th (ภาษีไปไหน, run by DGA) — the national e-GP contract
// data, published through the current fiscal year, where data.go.th's CKAN
// package lags a year behind. Same opend.data.go.th API key.
//
// Why the bulk file and not the e-GP site: process5's announcement search is
// behind a Cloudflare Turnstile challenge. We do not work around that; this is
// the government's own open-data channel for the same records.

export const GOVSPENDING_API = "https://api-govspending.data.go.th/api";

// The export that carries one row per project contract, as a zip of CSVs.
export const BULK_CODE = "egp-contract";

export type BulkRef = { fiscalYear: number; url: string };

type Envelope<T> = { success?: boolean; code?: number; message?: string; data?: T };

/** The key rides in a query string, so it must never reach a log or ingest_errors. */
export function redactKey(text: string, key: string = env.datagothKey): string {
  return key ? text.split(key).join("***") : text;
}

async function getJson<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = `${GOVSPENDING_API}/${path}?${new URLSearchParams(params)}`;
  let response: Response;
  try {
    response = await politeFetch(url);
  } catch (error) {
    throw new Error(redactKey(String(error)));
  }
  const body = (await response.json()) as Envelope<T>;
  if (!body.success || body.data === undefined) {
    throw new Error(`govspending ${path}: ${body.code ?? "?"} ${body.message ?? "no data"}`);
  }
  return body.data;
}

/** The newest year on offer, or `pinned` if it is on offer. Null otherwise. */
export function pickYear(years: number[], pinned?: number): number | null {
  if (pinned !== undefined) return years.includes(pinned) ? pinned : null;
  return years.length ? Math.max(...years) : null;
}

export async function resolveBulk(pinned: number | undefined = env.egpFiscalYear): Promise<BulkRef> {
  const years = await getJson<number[]>("get/api/years", { type: "EGP" });

  const fiscalYear = pickYear(years, pinned);
  if (fiscalYear === null) {
    throw new Error(
      pinned
        ? `govspending has no e-GP bulk file for fiscal year ${pinned} (has ${years.join(", ")})`
        : "govspending listed no e-GP years",
    );
  }

  // Returns a URL to a static zip; the key is only needed to be handed it.
  const url = await getJson<string>("get/api/bulkfile", {
    type: "EGP",
    code: BULK_CODE,
    year: String(fiscalYear),
    user_key: env.datagothKey,
  });

  return { fiscalYear, url };
}
