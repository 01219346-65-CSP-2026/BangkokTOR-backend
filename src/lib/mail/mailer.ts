import { env } from "../../config/env.ts";

// Part B (SCRUM-77): the mail port. Same idea as the AI port in lib/ai:
// callers depend on `Mailer`, never on a provider, so tests use a fake and a
// laptop with no key prints to the console instead of failing.

export type MailMessage = { to: string; subject: string; text: string; html: string };

export type Mailer = {
  /** "resend" or "console" — logged, so you know which one actually ran. */
  readonly id: string;
  send(message: MailMessage): Promise<void>;
};

/** Resend's HTTP API. Plain fetch, no SDK — like callGemini. */
export const RESEND_URL = "https://api.resend.com/emails";

export function createResendMailer(apiKey: string, from: string): Mailer {
  // TODO(B1). { id: "resend", send } where send POSTs to RESEND_URL with
  // headers Authorization: `Bearer ${apiKey}` and Content-Type: application/json,
  // body { from, to: [message.to], subject, text, html }. Not ok → throw an
  // Error that includes response.status. Compare callGemini in lib/ai/vertex.ts.
  void [apiKey, from];
  throw new Error("TODO(B1): createResendMailer");
}

/** Dev default: prints instead of sending, so the worker runs with no key. */
export function createConsoleMailer(log: (line: string) => void = console.log): Mailer {
  // TODO(B1). { id: "console", send } where send calls log() once with the
  // recipient, subject and text. No fetch.
  void log;
  throw new Error("TODO(B1): createConsoleMailer");
}

export function createMailer(): Mailer {
  // TODO(B4). env.resendApiKey set → createResendMailer(env.resendApiKey, env.mailFrom);
  // otherwise createConsoleMailer(). (Add those env settings first.)
  void env;
  throw new Error("TODO(B4): createMailer");
}
