import { describe, expect, test } from "bun:test";
import {
  MAX_DIGEST_ITEMS,
  buildMatchDigest,
  escapeHtml,
  groupByUser,
  shouldEmail,
  torLink,
  type DigestItem,
  type PendingRow,
} from "./notification.email.ts";

// SPEC for Part B (SCRUM-77) — what the email says, and to whom.
// Run with:   bun test src/modules/notification/notification.email.test.ts

const APP = "https://bangkoktor.example";
const item = (torId: string, title: string, fitScore: number | null = 80): DigestItem => ({ torId, title, fitScore });

describe("step B2: helpers", () => {
  test("escapeHtml makes portal text safe inside HTML", () => {
    expect(escapeHtml(`<script>alert("x")</script> & 'y'`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;",
    );
    expect(escapeHtml("จ้างพัฒนาระบบ")).toBe("จ้างพัฒนาระบบ");
  });

  test("torLink: one slash, id encoded", () => {
    expect(torLink(APP, "abc")).toBe("https://bangkoktor.example/tor/abc");
    expect(torLink(`${APP}/`, "abc")).toBe("https://bangkoktor.example/tor/abc");
    expect(torLink(APP, "a/b")).toBe("https://bangkoktor.example/tor/a%2Fb");
  });

  test("groupByUser: one entry per user, rows in their original order", () => {
    const row = (id: string, userId: string): PendingRow => ({ id, userId, torId: `t${id}`, title: id, fitScore: 50 });
    const groups = groupByUser([row("1", "u1"), row("2", "u2"), row("3", "u1")]);
    expect([...groups.keys()]).toEqual(["u1", "u2"]);
    expect(groups.get("u1")!.map((r) => r.id)).toEqual(["1", "3"]);
  });

  test("shouldEmail: needs an address, and must not have switched matches off", () => {
    expect(shouldEmail({ email: "a@b.co", name: null, onMatch: true })).toBe(true);
    expect(shouldEmail({ email: "a@b.co", name: null, onMatch: null })).toBe(true); // never chose → default on
    expect(shouldEmail({ email: "a@b.co", name: null, onMatch: false })).toBe(false);
    expect(shouldEmail({ email: null, name: null, onMatch: true })).toBe(false);
    expect(shouldEmail({ email: "", name: null, onMatch: true })).toBe(false);
    expect(shouldEmail(null)).toBe(false); // user deleted since matching
  });
});

describe("step B3: buildMatchDigest", () => {
  test("one TOR: its title is in the subject, and the email links to it", () => {
    const mail = buildMatchDigest("a@b.co", "Kelvin", [item("t1", "จ้างพัฒนาระบบบริการ", 75)], APP);
    expect(mail.to).toBe("a@b.co");
    expect(mail.subject).toContain("จ้างพัฒนาระบบบริการ");
    expect(mail.text).toContain("Kelvin");
    expect(mail.text).toContain(`${APP}/tor/t1`);
    expect(mail.text).toContain("75%");
    expect(mail.html).toContain(`href="${APP}/tor/t1"`);
  });

  test("several TORs: the count is in the subject; best fit listed first", () => {
    const mail = buildMatchDigest("a@b.co", null, [item("low", "ต่ำ", 45), item("high", "สูง", 90)], APP);
    expect(mail.subject).toContain("2");
    expect(mail.text.indexOf("สูง")).toBeLessThan(mail.text.indexOf("ต่ำ"));
  });

  test("a very long title is cut in the subject, not in the body", () => {
    const long = "ก".repeat(300);
    const mail = buildMatchDigest("a@b.co", null, [item("t1", long)], APP);
    expect(mail.subject.length).toBeLessThan(120);
    expect(mail.text).toContain(long);
  });

  test(`at most ${MAX_DIGEST_ITEMS} listed; the rest are a link to /notifications`, () => {
    const many = Array.from({ length: MAX_DIGEST_ITEMS + 3 }, (_, i) => item(`t${i}`, `TOR ${i}`, 50));
    const mail = buildMatchDigest("a@b.co", null, many, APP);
    expect(mail.text.split(`${APP}/tor/`).length - 1).toBe(MAX_DIGEST_ITEMS);
    expect(mail.text).toContain("3");
    expect(mail.text).toContain(`${APP}/notifications`);
  });

  test("every email says where to turn this off", () => {
    const mail = buildMatchDigest("a@b.co", null, [item("t1", "x")], APP);
    expect(mail.text).toContain(`${APP}/skills`);
    expect(mail.html).toContain(`${APP}/skills`);
  });

  test("a title with HTML in it is escaped in the HTML part (and left as-is in text)", () => {
    const mail = buildMatchDigest("a@b.co", "<b>Eve</b>", [item("t1", `<img src=x onerror="steal()">`)], APP);
    expect(mail.html).not.toContain("<img");
    expect(mail.html).not.toContain("<b>Eve</b>");
    expect(mail.html).toContain("&lt;img");
    expect(mail.text).toContain(`<img src=x onerror="steal()">`);
  });

  test("FR-19: a match email never mentions a grade or a signal", () => {
    const mail = buildMatchDigest("a@b.co", null, [item("t1", "x")], APP);
    expect(`${mail.subject}\n${mail.text}\n${mail.html}`).not.toMatch(/grade|signal|เกรด|สัญญาณ/i);
  });
});
