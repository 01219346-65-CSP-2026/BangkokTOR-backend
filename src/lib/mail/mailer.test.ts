import { afterEach, describe, expect, mock, test } from "bun:test";
import { RESEND_URL, createConsoleMailer, createResendMailer, type MailMessage } from "./mailer.ts";

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
