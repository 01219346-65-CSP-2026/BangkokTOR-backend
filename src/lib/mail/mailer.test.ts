import { afterEach, describe, expect, mock, test } from "bun:test";
import { env } from "../../config/env.ts";
import {
  RESEND_URL,
  createConsoleMailer,
  createGmailMailer,
  createMailer,
  createResendMailer,
  gmailFromAddress,
  type MailMessage,
} from "./mailer.ts";

// SPEC for Part B (SCRUM-77) — the mail port.
// Run with:   bun test src/lib/mail
//
// Nothing here reaches Resend: `fetch` is replaced by a fake that records the
// request (the same trick as src/lib/ai/vertex.test.ts).

const message: MailMessage = { to: "team@example.com", subject: "TOR ใหม่", text: "hello", html: "<p>hello</p>" };

const realFetch = globalThis.fetch;
let calls: Array<{ url: string; init: RequestInit }> = [];
function fakeFetch(status: number, body = "{}") {
  calls = [];
  globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(body, { status });
  }) as unknown as typeof fetch;
}
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("step B1: createResendMailer", () => {
  test("one POST to Resend, key in the Authorization header, never in the body", async () => {
    fakeFetch(200);
    await createResendMailer("re_test_key", "BangkokTOR <a@b.co>").send(message);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(RESEND_URL);
    expect(calls[0]!.init.method).toBe("POST");
    const headers = new Headers(calls[0]!.init.headers);
    expect(headers.get("authorization")).toBe("Bearer re_test_key");
    expect(String(calls[0]!.init.body)).not.toContain("re_test_key");
  });

  test("the body is Resend's shape: from, to as an array, subject, text, html", async () => {
    fakeFetch(200);
    await createResendMailer("k", "BangkokTOR <a@b.co>").send(message);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      from: "BangkokTOR <a@b.co>",
      to: ["team@example.com"],
      subject: "TOR ใหม่",
      text: "hello",
      html: "<p>hello</p>",
    });
  });

  test("a non-2xx answer throws, with the status in the message", async () => {
    fakeFetch(422, '{"message":"invalid to"}');
    await expect(createResendMailer("k", "a@b.co").send(message)).rejects.toThrow(/422/);
  });

  test("its id is \"resend\"", () => {
    expect(createResendMailer("k", "a@b.co").id).toBe("resend");
  });
});

describe("step B1: createConsoleMailer", () => {
  test("prints the recipient and subject, sends nothing", async () => {
    fakeFetch(200);
    const lines: string[] = [];
    const mailer = createConsoleMailer((line) => lines.push(line));
    await mailer.send(message);
    expect(mailer.id).toBe("console");
    expect(lines.join("\n")).toContain("team@example.com");
    expect(lines.join("\n")).toContain("TOR ใหม่");
    expect(calls).toHaveLength(0);
  });
});

describe("createGmailMailer", () => {
  // The default path calls real nodemailer — never exercised here. Every
  // test injects a fake `sendMail`, same idea as fakeFetch above: prove the
  // envelope and error handling without a network call.

  test("sends through the injected sendMail with the right envelope", async () => {
    const calls: unknown[] = [];
    const fakeSend = mock(async (options: unknown) => {
      calls.push(options);
    });
    const mailer = createGmailMailer("me@gmail.com", "app pass", "BangkokTOR <me@gmail.com>", fakeSend);
    await mailer.send(message);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      from: "BangkokTOR <me@gmail.com>",
      to: "team@example.com",
      subject: "TOR ใหม่",
      text: "hello",
      html: "<p>hello</p>",
    });
  });

  test("its id is \"gmail\"", () => {
    expect(createGmailMailer("me@gmail.com", "pass", "me@gmail.com", mock(async () => {})).id).toBe("gmail");
  });

  test("a send failure propagates, so the caller can mark the row failed", async () => {
    const failing = mock(async () => {
      throw new Error("535-5.7.8 Username and Password not accepted");
    });
    const mailer = createGmailMailer("me@gmail.com", "pass", "me@gmail.com", failing);
    await expect(mailer.send(message)).rejects.toThrow(/535/);
  });
});

// env is declared `as const` (readonly at the type level) so production code
// can't drift it by accident — these two tests are the deliberate exception,
// restoring every field they touch.
type MutableEnv = { -readonly [K in keyof typeof env]: (typeof env)[K] };
const envMut = env as MutableEnv;

describe("gmailFromAddress", () => {
  test("wraps the authenticated Gmail account — Gmail SMTP rejects a From it didn't authenticate as", () => {
    expect(gmailFromAddress("me@gmail.com")).toBe("BangkokTOR <me@gmail.com>");
  });
});

describe("createMailer: provider selection", () => {
  test("MAIL_PROVIDER=gmail picks the gmail mailer, independent of resendApiKey", () => {
    const saved = { provider: envMut.mailProvider, user: envMut.gmailUser, pass: envMut.gmailAppPassword };
    envMut.mailProvider = "gmail";
    envMut.gmailUser = "me@gmail.com";
    envMut.gmailAppPassword = "app-pass";
    try {
      expect(createMailer().id).toBe("gmail");
    } finally {
      envMut.mailProvider = saved.provider;
      envMut.gmailUser = saved.user;
      envMut.gmailAppPassword = saved.pass;
    }
  });


  test("unset MAIL_PROVIDER keeps the existing resend-or-console default (step B4 is unaffected)", () => {
    const saved = { provider: envMut.mailProvider, resendKey: envMut.resendApiKey };
    envMut.mailProvider = "";
    envMut.resendApiKey = "";
    try {
      expect(createMailer().id).toBe("console");
    } finally {
      envMut.mailProvider = saved.provider;
      envMut.resendApiKey = saved.resendKey;
    }
  });
});
