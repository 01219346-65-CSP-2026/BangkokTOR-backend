import {
  MAX_BULLET_CHARS,
  MAX_BULLETS,
  type SummaryBullet,
} from "./types.ts";

// THE FR-19 SCREEN.
//
// Grading enforces FR-11 with `isVerbatim`: a quote either appears in the
// document or it is discarded. Summaries cannot be checked that way — a bullet
// is generated prose, so there is nothing to match it against. What can be
// checked is whether it is making a JUDGEMENT.
//
// "ผู้ยื่นข้อเสนอต้องมีผลงานไม่น้อยกว่า 5 ปี" describes the document.
// "เงื่อนไขนี้กีดกันผู้ประกอบการรายย่อย" accuses the agency that wrote it.
// Only the first shape may be published, which is exactly the distinction
// tor.serialize.ts asks you to make before adding any field.
//
// Be honest about the limit: this is a marker list, not comprehension. It
// catches the phrasings below and nothing else, so it is a floor under the
// prompt rather than a substitute for reading the output. Widen it whenever a
// real generation gets through.

/**
 * Words that turn a description into a verdict.
 *
 * Thai first, because the corpus and the prompt are Thai. English too: the
 * model answers in English often enough when a section is short or mostly
 * numeric, and an English judgement is no less of one.
 */
const EVALUATIVE_MARKERS = [
  // Thai — fairness and competition
  //
  // The จำกัด / ข้อจำกัด group was added after measurement: asked to judge a
  // qualification clause, qwen2.5:7b produced "เงื่อนไขมีข้อจำกัดสูงสำหรับ
  // ผู้ประกอบการรายย่อย" and "จำกัดโอกาสให้ผู้ประกอบการรายย่อย" — both plain
  // verdicts that the original list, built around กีดกัน, let through.
  //
  // Note the cost: a document legitimately saying "ข้อจำกัดของระบบ" loses a
  // point it could have kept. That is the right trade. A dropped point is a
  // gap in a reading aid; a published one is this platform accusing a named
  // government agency.
  "ไม่เป็นธรรม",
  "เป็นธรรมหรือไม่",
  "กีดกัน",
  "เอื้อประโยชน์",
  "เอื้อให้",
  "ล็อกสเปก",
  "ล็อคสเปก",
  "ผูกขาด",
  "ข้อจำกัด",
  "จำกัดโอกาส",
  "จำกัดโอกาสให้",
  "รายย่อย",
  "ตลาดแคบ",
  "แข่งขันน้อย",
  "ลดการแข่งขัน",
  "เสียเปรียบ",
  "ได้เปรียบ",
  // Thai — suspicion and wrongdoing
  "น่าสงสัย",
  "ส่อ",
  "ทุจริต",
  "ฮั้ว",
  "สมยอม",
  "ไม่โปร่งใส",
  // Thai — advice and evaluation
  "ควรระวัง",
  "ข้อควรระวัง",
  "เข้มงวดเกินไป",
  "สูงเกินไป",
  "ผิดปกติ",
  // English — fairness and competition
  "unfair",
  "unfairly",
  "restrict",
  "restricts",
  "restrictive",
  "anti-competitive",
  "anticompetitive",
  "favour",
  "favours",
  "favor",
  "favors",
  "favouritism",
  "favoritism",
  "monopol",
  // English — suspicion and wrongdoing
  "suspicious",
  "suspect",
  "collusion",
  "collusive",
  "rigged",
  "rigging",
  "corrupt",
  "irregular",
  // English — advice and evaluation
  "should",
  "ought to",
  "beware",
  "red flag",
  "excessive",
  "unreasonable",
  "too high",
  "too strict",
] as const;

/**
 * True when a bullet describes the document rather than judging it.
 *
 * Case-insensitive, and substring rather than word-boundary matching: Thai has
 * no word boundaries to anchor on, and the English entries are stems chosen so
 * "restricts"/"restrictive" and "monopoly"/"monopolistic" both land.
 */
export function isDescriptive(text: string): boolean {
  const haystack = text.toLowerCase();
  return !EVALUATIVE_MARKERS.some((marker) => haystack.includes(marker));
}

/**
 * Everything a bullet must survive before it can be stored or served.
 *
 * Order matters: normalise first so a length check measures the text a reader
 * will actually see, then screen, then de-duplicate — the same requirement
 * often appears in two chunks of a bundle, and the model will faithfully report
 * it twice.
 */
export function sanitizeBullets(raw: SummaryBullet[]): SummaryBullet[] {
  const kept: SummaryBullet[] = [];
  const seen = new Set<string>();

  for (const bullet of raw) {
    if (kept.length >= MAX_BULLETS) break;

    const text = typeof bullet.text === "string"
      ? bullet.text.replace(/\s+/g, " ").trim()
      : "";

    if (!text) continue;
    if (text.length > MAX_BULLET_CHARS) continue;
    if (!isDescriptive(text)) continue;

    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    kept.push({ text, chunkIndex: bullet.chunkIndex });
  }

  return kept;
}
