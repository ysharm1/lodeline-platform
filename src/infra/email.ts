/**
 * EmailSender adapters, selected by EMAIL_PROVIDER:
 *   console  (default) logs recipient + subject + body to stdout (dev only)
 *   file      appends each message as one JSON line to EMAIL_OUTBOX_FILE (dev/e2e only;
 *             nothing leaves the machine). Refused in production.
 *   postmark  POSTMARK_SERVER_TOKEN   (HTTP API, implemented, untested live)
 *   resend    RESEND_API_KEY           (HTTP API, implemented, untested live)
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { EmailMessage, EmailSendResult, EmailSender } from "@/services/notifications";

export class ConsoleEmailSender implements EmailSender {
  readonly name = "console";
  readonly sent: EmailMessage[] = [];
  constructor(private readonly quiet = false) {}
  async send(m: EmailMessage): Promise<EmailSendResult> {
    this.sent.push(m);
    if (!this.quiet) console.info(`[email:console] to=${m.to} subject=${m.subject}\n${m.text}`);
    return { providerMessageId: null };
  }
}

/** Dev/e2e outbox: one JSON object per line. Never sends anything. */
export class FileEmailSender implements EmailSender {
  readonly name = "file";
  constructor(private readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
  }
  async send(m: EmailMessage): Promise<EmailSendResult> {
    appendFileSync(this.path, JSON.stringify({ at: new Date().toISOString(), to: m.to, subject: m.subject, text: m.text }) + "\n");
    return { providerMessageId: null };
  }
}

export class PostmarkEmailSender implements EmailSender {
  readonly name = "postmark";
  constructor(private readonly token: string, private readonly from: string) {}
  async send(m: EmailMessage): Promise<EmailSendResult> {
    const res = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", "X-Postmark-Server-Token": this.token },
      body: JSON.stringify({ From: this.from, To: m.to, Subject: m.subject, TextBody: m.text, MessageStream: "outbound" }),
    });
    if (!res.ok) throw new Error(`Postmark send failed: ${res.status}`);
    const body = (await res.json()) as { MessageID?: string };
    return { providerMessageId: body.MessageID ?? null };
  }
}

export class ResendEmailSender implements EmailSender {
  readonly name = "resend";
  constructor(private readonly key: string, private readonly from: string) {}
  async send(m: EmailMessage): Promise<EmailSendResult> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.key}` },
      body: JSON.stringify({ from: this.from, to: [m.to], subject: m.subject, text: m.text }),
    });
    if (!res.ok) throw new Error(`Resend send failed: ${res.status}`);
    const body = (await res.json()) as { id?: string };
    return { providerMessageId: body.id ?? null };
  }
}

export function emailSenderFromEnv(env: NodeJS.ProcessEnv = process.env): EmailSender {
  const provider = (env.EMAIL_PROVIDER ?? "console").toLowerCase();
  const from = env.EMAIL_FROM ?? "Lodeline <info@lodeline.org>";
  if (provider === "postmark") {
    if (!env.POSTMARK_SERVER_TOKEN) throw new Error("EMAIL_PROVIDER=postmark requires POSTMARK_SERVER_TOKEN");
    return new PostmarkEmailSender(env.POSTMARK_SERVER_TOKEN, from);
  }
  if (provider === "resend") {
    if (!env.RESEND_API_KEY) throw new Error("EMAIL_PROVIDER=resend requires RESEND_API_KEY");
    return new ResendEmailSender(env.RESEND_API_KEY, from);
  }
  if (provider === "file") {
    if (env.NODE_ENV === "production") throw new Error("EMAIL_PROVIDER=file is for local development only");
    return new FileEmailSender(env.EMAIL_OUTBOX_FILE ?? ".outbox/emails.jsonl");
  }
  if (env.NODE_ENV === "production" && env.ALLOW_CONSOLE_EMAIL !== "true") {
    throw new Error("EMAIL_PROVIDER must be postmark or resend in production");
  }
  return new ConsoleEmailSender();
}
