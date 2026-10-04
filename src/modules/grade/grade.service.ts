import type { Types } from "mongoose";
import { createGrader, createSummarizer, sanitizeBullets } from "../../lib/ai/index.ts";
import { isVerbatim, type RuleFinding, type SummaryBullet } from "../../lib/ai/types.ts";
import { AI_RULES, LEGITIMACY_RULES, RULES, ruleByCode } from "../../lib/grade/rules.ts";
import { gradeFindings, skipFairness, type Finding } from "../../lib/grade/score.ts";
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
function checkDeterministic(
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
      evidence: present ? tor.agency : "",
      checked: true,
    });
  } else {
    // No agency on the record: nothing to compare against, so nothing is
    // claimed. Unchecked, never a pass.
    findings.push({ code: "IDMISMATCH", fired: false, evidence: "", checked: false });
  }

  // BUDGETMISMATCH — the figure should appear, allowing for Thai digit grouping
  // and the .00 the portal sometimes carries.
  if (typeof tor.budget === "number" && tor.budget > 0) {
    const digits = haystack.replace(/[,\s]/g, "");
    const whole = String(Math.round(tor.budget));
    const present = digits.includes(whole);
    findings.push({
      code: "BUDGETMISMATCH",
      fired: !present,
      evidence: present ? whole : "",
      checked: true,
    });
  } else {
    findings.push({ code: "BUDGETMISMATCH", fired: false, evidence: "", checked: false });
  }

  return findings;
}

/** Model findings -> scorer findings, dropping anything that fails the gate. */
function toFindings(raw: RuleFinding[], text: string): Finding[] {
  return raw.map((f) => {
    // Second gate. ollama.ts already discards an unverifiable quote, but this
    // is the boundary that writes to the database, so it re-checks rather than
    // trusting a provider to have done it. A fired rule without a real quote
    // is downgraded to not-fired, never stored as a finding.
    const verified = f.fired && f.checked && isVerbatim(f.evidence, text);

    return {
      code: f.code,
      fired: verified,
      evidence: verified ? f.evidence : "",
      // A rule the router never sent anywhere was not evaluated.
      checked: f.checked,
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

  const grader = createGrader();
  const findings: Finding[] = [...checkDeterministic(tor, text)];

  try {
    const legitimacy = await grader.grade({ rules: aiRulesFor("legitimacy"), text });
    findings.push(...toFindings(legitimacy, text));

    // REPUTATION and anything else the rulebook marks not_checked: recorded as
    // unchecked so the scorer leaves it out of the denominator entirely.
    for (const rule of RULES.filter((r) => r.method === "not_checked")) {
      findings.push({ code: rule.code, fired: false, evidence: "", checked: false });
    }

    if (!skipFairness(findings.filter((f) => isLegitimacy(f.code)))) {
      const fairness = await grader.grade({ rules: aiRulesFor("fairness"), text });
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
    bullets = sanitizeBullets(await summarizer.summarize({ text }));
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
        signalCount: findings.filter((f) => f.fired).length,
        legitimacyCheckedAt: new Date(),
      },
    },
  );

  return { ok: true, grade: result.grade };
}

function isLegitimacy(code: string): boolean {
  return LEGITIMACY_RULES.some((r) => r.code === code);
}

/** TORs awaiting a grade or needing a newer grading version. */
export async function findUngraded(limit = 20) {
  return TorModel.find({
    status: "extraction_pending",
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
