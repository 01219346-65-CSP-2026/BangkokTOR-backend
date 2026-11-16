import { isValidObjectId, type Types } from "mongoose";
import { createGrader, createSummarizer, sanitizeBullets } from "../../lib/ai/index.ts";
import { isVerbatim, type RuleFinding, type SummaryBullet } from "../../lib/ai/types.ts";
import { AI_RULES, LEGITIMACY_RULES, RULES, ruleByCode } from "../../lib/grade/rules.ts";
import { gradeFindings, skipFairness, type Finding } from "../../lib/grade/score.ts";
import { thaiDigitsToArabic } from "../../lib/thai/buddhistDate.ts";
import { TorTextModel } from "../extract/torText.model.ts";
import { recordError } from "../ingest/ingest.service.ts";
import { GRADER_VERSION, SUMMARY_VERSION, TorModel } from "../tor/tor.model.ts";

// Stage 6: full text -> findings -> a stored grade.
//
// The deterministic rules never reach the model: they compare the document
// against the CKAN record we already hold, which is both free and exact.

export type GradeOutcome =
  | { ok: true; grade: "A" | "B" | "C"; note?: string }
  | { ok: false; reason: string };

/** Rules the model is asked about, minus the ones already decided. */
function aiRulesFor(phase: "legitimacy" | "fairness") {
  return AI_RULES.filter((r) => r.phase === phase);
}

// IDMISMATCH and BUDGETMISMATCH: the document must agree with the record.
// Both are checked against text we hold, so neither costs a model call.
export function checkDeterministic(
  tor: { agency?: string | null; budget?: number | null },
  haystack: string,
): Finding[] {
  const findings: Finding[] = [];

  // IDMISMATCH — the agency on the record should appear in its own document.
  if (tor.agency) {
    const present = isVerbatim(tor.agency, haystack);
    findings.push({
      code: "IDMISMATCH",
      fired: !present,
      evidence: present ? tor.agency : "ABSENCE",
      checked: true,
      filename: null,
    });
  } else {
    // No agency on the record: nothing to compare against, so nothing is
    // claimed. Unchecked, never a pass.
    findings.push({ code: "IDMISMATCH", fired: false, evidence: "", checked: false, filename: null });
  }

  // BUDGETMISMATCH — the figure should appear, allowing for Thai digit grouping
  // and the .00 the portal sometimes carries.
  if (typeof tor.budget === "number" && tor.budget > 0) {
      const digits = thaiDigitsToArabic(haystack).replace(/[,\s]/g, "");
    const whole = String(Math.round(tor.budget));
    const present = digits.includes(whole);
    findings.push({
      code: "BUDGETMISMATCH",
      fired: !present,
      evidence: present ? whole : "ABSENCE",
      checked: true,
      filename: null,
    });
  } else {
    findings.push({ code: "BUDGETMISMATCH", fired: false, evidence: "", checked: false, filename: null });
  }

  return findings;
}

/** Model findings -> scorer findings, dropping anything that fails the gate. */
export function toFindings(raw: RuleFinding[], text: string): Finding[] {
  return raw.map((f) => {
    // The persistence boundary accepts verbatim quotes or an absence marker
    // for rules that are explicitly absence-based.
    const absenceRule = ruleByCode(f.code)?.absence === true;
    const absenceMarker = absenceRule && f.evidence === "ABSENCE";
    const quoteVerified = isVerbatim(f.evidence, text);
    const evidenceVerified = absenceRule
      ? f.fired
        ? absenceMarker
        : quoteVerified
      : quoteVerified;
    const verified = f.fired && f.checked && evidenceVerified;
    const preserveEvidence = f.checked && evidenceVerified && (f.fired || absenceRule);

    return {
      code: f.code,
      fired: verified,
      evidence: preserveEvidence ? f.evidence : "",
      // A rule the router never sent anywhere was not evaluated.
      checked: f.checked,
      filename: preserveEvidence && !absenceMarker ? f.filename ?? null : null,
      // T16: an unverifiable absence the model asserted stays held for review.
      ...(verified && absenceMarker && f.needsReview ? { needsReview: true } : {}),
    };
  });
}

/**
 * Grade one TOR from its stored full text.
 *
 * Legitimacy runs first and, when it fails, fairness is skipped entirely —
 * that is the rulebook's rule, and it also saves the larger half of the model
 * calls on exactly the documents that need them least.
 */
