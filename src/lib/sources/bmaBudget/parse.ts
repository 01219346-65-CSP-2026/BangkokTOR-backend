import type { Sheet } from "../../xlsx/readXlsx.ts";

// One BMA agency's budget workbook (data.bangkok.go.th, ข้อบัญญัติงบประมาณ
// รายจ่ายประจำปี — one file per สำนัก / สำนักงานเขต) → its line items.
//
// Pure: sheets in, lines out. The shape, read off the 2569/2570 files (the
// "รายละเอียด…" sheet), in the digital office's columns:
//
//   B  ผลผลิตระบบเทคโนโลยีสารสนเทศและการสื่อสาร  F 768296669   ← output
//   B  2. งบรายจ่ายอื่น                          E 208728269   ← budget type
//   C  07199-8   D (1) ค่าใช้จ่ายในการจัดหาระบบคอมพิวเตอร์     ← a line starts
//                D สำหรับปรับปรุงและทดแทนระบบทะเบียน …          ← continues
//                D … และบางแค)                     G 36275860 H บาท  ← amount ends it
//   B  0103002-69-01  D โครงการจ้างใช้บริการ…                 ← multi-year project
//                D วัตถุประสงค์ …                              ← title ends
//   C  03299-3   D ค่าจ้างใช้บริการ…               G 29453000   ← this year's line
//                D งบประมาณทั้งสิ้น                E 114000000  ← project total
//
// The COLUMNS move from file to file (descriptions in D, E or F; amounts in
// G, H or L), so nothing here names a column. A line code is whatever cell
// reads NNNNN-n; the description column is where the first line's text sits;
// a row that starts left of it is structure; an amount is the number just
// before the บาท cell.
//
// A line's amount is THIS fiscal year's appropriation. Structure rows carry
// subtotals; they are context here, never lines, so nothing is counted twice.

export type BudgetTypeId = "personnel" | "operating" | "investment" | "subsidy" | "other";

export type ParsedLine = {
  /** Position in the workbook — stable across re-imports of the same file. */
  seq: number;
  /** "07199-8" — expense code + item number, as printed in column C. */
  lineCode: string;
  /** "07199" — the BMA expense classification (รหัสรายจ่ายย่อย). */
  expenseCode: string;
  description: string;
  /** Whole baht, this fiscal year. */
  amount: number;
  /** The ผลผลิต (output) it sits under, without the word ผลผลิต. */
  output: string | null;
  budgetType: BudgetTypeId | null;
  /** Set when the line funds a multi-year project (รายการผูกพัน). `details`
   *  is the block's objectives/scope text — "Mobile Application" often only
   *  appears there, never in the title. */
  project: { code: string; title: string; details: string; total: number | null } | null;
};

export type ParsedWorkbook = {
  /** The agency as the workbook names it, e.g. "สำนักดิจิทัลกรุงเทพมหานคร". */
  agency: string | null;
  lines: ParsedLine[];
  /** Line codes whose amount never appeared — a layout the parser missed. */
  unparsed: string[];
};

const LINE_CODE = /^(\d{5})-\d+$/;
const PROJECT_CODE = /^\d{7}-\d{2}-\d{2}$/;
const AMOUNT = /^\d{1,13}$/;
const UNIT = /^บาท$/;
/** Headings inside a project block that end its (multi-row) title. */
const PROJECT_TITLE_END = /^(วัตถุประสงค์|ระยะเวลา|เป้าหมาย|งานที่จะทำ|เงิน|งบประมาณ|ปี\s*\d{4})/;

const BUDGET_TYPES: Array<[RegExp, BudgetTypeId]> = [
  [/งบบุคลากร/, "personnel"],
  [/งบดำเนินงาน/, "operating"],
  [/งบลงทุน/, "investment"],
  [/งบเงินอุดหนุน|งบอุดหนุน/, "subsidy"],
  [/งบรายจ่ายอื่น/, "other"],
];

type Cell = { col: number; text: string };

/** "A" → 0, "Z" → 25, "AA" → 26. */
export function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function cellsOf(row: Record<string, string>): Cell[] {
  return Object.entries(row)
    .map(([col, text]) => ({ col: columnIndex(col), text: text.trim() }))
    .filter((c) => c.text)
    .sort((a, b) => a.col - b.col);
}

const isAmount = (text: string) => AMOUNT.test(text.replace(/,/g, ""));
const isWords = (text: string) => !isAmount(text) && !UNIT.test(text) && text !== "-";

