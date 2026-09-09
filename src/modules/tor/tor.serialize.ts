import { ruleByCode } from "../../lib/grade/rules.ts";
import type { TorLean } from "./tor.model.ts";

// THE FR-19 GATE.
//
// AGENTS.md 1: legitimacy signals are advisory, never accusatory. A public
// "Grade C - Legitimacy Failed" on a named government agency is precisely the
// shape that forbids. The grade IS computed and stored (auditability), but the
// public surface carries only neutral observations.
//
// The frontend already defines the compliant vocabulary in
// ../BangkokTOR-frontend/src/lib/torSignals.ts: {id, tone, titleKey, bodyKey}
// with a notable/routine split. Backend findings JOIN notable; they do not
// replace it.
//
// If you add a field here, ask whether a client could render it as an
// accusation. If it could, it does not belong in this function.

/** Fields that must never reach a guest response. */
const PRIVATE_GRADE_FIELDS = [
  "grade",
  "gradeScore",
  "gradePhaseFailed",
  "ruleFindings",
  "graderVersion",
  "graderModel",
] as const;

export type PublicSignal = {
  id: string;
  tone: "notable" | "routine";
  titleKey: string;
  bodyKey: string;
};

/** A fired rule becomes an observation about the DOCUMENT, not a claim about
 *  the agency. "This contract does not state a termination clause" is a fact;
 *  "this tender is rigged" is an accusation. Only the first shape is produced. */
function toSignal(code: string): PublicSignal | null {
  const rule = ruleByCode(code);
  if (!rule) return null;
  return {
    id: code.toLowerCase(),
    // Everything from the grader is `notable`; `routine` is the frontend's own.
    tone: "notable",
    titleKey: `signals.${code.toLowerCase()}.title`,
    bodyKey: `signals.${code.toLowerCase()}.body`,
  };
}

export type PublicTor = Omit<
  TorLean,
  (typeof PRIVATE_GRADE_FIELDS)[number] | "_id" | "__v"
> & {
  id: string;
  signalCount: number;
  signals: PublicSignal[];
};

/** Guest/public shape. Strips the grade entirely and emits neutral signals. */
export function serialize(tor: TorLean): PublicTor {
  const {
    _id,
    grade: _grade,
    gradeScore: _gradeScore,
    gradePhaseFailed: _phase,
    ruleFindings,
    graderVersion: _gv,
    graderModel: _gm,
    ...rest
  } = tor as TorLean & Record<string, unknown>;

  const fired = (ruleFindings ?? []).filter((f) => f.fired);

  return {
    ...(rest as Omit<TorLean, (typeof PRIVATE_GRADE_FIELDS)[number] | "_id">),
    id: String(_id),
    signalCount: fired.length,
    signals: fired
      .map((f) => toSignal(f.code ?? ""))
      .filter((s): s is PublicSignal => s !== null),
  };
}

/** Team/admin shape: the full grade, on its own route behind authorisation. */
export function serializeGrade(tor: TorLean) {
  return {
    id: String(tor._id),
    projectId: tor.projectId,
    grade: tor.grade,
    gradeScore: tor.gradeScore,
    gradePhaseFailed: tor.gradePhaseFailed,
    gradedAt: tor.gradedAt,
    graderModel: tor.graderModel,
    graderVersion: tor.graderVersion,
    findings: (tor.ruleFindings ?? []).map((f) => ({
      code: f.code,
      fired: f.fired,
      weight: f.weight,
      phase: f.phase,
      checked: f.checked,
      evidence: f.evidence,
      chunkIndex: f.chunkIndex,
    })),
  };
}
