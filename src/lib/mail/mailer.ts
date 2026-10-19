import nodemailer from "nodemailer";
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
  return {
    id: "resend",
    async send(message: MailMessage): Promise<void> {
      const response = await fetch(RESEND_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
      });
      if (!response.ok) {
        throw new Error(`resend ${response.status}: ${(await response.text()).slice(0, 200)}`);
      }
    },
  };
}

/** Dev default: prints instead of sending, so the worker runs with no key. */
export function createConsoleMailer(log: (line: string) => void = console.log): Mailer {
  return {
    id: "console",
    async send(message: MailMessage): Promise<void> {
      log(`[console-mailer] to=${message.to} subject=${message.subject}`);
    },
  };
}

type GmailSendInput = { from: string; to: string; subject: string; text: string; html: string };
type GmailSendFn = (input: GmailSendInput) => Promise<unknown>;

/**
 * Gmail's own SMTP, via Nodemailer. Unlike Resend, this needs no verified
 * domain — it sends as your own Gmail address (an identity you already
 * own), not a custom one — so it's the option for real delivery to any
 * recipient before a domain exists. `appPassword` is a Google "app
 * password" (myaccount.google.com/apppasswords, needs 2FA on), never your
 * real account password. Google displays it with spaces for readability;
 * those are stripped here so a copy-paste doesn't fail auth.
 */
export function createGmailMailer(user: string, appPassword: string, from: string, sendMail?: GmailSendFn): Mailer {
  const send =
    sendMail ??
    (() => {
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user, pass: appPassword.replace(/\s+/g, "") },
      });
      return (input: GmailSendInput) => transporter.sendMail(input);
    })();

  return {
    id: "gmail",
    async send(message: MailMessage): Promise<void> {
      await send({ from, to: message.to, subject: message.subject, text: message.text, html: message.html });
    },
  };
}

/**
 * Gmail SMTP rejects (or silently rewrites) a From address that isn't the
 * authenticated account — so unlike Resend, mailFrom is never a free-form
 * setting here. This derives the one From Gmail will actually accept,
 * rather than asking two env vars to be kept in sync by hand.
 */
export function gmailFromAddress(user: string): string {
  return `BangkokTOR <${user}>`;
}

export function createMailer(): Mailer {
  if (env.mailProvider === "gmail") {
    return createGmailMailer(env.gmailUser, env.gmailAppPassword, gmailFromAddress(env.gmailUser));
  }
  return env.resendApiKey
    ? createResendMailer(env.resendApiKey, env.mailFrom)
    : createConsoleMailer();
}