export async function gradeTor(torId: Types.ObjectId | string): Promise<GradeOutcome> {
  const tor = await TorModel.findById(torId).lean();
  if (!tor) return { ok: false, reason: "tor-not-found" };

  const storedText = await TorTextModel.findOne({ torId }).lean();
  if (!storedText) {
    await TorModel.updateOne(
      { _id: torId },
      { $set: { status: "extraction_incomplete", statusReason: "no-text" } },
    );
    return { ok: false, reason: "no-text" };
  }

  const text = storedText.fullText;
  const files = storedText.files;

  const grader = createGrader();
  const findings: Finding[] = [...checkDeterministic(tor, text)];

  try {
    const legitimacy = await grader.grade({
      rules: aiRulesFor("legitimacy"),
      text,
      files,
    });
    findings.push(...toFindings(legitimacy, text));

    // REPUTATION and anything else the rulebook marks not_checked: recorded as
    // unchecked so the scorer leaves it out of the denominator entirely.
    for (const rule of RULES.filter((r) => r.method === "not_checked")) {
      findings.push({ code: rule.code, fired: false, evidence: "", checked: false, filename: null });
    }

    if (!skipFairness(findings.filter((f) => isLegitimacy(f.code)))) {
      const fairness = await grader.grade({
        rules: aiRulesFor("fairness"),
        text,
        files,
      });
      findings.push(...toFindings(fairness, text));
    }
  } catch (error) {
    await recordError({
      projectId: tor.projectId,
      kind: "grade-failed",
      message: String(error),
    });
    return { ok: false, reason: `grader: ${String(error)}` };
  }

  const result = gradeFindings(findings);

  /*
   * The summary rides along with the grade because gradeTor has already paid
   * for the expensive parts: the text is loaded and the model is warm. A
   * separate worker would need its own queue, heartbeat kind and claim query
   * to re-read the same rows.
   *
   * Its failure is deliberately not the grade's failure. The grade is the
   * auditable artefact — it is defensible to the agency it describes and gets
   * regraded on a version bump. Bullets are a reading aid, and a TOR with none
   * renders perfectly well. So an unreachable or misbehaving model here costs
   * the summary and nothing else.
   */
  const summarizer = createSummarizer();
  let bullets: SummaryBullet[] = [];

  try {
    bullets = sanitizeBullets(await summarizer.summarize({ text, files }));
  } catch (error) {
    await recordError({
      projectId: tor.projectId,
      kind: "summarize-failed",
      message: String(error),
    });
  }

  await TorModel.updateOne(
    { _id: torId },
    {
      $set: {
        grade: result.grade,
        gradeScore: result.score,
        gradePhaseFailed: result.phaseFailed,
        ruleFindings: findings.map((f) => ({
          code: f.code,
          fired: f.fired,
          weight: ruleByCode(f.code)?.weight ?? 0,
          phase: ruleByCode(f.code)?.phase ?? "fairness",
          evidence: f.evidence,
          checked: f.checked,
          filename: f.filename ?? null,
          needsReview: f.needsReview === true,
        })),
        gradedAt: new Date(),
        graderVersion: GRADER_VERSION,
        graderModel: grader.id,
        // The second FR-19 screen, at the DB boundary — the same belt-and-braces
        // as isVerbatim in toFindings above. Nothing reaches this field without
        // passing the descriptive check twice.
        summaryBullets: sanitizeBullets(bullets),
        summarizedAt: bullets.length > 0 ? new Date() : null,
        summaryVersion: SUMMARY_VERSION,
        summaryModel: summarizer.id,
        status: "graded",
        statusReason: null,
        // FR-19 public surface: a neutral count, never the letter.
        // Held findings (T16) are not published, so they are not counted.
        signalCount: countSignals(findings),
        legitimacyCheckedAt: new Date(),
      },
    },
  );

  return { ok: true, grade: result.grade };
}

/** The public signal count: fired, and not waiting on a review (T16). */
export function countSignals(findings: Array<{ fired?: boolean | null; needsReview?: boolean | null }>): number {
  return findings.filter((f) => f.fired && !f.needsReview).length;
}

function isLegitimacy(code: string): boolean {
  return LEGITIMACY_RULES.some((r) => r.code === code);
}

/** TORs awaiting a grade or needing a newer grading version. Only text-backed
 * rows are eligible; TorTextModel is the source of truth for "this TOR has
 * stored full text". */
export async function findUngraded(limit = 20) {
  const textTorIds = await TorTextModel.distinct("torId");

  return TorModel.find({
    _id: { $in: textTorIds },
    status: { $in: ["extraction_pending", "graded"] },
    $or: [{ graderVersion: null }, { graderVersion: { $lt: GRADER_VERSION } }],
  })
    .select("_id projectId")
    .limit(limit)
    .lean();
}