/** The number just left of the บาท cell, or the row's last number. */
function rowAmount(cells: Cell[]): number | null {
  const unit = cells.findIndex((c) => UNIT.test(c.text));
  const candidates = unit >= 0 ? cells.slice(0, unit) : cells;
  for (let i = candidates.length - 1; i >= 0; i--) {
    const t = candidates[i]!.text.replace(/,/g, "");
    if (AMOUNT.test(t)) return Number(t);
  }
  return null;
}

/** The sheet that holds the line items: the one with the most line codes
 *  (its name varies: "รายละเอียด", "รายละเอียดตามงบรายจ่าย", "6 รายละเอียด (2)"). */
export function detailSheet(sheets: Sheet[]): Sheet | null {
  let best: Sheet | null = null;
  let bestCount = 0;
  for (const sheet of sheets) {
    const n = sheet.rows.filter((r) => Object.values(r).some((v) => LINE_CODE.test(v.trim()))).length;
    if (n > bestCount) [best, bestCount] = [sheet, n];
  }
  return best;
}

const squashSpaces = (s: string) => s.replace(/\s+/g, " ").trim();

export function parseBudgetWorkbook(sheets: Sheet[]): ParsedWorkbook {
  const sheet = detailSheet(sheets);
  if (!sheet) return { agency: null, lines: [], unparsed: [] };

  const firstText = sheet.rows[0] ? cellsOf(sheet.rows[0]).find((c) => isWords(c.text)) : undefined;
  const agency = firstText?.text ?? null;

  const lines: ParsedLine[] = [];
  const unparsed: string[] = [];
  let output: string | null = null;
  let budgetType: BudgetTypeId | null = null;
  let project: ParsedLine["project"] = null;
  let collectingTitle = false;
  let pending: Omit<ParsedLine, "amount" | "seq"> | null = null;
  let seq = 0;
  // Where descriptions sit; learned from the first line, D until then.
  let descCol = 3;

  const drop = () => {
    if (pending) unparsed.push(pending.lineCode);
    pending = null;
  };
  const finish = (amount: number) => {
    lines.push({ ...pending!, description: squashSpaces(pending!.description), amount, seq: seq++ });
    pending = null;
  };

  for (const row of sheet.rows) {
    const cells = cellsOf(row);
    const amount = rowAmount(cells);

    // A line starts. Its amount may be on this row or a later one.
    const codeAt = cells.findIndex((c) => LINE_CODE.test(c.text));
    if (codeAt >= 0) {
      drop();
      collectingTitle = false;
      const code = cells[codeAt]!;
      const words = cells.slice(codeAt + 1).filter((c) => isWords(c.text));
      if (words[0]) descCol = words[0].col;
      pending = {
        lineCode: code.text,
        expenseCode: LINE_CODE.exec(code.text)![1]!,
        description: words.map((c) => c.text).join(" "),
        output,
        budgetType,
        project: project
          ? { ...project, title: squashSpaces(project.title), details: squashSpaces(project.details) }
          : null,
      };
      if (amount !== null) finish(amount);
      continue;
    }

    const lead = cells.find((c) => isWords(c.text));
    if (!lead) {
      // Numbers only: the amount for a description that ended a row early.
      if (pending && amount !== null) finish(amount);
      continue;
    }

    // Structure: an output, a budget type, a project, or a heading.
    if (lead.col < descCol) {
      drop();
      if (PROJECT_CODE.test(lead.text)) {
        const title = cells.filter((c) => c.col > lead.col && isWords(c.text)).map((c) => c.text).join(" ");
        project = { code: lead.text, title, details: "", total: null };
        collectingTitle = true;
        continue;
      }
      project = null;
      collectingTitle = false;
      if (lead.text.startsWith("ผลผลิต")) {
        output = squashSpaces(lead.text.replace(/^ผลผลิต\s*:?\s*/, "")) || null;
        budgetType = null;
        continue;
      }
      const type = BUDGET_TYPES.find(([re]) => re.test(lead.text));
      if (type) budgetType = type[1];
      continue;
    }

    // At or right of the description column: a project's total, its title
    // running on, or a line's description running on to its amount.
    if (project && /^งบประมาณทั้งสิ้น/.test(lead.text)) {
      if (amount !== null && amount > 0) {
        project.total = amount;
        const last = lines.at(-1);
        if (last?.project?.code === project.code) last.project.total = amount;
      }
      continue;
    }
    if (project && !pending) {
      if (collectingTitle && PROJECT_TITLE_END.test(lead.text)) collectingTitle = false;
      if (collectingTitle) project.title += lead.text;
      else project.details += ` ${lead.text}`;
      continue;
    }
    if (pending) {
      pending.description += cells.filter((c) => isWords(c.text)).map((c) => c.text).join(" ");
      if (amount !== null) finish(amount);
    }
  }
  drop();

  return { agency, lines, unparsed };
}
