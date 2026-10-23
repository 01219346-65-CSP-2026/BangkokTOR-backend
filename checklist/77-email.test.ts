import { describe, expect, test } from "bun:test";
import { exists, load, source } from "./helpers.ts";

// PASSING CRITERIA for Part B (SCRUM-77) — the wiring.
// Run with:   bun test checklist/77

describe("Part B checklist (SCRUM-77)", () => {
  test("step B4: mail settings exist, with a console-safe default", async () => {
    const { env } = await load("src/config/env.ts");
    for (const key of ["resendApiKey", "mailFrom", "appUrl", "emailIntervalMs", "emailBatchSize"]) {
      expect(env[key], `env.${key}`).toBeDefined();
    }
    const example = source(".env.example");
    for (const key of ["RESEND_API_KEY=", "MAIL_FROM=", "APP_URL=", "EMAIL_INTERVAL_MS=", "EMAIL_BATCH_SIZE="]) {
      expect(example).toContain(key);
    }
    // A real key never goes in the example file.
    expect(example).not.toMatch(/RESEND_API_KEY=re_/);
  });

  test("step B4: createMailer falls back to the console when there is no key", async () => {
    const { env } = await load("src/config/env.ts");
    const { createMailer } = await load("src/lib/mail/mailer.ts");
    const saved = env.resendApiKey;
    env.resendApiKey = "";
    try {
      expect(createMailer().id).toBe("console");
    } finally {
      env.resendApiKey = saved;
    }
  });

  test("step B5: sendPendingEmails reads pending rows and records every outcome", () => {
    const service = source("src/modules/notification/email.service.ts");
    expect(service).toContain("export async function sendPendingEmails");
    expect(service).toContain('email_status: "pending"');
    for (const outcome of ['"sent"', '"failed"', '"skipped"']) expect(service).toContain(outcome);
    expect(service).toContain("emailed_at");
    expect(service).toContain("email_error");
    expect(service).toContain("groupByUser(");
    expect(service).toContain("buildMatchDigest(");
    // One bad address must not stop the rest.
    expect(service).toMatch(/try\s*\{[\s\S]*mailer\.send[\s\S]*\}\s*catch/);
  });

  test("step B6: the worker exists and has a script", () => {
    expect(exists("src/email-worker.ts"), "create src/email-worker.ts").toBe(true);
    expect(source("src/email-worker.ts")).toContain("sendPendingEmails(");
    expect(source("package.json")).toContain('"email-worker": "bun run src/email-worker.ts"');
  });
});
