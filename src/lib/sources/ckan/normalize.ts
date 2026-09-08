import { parseThaiDate, parseThb, thaiDigitsToArabic } from "../../thai/buddhistDate.ts";
import type { CanonicalTor, RawProject } from "../types.ts";
import { detectPhantomColumns, realignRow, type CkanRow } from "./client.ts";
import { COL } from "./columns.ts";

export const SOURCE_ID = "ckan-egp";

// Pure (§4.5): row in, canonical fields out. No I/O, no model import, no clock
// except fetchedAt. That is what makes it checkable against a fixture — which
// is the only way the phantom-column defect is visible at all.

function str(row: CkanRow, key: string): string {
  const value = row[key];
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function strOrNull(row: CkanRow, key: string): string | undefined {
  const value = str(row, key);
  return value === "" || value === "-" ? undefined : value;
}

function num(row: CkanRow, key: string): number | undefined {
  const raw = row[key];
  if (raw === null || raw === undefined || raw === "") return undefined;
  return parseThb(typeof raw === "number" ? raw : String(raw));
}

// Thailand's bounding box — anything outside is a bad row, not a location.
function inThailand(lat: number, lng: number): boolean {
  return lat >= 5 && lat <= 21 && lng >= 96 && lng <= 106;
}


// Prefers the WKT column over the numeric lat/lng pair, which is where the
// header shift does the most damage. Returns undefined rather than a guess — a
// wrong coordinate puts a project in the wrong province.
export function parsePoint(row: CkanRow): { type: "Point"; coordinates: number[] } | undefined {
  const wkt = row[COL.point];
  if (typeof wkt === "string") {
    const match = wkt.match(/POINT\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/i);
    if (match) {
      const lng = Number(match[1]);
      const lat = Number(match[2]);
      if (Number.isFinite(lat) && Number.isFinite(lng) && inThailand(lat, lng)) {
        return { type: "Point", coordinates: [lng, lat] };
      }
    }
  }

  const lat = Number(thaiDigitsToArabic(str(row, COL.lat)));
  const lng = Number(thaiDigitsToArabic(str(row, COL.lng)));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  if (lat === 0 && lng === 0) return undefined;
  if (!inThailand(lat, lng)) return undefined;
  return { type: "Point", coordinates: [lng, lat] };
}

export function egpListingUrl(projectId: string): string {
  return `https://process3.gprocurement.go.th/egp2procmainWeb/jsp/procsearch.sch?announceType=&proj_id=${encodeURIComponent(projectId)}`;
}

// Realign before reading anything past จังหวัด, or a company name is filed as
// a latitude. Everything up to index 15 is unaffected either way.
export function alignRow(raw: CkanRow, fields: string[]): CkanRow {
  return fields.length > 0 && detectPhantomColumns(fields, raw) ? realignRow(raw, fields) : raw;
}

export function normalizeCkanRow(raw: RawProject): CanonicalTor {
  const row = alignRow(raw.fields as CkanRow, raw.header ?? []);

  const projectId = str(row, COL.projectId) || raw.projectId;

  return {
    sourceId: SOURCE_ID,
    projectId,

    projectName: str(row, COL.title),
    agency: str(row, COL.agency),
    department: strOrNull(row, COL.department),

    budget: num(row, COL.budget),
    averageBudget: num(row, COL.referencePrice),

    procurementMethod: strOrNull(row, COL.methodGroup),
    goodsCategory: strOrNull(row, COL.method),
    province: strOrNull(row, COL.province),

    announcedAt: parseThaiDate(str(row, COL.announcedAt)),

    sourceUrl: raw.sourceUrl ?? egpListingUrl(projectId),
    fetchedAt: new Date(),
  };
}

// Extra fields the canonical shape doesn't carry but the Tor model stores.
export function normalizeExtras(raw: RawProject) {
  const row = alignRow(raw.fields as CkanRow, raw.header ?? []);

  return {
    procurementType: strOrNull(row, COL.projectType),
    projectStatus: strOrNull(row, COL.status),
    fiscalYear: num(row, COL.fiscalYear),
    district: strOrNull(row, COL.district),
    subdistrict: strOrNull(row, COL.subdistrict),
    location: parsePoint(row),
    winnerName: strOrNull(row, COL.winnerName),
    winnerTaxId: strOrNull(row, COL.winnerTaxId),
    contractNumber: strOrNull(row, COL.contractNumber),
    contractSignedAt: parseThaiDate(str(row, COL.contractSignedAt)),
    contractEndsAt: parseThaiDate(str(row, COL.contractEndsAt)),
  };
}

// A row with no project id cannot be joined to e-GP and is worthless downstream.
export function isUsableRow(row: CkanRow): boolean {
  return str(row, COL.projectId) !== "" && str(row, COL.title) !== "";
}
