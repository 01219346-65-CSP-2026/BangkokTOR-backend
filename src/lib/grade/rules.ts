import type { RuleSpec } from "../ai/types.ts";

// The Grading Rulebook as data. Weight and phase are tuning knobs — changing
// how a TOR scores is a table edit here, never a code change.
//
// `definition`, `unfairWhen` and `cues` are not documentation: they are sent to
// the model. Measured 2026-09-08 — naming a rule scored 0/3 on real Thai text,
// defining it scored 3/3. If a rule underperforms, this is the field to fix.

export type RulePhase = "legitimacy" | "fairness";
/** How a rule is decided. Deterministic rules never reach the model. */
export type RuleMethod = "deterministic" | "ai" | "not_checked";

export type Rule = RuleSpec & {
  id: number;
  weight: number;
  phase: RulePhase;
  method: RuleMethod;
};

export const RULES: Rule[] = [
  // ── Phase 1 — legitimacy (weight 16). Failing any of these is grade C. ──
  {
    id: 1,
    code: "IDMISMATCH",
    weight: 4,
    phase: "legitimacy",
    method: "deterministic",
    definition:
      "The agency named in the document does not match the agency on the procurement record.",
    cues: ["หน่วยงาน", "ชื่อหน่วยงาน", "กรม", "เทศบาล", "องค์การบริหารส่วน"],
  },
  {
    id: 2,
    code: "BUDGETMISMATCH",
    weight: 4,
    phase: "legitimacy",
    method: "deterministic",
    definition:
      "The budget stated in the document does not match the budget on the procurement record.",
    cues: ["วงเงิน", "ราคากลาง", "งบประมาณ", "บาท"],
  },
  {
    id: 3,
    code: "NOENTITY",
    weight: 3,
    phase: "legitimacy",
    method: "ai",
    definition:
      "The document does not identify the contracting entity as a registered juristic person — no registration number, tax ID, or juristic-person requirement appears.",
    unfairWhen: undefined,
    cues: ["นิติบุคคล", "ทะเบียน", "เลขประจำตัวผู้เสียภาษี", "จดทะเบียน"],
  },
  {
    id: 4,
    code: "CHANNEL",
    weight: 3,
    phase: "legitimacy",
    method: "ai",
    definition:
      "Bids are routed to a personal or non-official channel — a personal email, LINE ID, or mobile number — instead of the official e-GP e-bidding system.",
    cues: ["ยื่นข้อเสนอ", "gmail", "LINE", "ไลน์", "โทรศัพท์", "อีเมล"],
  },
  {
    id: 5,
    code: "REPUTATION",
    weight: 2,
    phase: "legitimacy",
    // No source in this project provides adverse-media data. Reporting it as
    // unchecked is honest; silently passing it is not. Excluded from the
    // denominator by score.ts.
    method: "not_checked",
    definition: "Adverse reputation signals about the contracting agency.",
    cues: [],
  },

  // ── Phase 2 — fairness (weight 26). All AI, all require a verbatim quote. ──
  {
    id: 6,
    code: "LIABILITY",
    weight: 4,
    phase: "fairness",
    method: "ai",
    definition:
      "A liability clause stating what the contractor must compensate the agency for.",
    unfairWhen:
      "liability is unlimited, uncapped, or extends to damage the contractor did not cause.",
    cues: ["รับผิด", "ความเสียหาย", "ชดใช้", "ความรับผิด"],
  },
  {
    id: 7,
    code: "NODAYSOFF",
    weight: 4,
    phase: "fairness",
    method: "ai",
    definition: "A clause setting the days on which the contractor must work.",
    unfairWhen:
      "work is required every day with no rest days, including public holidays, or continuously 24 hours.",
    cues: ["วันหยุด", "ทุกวัน", "ตลอด 24", "ไม่เว้นวันหยุด", "วันหยุดนักขัตฤกษ์"],
  },
  {
    id: 8,
    code: "HOURS",
    weight: 3,
    phase: "fairness",
    method: "ai",
    definition: "A clause setting the contractor's working hours.",
    unfairWhen:
      "hours are excessive, open-ended, or the contractor must be available at any time without limit.",
    cues: ["ชั่วโมง", "เวลาทำการ", "ปฏิบัติงาน", "ตลอดเวลา"],
  },
  {
    id: 9,
    code: "TERMINATE",
    weight: 3,
    phase: "fairness",
    method: "ai",
    definition: "A clause allowing the contract to be terminated.",
    unfairWhen:
      "the agency may terminate at will, without cause, or without notice, while the contractor may not.",
    cues: ["บอกเลิกสัญญา", "ยกเลิกสัญญา", "เลิกสัญญา"],
  },
  {
    id: 10,
    code: "PENALTY",
    weight: 3,
    phase: "fairness",
    method: "ai",
    definition:
      "A penalty clause stating a monetary fine for late or defective performance.",
    unfairWhen:
      "the daily rate is disproportionate, uncapped, or compounds without limit.",
    cues: ["ค่าปรับ", "ปรับวันละ", "เบี้ยปรับ"],
  },
  {
    id: 11,
    code: "RETENTION",
    weight: 2,
    phase: "fairness",
    method: "ai",
    definition:
      "A clause requiring a performance guarantee or retention of part of the payment.",
    unfairWhen:
      "the retained amount or guarantee is unusually large, or is held for an unusually long period after completion.",
    cues: ["หลักประกัน", "ประกันผลงาน", "ค้ำประกัน", "หลักประกันสัญญา"],
  },
  {
    id: 12,
    code: "PAYTERMS",
    weight: 2,
    phase: "fairness",
    method: "ai",
    definition: "A clause setting when and how the contractor is paid.",
    unfairWhen:
      "payment is due only after an unusually long delay, or is conditional on approval that may be withheld indefinitely.",
    cues: ["การจ่ายเงิน", "ชำระเงิน", "งวดงาน", "จ่ายเงิน"],
  },
  {
    id: 13,
    code: "VAGUE",
    weight: 2,
    phase: "fairness",
    method: "ai",
    definition:
      "A scope-of-work clause whose extent is left to the agency to decide after signing.",
    unfairWhen:
      "the contractor must do additional work 'as the agency deems appropriate' with no defined limit or extra payment.",
    cues: ["ตามที่เห็นสมควร", "ดุลยพินิจ", "ตามความเหมาะสม", "ตามที่กำหนด"],
  },
  {
    id: 14,
    code: "IPGRAB",
    weight: 2,
    phase: "fairness",
    method: "ai",
    definition:
      "A clause assigning ownership of intellectual property created under the contract.",
    unfairWhen:
      "the agency takes all intellectual property including the contractor's pre-existing work or general know-how.",
    cues: ["ลิขสิทธิ์", "ทรัพย์สินทางปัญญา", "กรรมสิทธิ์", "สิทธิบัตร"],
  },
  {
    id: 15,
    code: "CONDITION",
    weight: 1,
    phase: "fairness",
    method: "ai",
    definition: "A precondition the bidder must satisfy to qualify.",
    unfairWhen:
      "the condition is unrelated to the work, or only one supplier could plausibly meet it.",
    cues: ["เงื่อนไข", "ข้อกำหนด", "คุณสมบัติ", "ต้องมี"],
  },
];

export const LEGITIMACY_RULES = RULES.filter((r) => r.phase === "legitimacy");
export const FAIRNESS_RULES = RULES.filter((r) => r.phase === "fairness");
/** Rules the model is asked about. Deterministic and not_checked never go out. */
export const AI_RULES = RULES.filter((r) => r.method === "ai");

export function ruleByCode(code: string): Rule | undefined {
  return RULES.find((r) => r.code === code);
}
