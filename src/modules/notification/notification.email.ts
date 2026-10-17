import type { MailMessage } from "../../lib/mail/mailer.ts";

// Part B (SCRUM-77): what a match email says. Pure — no database, no network.

/** One matched TOR in a digest. */
export type DigestItem = { torId: string; title: string; fitScore: number | null };

/** A pending notification row, as grouping reads it. */
export type PendingRow = { id: string; userId: string; torId: string | null; title: string; fitScore: number | null };

/** The recipient, as much of the user as the email needs. */
export type Recipient = { email: string | null; name: string | null; onMatch: boolean | null };

/** More than this and the email links to the notifications page instead. */
export const MAX_DIGEST_ITEMS = 10;

/** Text that goes inside HTML. A TOR title is portal text — never trust it. */
export function escapeHtml(text: string): string {
  // & first: escaping it after &lt; etc. would double-escape the entities
  // those replacements just introduced.
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, "");
}

export function torLink(appUrl: string, torId: string): string {
  return `${stripTrailingSlashes(appUrl)}/tor/${encodeURIComponent(torId)}`;
}

/** One email per user per run, however many TORs matched. */
export function groupByUser(rows: PendingRow[]): Map<string, PendingRow[]> {
  const grouped = new Map<string, PendingRow[]>();
  for (const row of rows) {
    const existing = grouped.get(row.userId);
    if (existing) existing.push(row);
    else grouped.set(row.userId, [row]);
  }
  return grouped;
}

/** Email only someone with an address who has not switched matches off. */
export function shouldEmail(recipient: Recipient | null): boolean {
  if (!recipient) return false;
  if (!recipient.email) return false;
  if (recipient.onMatch === false) return false;
  return true;
}

function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}

export function buildMatchDigest(to: string, name: string | null, items: DigestItem[], appUrl: string): MailMessage {
  const sorted = [...items].sort((a, b) => (b.fitScore ?? 0) - (a.fitScore ?? 0));
  const listed = sorted.slice(0, MAX_DIGEST_ITEMS);
  const remaining = sorted.length - listed.length;
  const base = stripTrailingSlashes(appUrl);
  const notificationsLink = `${base}/notifications`;
  const skillsLink = `${base}/skills`;

  const subject =
    sorted.length === 1
      ? truncate(sorted[0]!.title, 80)
      : `คุณมี ${sorted.length} TOR ใหม่ที่ตรงกับทักษะของคุณ`;

  const fitLabel = (fitScore: number | null) => `${fitScore ?? "-"}%`;

  const textLines = listed.map(
    (item) => `- ${item.title} (${fitLabel(item.fitScore)}) ${torLink(appUrl, item.torId)}`,
  );
  const htmlLines = listed.map(
    (item) =>
      `<li><a href="${torLink(appUrl, item.torId)}">${escapeHtml(item.title)}</a> (${fitLabel(item.fitScore)})</li>`,
  );
  if (remaining > 0) {
    textLines.push(`และอีก ${remaining} รายการ: ${notificationsLink}`);
    htmlLines.push(
      `<li>และอีก ${remaining} รายการ: <a href="${notificationsLink}">${notificationsLink}</a></li>`,
    );
  }

  const greeting = name ? `เรียนคุณ ${name}` : "เรียนคุณผู้ใช้งาน";
  const greetingHtml = name ? `เรียนคุณ ${escapeHtml(name)}` : "เรียนคุณผู้ใช้งาน";
  const headline =
    sorted.length === 1 ? "คุณได้รับการจับคู่ TOR ใหม่!" : "คุณได้รับการจับคู่ TOR ใหม่หลายรายการ!";

  const text = [
    `${greeting},`,
    headline,
    "",
    ...textLines,
    "",
    `ดูรายละเอียดเพิ่มเติมและการแจ้งเตือนทั้งหมดได้ที่โปรไฟล์ของคุณ: ${notificationsLink}`,
    "",
    `หากต้องการปิดการแจ้งเตือนนี้ ไปที่ ${skillsLink}`,
  ].join("\n");

  const html = [
    `<p>${greetingHtml},<br>${headline}</p>`,
    `<ul>${htmlLines.join("")}</ul>`,
    `<p>ดูรายละเอียดเพิ่มเติมและการแจ้งเตือนทั้งหมดได้ที่โปรไฟล์ของคุณ: <a href="${notificationsLink}">${notificationsLink}</a></p>`,
    `<p>หากต้องการปิดการแจ้งเตือนนี้ ไปที่ <a href="${skillsLink}">${skillsLink}</a></p>`,
  ].join("\n");

  return { to, subject, text, html };
}