export async function getGradeStatus() {
  const [byGrade, graded, pending] = await Promise.all([
    TorModel.aggregate<{ _id: string | null; n: number }>([
      { $match: { grade: { $ne: null } } },
      { $group: { _id: "$grade", n: { $sum: 1 } } },
    ]),
    TorModel.countDocuments({ status: "graded" }),
    TorModel.countDocuments({ status: "extraction_pending" }),
  ]);

  const grades: Record<string, number> = { A: 0, B: 0, C: 0 };
  for (const g of byGrade) if (g._id) grades[g._id] = g.n;

  return { grades, graded, awaitingGrade: pending, graderVersion: GRADER_VERSION };
}

// ── T16: the absence-review queue ──────────────────────────────────────────
//
// A fired absence finding from the model ("the document does not say X") has
// no quote to verify it against, so a planted instruction could produce one
// unopposed. keepVerifiedFindings marks it needsReview; score.ts leaves it out
// of the grade and the serializers leave it out of the advisory until an admin
// decides here.

export type PendingReview = {
  torId: string;
  projectId: string;
  projectName: string;
  agency: string;
  codes: string[];
  gradedAt: string | null;
};

export async function listPendingReviews(limit = 50): Promise<PendingReview[]> {
  const capped = Math.min(Math.max(Math.trunc(limit) || 50, 1), 200);
  const rows = await TorModel.find({ "ruleFindings.needsReview": true })
    .select("_id projectId projectName agency ruleFindings gradedAt")
    .sort({ gradedAt: 1 })
    .limit(capped)
    .lean();

  return rows.map((row) => ({
    torId: String(row._id),
    projectId: row.projectId,
    projectName: row.projectName,
    agency: row.agency ?? "",
    codes: (row.ruleFindings ?? []).filter((f) => f.needsReview).map((f) => f.code ?? ""),
    gradedAt: row.gradedAt ? row.gradedAt.toISOString() : null,
  }));
}

export type ReviewDecision = "confirm" | "reject";

export type ReviewOutcome =
  | { ok: true; grade: "A" | "B" | "C"; signalCount: number; regradeQueued: boolean }
  | { ok: false; reason: "not-found" | "not-pending" };

/**
 * Resolve one held finding, then re-score from the stored findings.
 *
 *   confirm → the clause really is missing: the finding counts from now on.
 *   reject  → the clause is there: checked, not fired, evidence cleared.
 *
 * A reject can lift a failed legitimacy phase to a pass. Fairness was never
 * asked in that case (skipFairness), so the row is queued for a full regrade
 * rather than published as a B with no fairness evidence behind it.
 */
export async function resolveReview(
  torId: string,
  code: string,
  decision: ReviewDecision,
): Promise<ReviewOutcome> {
  if (!isValidObjectId(torId)) return { ok: false, reason: "not-found" };
  const tor = await TorModel.findById(torId).select("ruleFindings").lean();
  if (!tor) return { ok: false, reason: "not-found" };

  const stored = tor.ruleFindings ?? [];
  const index = stored.findIndex((f) => f.code === code && f.needsReview);
  if (index === -1) return { ok: false, reason: "not-pending" };

  const updated = stored.map((f, i) => {
    if (i !== index) return f;
    return decision === "confirm"
      ? { ...f, needsReview: false }
      : { ...f, fired: false, evidence: "", checked: true, needsReview: false };
  });

  const findings: Finding[] = updated.map((f) => ({
    code: f.code ?? "",
    fired: Boolean(f.fired),
    evidence: f.evidence ?? "",
    checked: f.checked !== false,
    filename: f.filename ?? null,
    needsReview: Boolean(f.needsReview),
  }));
  const result = gradeFindings(findings);
  const fairnessAsked = findings.some((f) => !isLegitimacy(f.code) && ruleByCode(f.code));
  const regradeQueued = result.legitimacy.passed && !fairnessAsked;
  const signalCount = countSignals(findings);

  // Conditioned on the finding still being held, so two admins resolving the
  // same row at once cannot both apply — the second gets "not-pending".
  const write = await TorModel.updateOne(
    { _id: torId, ruleFindings: { $elemMatch: { code, needsReview: true } } },
    {
      $set: {
        ruleFindings: updated,
        grade: result.grade,
        gradeScore: result.score,
        gradePhaseFailed: result.phaseFailed,
        signalCount,
        ...(regradeQueued ? { graderVersion: null } : {}),
      },
    },
  );
  if (write.modifiedCount === 0) return { ok: false, reason: "not-pending" };

  return { ok: true, grade: result.grade, signalCount, regradeQueued };
}
