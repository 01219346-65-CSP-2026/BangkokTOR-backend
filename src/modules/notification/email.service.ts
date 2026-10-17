import { env } from "../../config/env.ts";
import { createMailer } from "../../lib/mail/mailer.ts";
import { UserModel } from "../user/user.model.ts";
import { NotificationModel } from "./notification.model.ts";
import {
  buildMatchDigest,
  groupByUser,
  shouldEmail,
  type DigestItem,
  type PendingRow,
  type Recipient,
} from "./notification.email.ts";

// Part B (SCRUM-77): turn notification rows still `email_status: "pending"`
// into one email per match. Called from src/email-worker.ts on an interval —
// see LEARNING.md for the end-to-end flow and the contract with Part A (the
// four email_* fields on notification.model.ts).
//
// Grouping by user (groupByUser) is just to load the recipient once per
// user, not to bundle their matches — each pending row still gets its own
// email, sent and recorded independently of the others in the same group.

export type SendPendingEmailsResult = { sent: number; skipped: number; failed: number };

type PendingNotificationRow = {
  _id: unknown;
  user_id: unknown;
  tor_id?: unknown;
  title: string;
  fit_score?: number | null;
};

type StoredRecipient = {
  email?: string | null;
  name?: string | null;
  profile?: { notify?: { on_match?: boolean | null } | null } | null;
};

/**
 * Send up to `limit` pending notifications — one email per row. Safe to
 * call repeatedly: a row leaves "pending" the moment it is marked
 * sent/failed/skipped, so a second run never double-sends it (LEARNING.md
 * end-to-end check, step 5).
 */
export async function sendPendingEmails(limit: number = env.emailBatchSize): Promise<SendPendingEmailsResult> {
  const result: SendPendingEmailsResult = { sent: 0, skipped: 0, failed: 0 };

  const rows = await NotificationModel.find(
    { email_status: "pending" },
    { user_id: 1, tor_id: 1, title: 1, fit_score: 1 },
  )
    .sort({ created_at: 1 })
    .limit(limit)
    .lean<PendingNotificationRow[]>()
    .exec();
  if (rows.length === 0) return result;

  const pendingRows: PendingRow[] = rows.map((r) => ({
    id: String(r._id),
    userId: String(r.user_id),
    torId: r.tor_id ? String(r.tor_id) : null,
    title: r.title,
    fitScore: r.fit_score ?? null,
  }));

  const mailer = createMailer();

  for (const [userId, userRows] of groupByUser(pendingRows)) {
    const user = await UserModel.findById(userId, { email: 1, name: 1, "profile.notify.on_match": 1 })
      .lean<StoredRecipient | null>()
      .exec();
    const recipient: Recipient | null = user
      ? { email: user.email ?? null, name: user.name ?? null, onMatch: user.profile?.notify?.on_match ?? null }
      : null;

    if (!shouldEmail(recipient)) {
      await NotificationModel.updateMany(
        { _id: { $in: userRows.map((r) => r.id) } },
        { $set: { email_status: "skipped" } },
      );
      result.skipped += userRows.length;
      continue;
    }

    for (const row of userRows) {
      const items: DigestItem[] = [{ torId: row.torId ?? "", title: row.title, fitScore: row.fitScore }];
      const mail = buildMatchDigest(recipient!.email!, recipient!.name, items, env.appUrl);

      try {
        await mailer.send(mail);
        await NotificationModel.updateOne(
          { _id: row.id },
          { $set: { email_status: "sent", emailed_at: new Date(), email_error: null } },
        );
        result.sent += 1;
      } catch (err) {
        await NotificationModel.updateOne(
          { _id: row.id },
          { $set: { email_status: "failed", email_error: err instanceof Error ? err.message : String(err) } },
        );
        result.failed += 1;
      }
    }
  }

  return result;
}
