import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { emailSenderFromEnv, FileEmailSender } from "./email";
import { billingFromEnv, stripeClientFromEnv } from "./billing";

describe("dev/e2e adapters", () => {
  it("EMAIL_PROVIDER=file writes one JSON line per message and sends nothing", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "outbox-")), "sub", "mail.jsonl");
    const s = emailSenderFromEnv({ EMAIL_PROVIDER: "file", EMAIL_OUTBOX_FILE: path } as unknown as NodeJS.ProcessEnv);
    expect(s).toBeInstanceOf(FileEmailSender);
    await s.send({ to: "a@example.test", subject: "Hi", text: "Body\nline 2" });
    const rows = readFileSync(path, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ to: "a@example.test", subject: "Hi", text: "Body\nline 2" });
  });
  it("refuses the file outbox and the local Stripe API in production", () => {
    expect(() => emailSenderFromEnv({ NODE_ENV: "production", EMAIL_PROVIDER: "file" } as unknown as NodeJS.ProcessEnv)).toThrow(/local development only/);
    expect(() => stripeClientFromEnv({ NODE_ENV: "production", STRIPE_SECRET_KEY: "sk_test_x", STRIPE_API_BASE: "http://127.0.0.1:1" } as unknown as NodeJS.ProcessEnv)).toThrow(/local development only/);
  });
  it("STRIPE_API_BASE points the real Stripe SDK at a local host; unset uses Stripe itself", () => {
    expect(stripeClientFromEnv({ STRIPE_SECRET_KEY: "sk_test_x" } as unknown as NodeJS.ProcessEnv)).toBeUndefined();
    expect(stripeClientFromEnv({ STRIPE_SECRET_KEY: "sk_test_x", STRIPE_API_BASE: "http://127.0.0.1:4242" } as unknown as NodeJS.ProcessEnv)).toBeDefined();
    expect(billingFromEnv({ STRIPE_SECRET_KEY: "sk_test_x", STRIPE_API_BASE: "http://127.0.0.1:4242" } as unknown as NodeJS.ProcessEnv).mode).toBe("stripe");
  });
});
