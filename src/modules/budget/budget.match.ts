// Which TOR spends which budget line.
//
// Pure (§4.5). The budget says "สำนักดิจิทัล has ฿12.84M this year for the
// BMA e-Service Smart Portal"; months later a TOR appears for it. Nothing in
// either record points at the other, so this matches them on three things:
//
//  1. the same agency — the line's สำนัก/สำนักงานเขต is the TOR's agency or
//     named in its department (national rows file BMA units under
//     agency "กรุงเทพมหานคร" with the unit in department);
//  2. a similar name — Dice overlap of character bigrams, after removing the
//     words every line and title share (ค่าใช้จ่าย, โครงการ, จ้าง…). Thai has
//     no spaces between words, so word overlap would not work;
//  3. a fitting amount — a TOR's budget is at most what was appropriated,
//     usually close to it. For a multi-year project the TOR is often for the
//     whole project, so the project total counts as a fit too.
//
// Each TOR spends at most one line (the best); a line can be spent by several
// TORs (split into lots). A line with a TOR is "tendered".

export type MatchLine = {
  id: string;
  agency: string;
  description: string;
  projectTitle?: string | null;
  projectTotal?: number | null;
  amount: number;
};

export type MatchTor = {
  id: string;
  title: string;
  agency: string | null;
  department: string | null;
  budget: number | null;
  announcedAt: Date | null;
};

export type LineMatch = {
  lineId: string;
  tors: Array<{ id: string; budget: number | null; announcedAt: Date | null; score: number }>;
  /** What the TORs account for, capped at the line's amount. A TOR with no
   *  budget recorded counts as the whole line. */
  tenderedAmount: number;
  /** The first TOR's announcement — when the line turned into a tender. */
  firstAnnouncedAt: Date | null;
};

export const MIN_TITLE_SIMILARITY = 0.3;
export const MIN_SCORE = 0.45;

const squash = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, "").trim();

/** Same agency: equal names, or the unit named inside the TOR's department. */
export function sameAgency(lineAgency: string, tor: Pick<MatchTor, "agency" | "department">): boolean {
  const unit = squash(lineAgency);
  if (!unit) return false;
  const agency = squash(tor.agency);
  const department = squash(tor.department);
  return agency === unit || (department.length > 0 && department.includes(unit)) || (agency.length > 0 && agency.includes(unit));
}

/** Words every budget line and TOR title carry; they would make everything
 *  look alike. Longest first so "ค่าใช้จ่ายในการ" goes before "ค่าใช้จ่าย". */
const FILLER = [
  "ด้วยวิธีประกวดราคาอิเล็กทรอนิกส์",
  "ค่าใช้จ่ายโครงการ",
  "ค่าใช้จ่ายในการ",
  "ของกรุงเทพมหานคร",
  "ประกวดราคาซื้อ",
  "ประกวดราคาจ้าง",
  "กรุงเทพมหานคร",
  "ค่าใช้จ่าย",
  "ประกวดราคา",
  "(e-bidding)",
  "จัดซื้อ",
  "จัดจ้าง",
  "โครงการ",
  "ค่าจ้าง",
  "ระบบ",
  "จ้าง",
  "ซื้อ",
];

export function normalizeTitle(text: string): string {
  let s = text.toLowerCase().replace(/\(\d+\)|\d+\.\s/g, " ");
  for (const word of FILLER) s = s.split(word).join(" ");
  return s.replace(/[\s()\-–,.:;"'“”]+/g, "");
}

function bigrams(s: string): Set<string> {
  const chars = [...s];
  const out = new Set<string>();
  for (let i = 0; i < chars.length - 1; i++) out.add(chars[i]! + chars[i + 1]!);
  return out;
}

/** Dice coefficient of character bigrams, 0–1. */
export function titleSimilarity(a: string, b: string): number {
  const x = bigrams(normalizeTitle(a));
  const y = bigrams(normalizeTitle(b));
  if (x.size === 0 || y.size === 0) return 0;
  let common = 0;
  for (const g of x) if (y.has(g)) common++;
  return (2 * common) / (x.size + y.size);
}

/** 1 when the TOR's budget equals the line (or its project's total), falling
 *  to 0 at half of it; 0 above it (a TOR can't spend more than appropriated,
 *  with 5% slack for rounding). Unknown budget: 0.5, no evidence either way. */
export function amountFit(torBudget: number | null, line: Pick<MatchLine, "amount" | "projectTotal">): number {
  if (torBudget === null || torBudget <= 0) return 0.5;
  const fit = (target: number | null | undefined) => {
    if (!target || target <= 0) return 0;
    const ratio = torBudget / target;
    if (ratio > 1.05 || ratio < 0.5) return 0;
    return ratio >= 1 ? 1 : (ratio - 0.5) / 0.5;
  };
  return Math.max(fit(line.amount), fit(line.projectTotal));
}

export function matchScore(line: MatchLine, tor: MatchTor): number {
  if (!sameAgency(line.agency, tor)) return 0;
  const name = [line.projectTitle, line.description].filter(Boolean).join(" ");
  const title = titleSimilarity(name, tor.title);
  if (title < MIN_TITLE_SIMILARITY) return 0;
  return 0.65 * title + 0.35 * amountFit(tor.budget, line);
}

/** Every line's TORs. Lines with none are left out. */
export function matchBudget(lines: MatchLine[], tors: MatchTor[]): Map<string, LineMatch> {
  const pairs: Array<{ line: MatchLine; tor: MatchTor; score: number }> = [];
  for (const line of lines) {
    for (const tor of tors) {
      const score = matchScore(line, tor);
      if (score >= MIN_SCORE) pairs.push({ line, tor, score });
    }
  }
  pairs.sort((a, b) => b.score - a.score || a.tor.id.localeCompare(b.tor.id));

  const byId = new Map(lines.map((l) => [l.id, l]));
  const usedTors = new Set<string>();
  const out = new Map<string, LineMatch>();
  for (const { line, tor, score } of pairs) {
    if (usedTors.has(tor.id)) continue;
    usedTors.add(tor.id);
    const m = out.get(line.id) ?? { lineId: line.id, tors: [], tenderedAmount: 0, firstAnnouncedAt: null };
    m.tors.push({ id: tor.id, budget: tor.budget, announcedAt: tor.announcedAt, score: Math.round(score * 100) / 100 });
    out.set(line.id, m);
  }

  for (const [id, m] of out) {
    const line = byId.get(id)!;
    const spent = m.tors.some((t) => t.budget === null) ? line.amount : m.tors.reduce((s, t) => s + (t.budget ?? 0), 0);
    m.tenderedAmount = Math.min(line.amount, spent);
    const dates = m.tors.map((t) => t.announcedAt).filter((d): d is Date => d !== null);
    m.firstAnnouncedAt = dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null;
  }
  return out;
}
