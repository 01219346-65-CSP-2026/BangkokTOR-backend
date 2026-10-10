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
  // TODO(B2). Replace & FIRST (why? try it the other way round), then < > " '
  void text;
  throw new Error("TODO(B2): escapeHtml");
}

export function torLink(appUrl: string, torId: string): string {
  // TODO(B2). `${appUrl without trailing slashes}/tor/${encodeURIComponent(torId)}`
  void [appUrl, torId];
  throw new Error("TODO(B2): torLink");
}

/** One email per user per run, however many TORs matched. */
export function groupByUser(rows: PendingRow[]): Map<string, PendingRow[]> {
  // TODO(B2). A Map keeps insertion order — users in first-seen order, rows in order.
  void rows;
  throw new Error("TODO(B2): groupByUser");
}

/** Email only someone with an address who has not switched matches off. */
export function shouldEmail(recipient: Recipient | null): boolean {
  // TODO(B2). Needs a non-empty email, and onMatch must not be false
  // (null = never chose = default on). A null recipient → false.
  void recipient;
  throw new Error("TODO(B2): shouldEmail");
}

export function buildMatchDigest(to: string, name: string | null, items: DigestItem[], appUrl: string): MailMessage {
  // TODO(B3). The test file lists every rule. In short:
  //  - sort best fit first; list at most MAX_DIGEST_ITEMS, then "และอีก N รายการ"
  //    linking to /notifications
  //  - subject: 1 item → its title (cut to 80 chars); more → the count
  //  - text AND html: greeting (name if any), each title + fit% + torLink,
  //    and a link to /skills to turn notifications off
  //  - html: EVERY piece of text and every URL goes through escapeHtml
  void [to, name, items, appUrl, MAX_DIGEST_ITEMS];
  throw new Error("TODO(B3): buildMatchDigest");
}
