import { Schema, model, type InferSchemaType, type Types } from "mongoose";
import { WORK_TYPES } from "../../lib/classify/workType.ts";

/**
 * Bangkok's annual budget (ข้อบัญญัติงบประมาณรายจ่ายประจำปี) line by line, as
 * the BMA Budget Office publishes it on data.bangkok.go.th. Written only by
 * `bun run import-budget` (src/import-budget.ts), which replaces a year's
 * lines wholesale — the published workbooks are a snapshot, not a feed.
 *
 * `year` is the Thai fiscal year (Buddhist era): 2570 runs 1 Oct 2026 –
 * 30 Sep 2027. `amount` is that year's appropriation in whole baht.
 */
const budgetLineSchema = new Schema(
  {
    year: { type: Number, required: true },
    /** The workbook's resource number on the portal, e.g. "70026". */
    agencyFile: { type: String, required: true },
    agency: { type: String, required: true, trim: true },
    seq: { type: Number, required: true },
    lineCode: { type: String, required: true },
    expenseCode: { type: String, required: true },
    description: { type: String, default: "" },
    amount: { type: Number, required: true, min: 0 },
    output: { type: String, default: null },
    budgetType: { type: String, enum: ["personnel", "operating", "investment", "subsidy", "other", null], default: null },
    project: {
      type: new Schema(
        {
          code: { type: String, required: true },
          title: { type: String, default: "" },
          details: { type: String, default: "", maxlength: 4000 },
          total: { type: Number, default: null },
        },
        { _id: false },
      ),
      default: null,
    },
    isSoftware: { type: Boolean, default: false },
    softwareScore: { type: Number, default: 0 },
    workTypes: { type: [{ type: String, enum: WORK_TYPES }], default: [] },
  },
  { timestamps: true, versionKey: false },
);

budgetLineSchema.index({ year: 1, agencyFile: 1, seq: 1 }, { unique: true });
budgetLineSchema.index({ year: 1, isSoftware: 1 });

export type BudgetLine = InferSchemaType<typeof budgetLineSchema>;
export type BudgetLineLean = BudgetLine & { _id: Types.ObjectId };
export const BudgetLineModel = model<BudgetLine>("BudgetLine", budgetLineSchema, "budget_lines");

/** One import per fiscal year: where the lines came from and what was left out. */
const budgetImportSchema = new Schema(
  {
    year: { type: Number, required: true, unique: true },
    /** CKAN dataset id on data.bangkok.go.th, e.g. "70-excel". */
    dataset: { type: String, required: true },
    /** "draft" (ร่างข้อบัญญัติ, published June) until the enacted ordinance
     *  (ข้อบัญญัติ) is out — the council trims it by about 1%. */
    status: { type: String, enum: ["draft", "enacted"], required: true },
    sourceUrl: { type: String, required: true },
    importedAt: { type: Date, required: true },
    files: {
      type: [
        new Schema(
          { agencyFile: String, agency: String, lines: Number, unparsed: Number },
          { _id: false },
        ),
      ],
      default: [],
    },
    /** Workbooks not read — an old .xls with no converter, a download error. */
    skipped: {
      type: [new Schema({ agencyFile: String, name: String, reason: String }, { _id: false })],
      default: [],
    },
  },
  { timestamps: true, versionKey: false },
);

export type BudgetImport = InferSchemaType<typeof budgetImportSchema>;
export const BudgetImportModel = model<BudgetImport>("BudgetImport", budgetImportSchema, "budget_imports");
