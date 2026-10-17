import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { connectMongo, disconnectMongo } from "./db/mongo.ts";
import { politeFetch } from "./lib/http/politeClient.ts";
import { readXlsx } from "./lib/xlsx/readXlsx.ts";
import { parseBudgetWorkbook } from "./lib/sources/bmaBudget/parse.ts";
import { classifyBudgetLine } from "./lib/sources/bmaBudget/classify.ts";
import { BudgetImportModel, BudgetLineModel, type BudgetLine } from "./modules/budget/budget.model.ts";

// Bangkok's annual budget, agency by agency, from the BMA Budget Office's
// workbooks on data.bangkok.go.th (CKAN) into `budget_lines`.
//
//   bun run import-budget --year 2570            # download + parse, report only
//   bun run import-budget --year 2570 --apply    # …and replace that year's lines
//   bun run import-budget --year 2570 --dataset <id> --status enacted --apply
//
// The enacted ordinance (ข้อบัญญัติ) reaches the portal months after the
// draft (ร่างข้อบัญญัติ, June); 2569's came out in February. Re-run with the
// enacted dataset's id when it appears — the import replaces the year.
//
// Old binary .xls workbooks (15 of 2570's 77) are converted with LibreOffice
// when `soffice` is installed (brew install --cask libreoffice); without it
// they are skipped and listed, never guessed at.

const PORTAL = "https://data.bangkok.go.th";

/** Known datasets. Pass --dataset to use another (the enacted 2570, say). */
const DATASETS: Record<number, { id: string; status: "draft" | "enacted" }> = {
  2569: { id: "2569", status: "enacted" },
  2570: { id: "70-excel", status: "draft" },
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const year = Number(arg("year"));
if (!Number.isInteger(year) || year < 2560) {
  console.error("Usage: bun run import-budget --year 2570 [--dataset <id>] [--status draft|enacted] [--apply]");
  process.exit(1);
}
const known = DATASETS[year];
const dataset = arg("dataset") ?? known?.id;
const status = (arg("status") ?? known?.status ?? "draft") as "draft" | "enacted";
if (!dataset) {
  console.error(`No dataset known for ${year}; pass --dataset <CKAN id> from ${PORTAL}/dataset.`);
  process.exit(1);
}
const apply = process.argv.includes("--apply");

type Resource = { name: string; format: string; url: string };

const pkg = (await (await politeFetch(`${PORTAL}/api/3/action/package_show?id=${encodeURIComponent(dataset)}`)).json()) as {
  success: boolean;
  result: { title: string; resources: Resource[] };
};
if (!pkg.success) throw new Error(`dataset ${dataset} not found on ${PORTAL}`);
console.log(`${pkg.result.title}  (${dataset}, ${status})`);

// The agency workbooks: "70026 สำนักดิจิทัลกรุงเทพมหานคร", numbered from x007.
// x001–x006 are the revenue estimate, summaries and the strategy plan.
const workbooks = pkg.result.resources
  .map((r) => ({ ...r, code: /^(\d{5})/.exec(r.name.trim())?.[1], format: (r.format ?? "").toLowerCase() }))
  .filter((r): r is Resource & { code: string } => !!r.code && Number(r.code.slice(-3)) >= 7 && ["xlsx", "xls"].includes(r.format));

const dir = join("data", "budget", String(year));
mkdirSync(dir, { recursive: true });

const soffice =
  Bun.which("soffice") ??
  ["/Applications/LibreOffice.app/Contents/MacOS/soffice"].find((p) => existsSync(p)) ??
  null;

const lines: BudgetLine[] = [];
const files: Array<{ agencyFile: string; agency: string; lines: number; unparsed: number }> = [];
const skipped: Array<{ agencyFile: string; name: string; reason: string }> = [];

for (const wb of workbooks) {
  const label = wb.name.replace(/\.(xlsx?|pdf)$/i, "").replace(/^\d{5}\s*/, "").trim();
  const xlsxPath = join(dir, `${wb.code}.xlsx`);

  try {
    if (!existsSync(xlsxPath)) {
      const raw = join(dir, `${wb.code}.${wb.format}`);
      if (!existsSync(raw)) await Bun.write(raw, await (await politeFetch(wb.url)).arrayBuffer());
      if (wb.format === "xls") {
        if (!soffice) {
          skipped.push({ agencyFile: wb.code, name: label, reason: "old .xls — install LibreOffice to convert" });
          continue;
        }
        const run = Bun.spawnSync([soffice, "--headless", "--convert-to", "xlsx", "--outdir", dir, raw]);
        if (run.exitCode !== 0 || !existsSync(xlsxPath)) {
          skipped.push({ agencyFile: wb.code, name: label, reason: `LibreOffice conversion failed (${run.exitCode})` });
          continue;
        }
      }
    }

    const parsed = parseBudgetWorkbook(readXlsx(new Uint8Array(await Bun.file(xlsxPath).arrayBuffer())));
    const agency = parsed.agency ?? label;
    for (const line of parsed.lines) {
      lines.push({
        year,
        agencyFile: wb.code,
        agency,
        ...line,
        ...classifyBudgetLine(line),
      } as BudgetLine);
    }
    files.push({ agencyFile: wb.code, agency, lines: parsed.lines.length, unparsed: parsed.unparsed.length });
  } catch (error) {
    skipped.push({ agencyFile: wb.code, name: label, reason: (error as Error).message.slice(0, 200) });
  }
}

const software = lines.filter((l) => l.isSoftware);
const baht = (n: number) => `฿${n.toLocaleString("en-US")}`;
console.log(
  `\n${files.length} workbooks read, ${skipped.length} skipped.` +
    `\n${lines.length} lines, ${baht(lines.reduce((s, l) => s + l.amount, 0))}.` +
    `\n${software.length} software lines, ${baht(software.reduce((s, l) => s + l.amount, 0))}:`,
);
for (const l of [...software].sort((a, b) => b.amount - a.amount).slice(0, 15)) {
  console.log(`  ${baht(l.amount).padStart(14)}  ${l.agency.slice(0, 26).padEnd(26)}  ${(l.project?.title || l.description).slice(0, 70)}`);
}
const unparsed = files.reduce((s, f) => s + f.unparsed, 0);
if (unparsed) console.log(`\n${unparsed} line codes had no amount the parser could read (mostly salary rows).`);
for (const s of skipped) console.log(`  skipped ${s.agencyFile} ${s.name}: ${s.reason}`);

if (!apply) {
  console.log("\nReport only. Re-run with --apply to replace this year's lines.");
} else {
  await connectMongo();
  await BudgetLineModel.deleteMany({ year });
  if (lines.length) await BudgetLineModel.insertMany(lines, { ordered: false });
  await BudgetImportModel.updateOne(
    { year },
    {
      $set: {
        dataset,
        status,
        sourceUrl: `${PORTAL}/dataset/${dataset}`,
        importedAt: new Date(),
        files,
        skipped,
      },
    },
    { upsert: true },
  );
  console.log(`\nWrote ${lines.length} lines for ${year}.`);
  await disconnectMongo();
}
