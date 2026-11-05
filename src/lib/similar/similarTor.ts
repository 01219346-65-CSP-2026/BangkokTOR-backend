type SimilarityFields = {
  workTypes?: string[] | null;
  requiredSkills?: Array<{ slug: string }> | null;
  category?: string | null;
  contractType?: string | null;
  budget?: number | null;
};

/* a = [1, 2] b = [2, 3] return = 1/3 elemenets total are the same */
function jaccard(a: string[], b: string[]): number | null {
  if (!a.length || !b.length) return null;

  const left = new Set(a);
  const right = new Set(b);
  const intersection = [...left].filter((x) => right.has(x)).length;
  const union = new Set([...left, ...right]).size;

  return union ? intersection / union : null;
}

/* result 0-100 */
export function similarity(a: SimilarityFields, b: SimilarityFields): number {
  const signals: Array<[number, number | null]> = [
    [
      0.4,
      jaccard(
        (a.workTypes ?? []).filter((x) => x !== "other"),
        (b.workTypes ?? []).filter((x) => x !== "other"),
      ),
    ],
    [
      0.35,
      jaccard(
        (a.requiredSkills ?? []).map((s) => s.slug),
        (b.requiredSkills ?? []).map((s) => s.slug),
      ),
    ],
    [0.1, a.category && b.category ? Number(a.category === b.category) : null],
    [0.1, a.contractType && b.contractType ? Number(a.contractType === b.contractType) : null],
    [
      0.05,
      a.budget != null && b.budget != null
        ? (Math.max(a.budget, b.budget) === 0
            ? 1
            : 1 - Math.abs(a.budget - b.budget) / Math.max(a.budget, b.budget))
        : null,
    ],
  ];

  let score = 0;
  for (const [weight, value] of signals) {
    if (value !== null) {
      score += weight * value;
    }
  }

  return Math.round(score * 100);
}