// The /skills page's live preview, computed from real open TORs.
//
// Pure (§4.5): rows and a profile in, the preview out. The service loads the
// open pool (a few hundred rows, slugs only) and hands it here, so one request
// answers "what does this profile reach" AND "what would each extra skill
// add" — the second would otherwise be one list query per skill.
//
// Scoring is listScored's, kept in step on purpose: fitScore = share of a
// TOR's required skills the reader has, half-up rounded; a TOR with no tagged
// skills is null ("can't tell"), never 0.

/** One open TOR, as much of it as the preview needs. */
export type PreviewRow = {
  id: string;
  title: string;
  agency: string | null;
  budget: number | null;
  bidClosesAt: Date | null;
  skills: string[];
};

export type PreviewInput = {
  skills: string[];
  minBudget?: number;
  maxBudget?: number;
  /** Seeds the random fallback, so one page visit sees one stable pick. */
  seed: string;
};

export type PreviewMatch = {
  id: string;
  title: string;
  agency: string | null;
  budget: number | null;
  bidClosesAt: string | null;
  fitScore: number | null;
};

export type ProfilePreviewJSON = {
  /** Size of the open pool every other figure is drawn from. */
  openCount: number;
  reachableCount: number;
  topMatches: PreviewMatch[];
  /** True when nothing scored, so topMatches is a random pick of open TORs. */
  topMatchesAreRandom: boolean;
  /** Unpicked skills that would add the most reachable TORs, best first. */
  suggestions: { slug: string; additionalReach: number }[];
  nudge: { slug: string; additionalReach: number; fitFrom: number; fitTo: number } | null;
};

/** listScored's `moderate` band starts here — the same line the /tor filter draws. */
export const REACHABLE_MIN_FIT = 40;
const TOP_MATCHES = 3;
const SUGGESTIONS = 3;

/** Half-up, like listScored's $floor(x + 0.5) — not Math.round's sign quirks. */
export function fitScore(matched: number, required: number): number | null {
  return required > 0 ? Math.floor((matched / required) * 100 + 0.5) : null;
}

/** A missing budget is not held against a TOR — the data is thin, not the fit. */
function inBudget(row: PreviewRow, input: PreviewInput): boolean {
  if (row.budget === null) return true;
  if (input.minBudget !== undefined && row.budget < input.minBudget) return false;
  if (input.maxBudget !== undefined && row.budget > input.maxBudget) return false;
  return true;
}

/** FNV-1a. Not for security — just a stable shuffle key per (seed, id). */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function toMatch(row: PreviewRow, fit: number | null): PreviewMatch {
  return {
    id: row.id,
    title: row.title,
    agency: row.agency,
    budget: row.budget,
    bidClosesAt: row.bidClosesAt ? row.bidClosesAt.toISOString() : null,
    fitScore: fit,
  };
}

export function buildPreviewFromRows(rows: PreviewRow[], input: PreviewInput): ProfilePreviewJSON {
  const picked = new Set(input.skills);

  let reachableCount = 0;
  let bestFit = 0;
  const scored: { row: PreviewRow; fit: number }[] = [];
  /** slug → in-budget TORs that adding it would tip over the line. */
  const gains = new Map<string, number>();
  /** slug → best fit any in-budget TOR reaches with it added. */
  const bestWith = new Map<string, number>();

  for (const row of rows) {
    if (!inBudget(row, input)) continue;

    const required = row.skills.length;
    const matched = row.skills.filter((slug) => picked.has(slug)).length;
    const fit = fitScore(matched, required);
    if (fit === null) continue;

    if (fit >= REACHABLE_MIN_FIT) reachableCount++;
    if (fit > 0) scored.push({ row, fit });
    bestFit = Math.max(bestFit, fit);

    // What-if, per unpicked slug this TOR asks for. Only slugs a TOR actually
    // requires can move its score, so this is one pass over the rows rather
    // than every vocabulary slug against every row.
    if (picked.size === 0) continue;
    const next = fitScore(matched + 1, required)!;
    for (const slug of new Set(row.skills)) {
      if (picked.has(slug)) continue;
      if (fit < REACHABLE_MIN_FIT && next >= REACHABLE_MIN_FIT) {
        gains.set(slug, (gains.get(slug) ?? 0) + 1);
      }
      bestWith.set(slug, Math.max(bestWith.get(slug) ?? 0, next));
    }
  }

  scored.sort((a, b) => b.fit - a.fit || a.row.id.localeCompare(b.row.id));
  let topMatches = scored.slice(0, TOP_MATCHES).map(({ row, fit }) => toMatch(row, fit));
  const topMatchesAreRandom = topMatches.length === 0;

  if (topMatchesAreRandom) {
    // Nothing scored yet — tagging is thin, or no skills are picked. Show some
    // of what is open instead of an empty rail, drawn from the whole pool so
    // a tight budget can't empty it too.
    topMatches = [...rows]
      .sort((a, b) => hash(input.seed + a.id) - hash(input.seed + b.id) || a.id.localeCompare(b.id))
      .slice(0, TOP_MATCHES)
      .map((row) => toMatch(row, null));
  }

  // Ties break on the slug so the suggestion doesn't flicker between equals.
  const suggestions = [...gains]
    .map(([slug, additionalReach]) => ({ slug, additionalReach }))
    .sort((a, b) => b.additionalReach - a.additionalReach || a.slug.localeCompare(b.slug))
    .slice(0, SUGGESTIONS);

  const first = suggestions[0];
  const nudge = first
    ? {
        ...first,
        fitFrom: bestFit,
        fitTo: Math.max(bestFit, bestWith.get(first.slug) ?? 0),
      }
    : null;

  return {
    openCount: rows.length,
    reachableCount,
    topMatches,
    topMatchesAreRandom,
    suggestions,
    nudge,
  };
}
