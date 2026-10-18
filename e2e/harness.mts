/**
 * E2E harness pieces: an isolated Postgres, a local Stripe stand-in, the Next
 * dev server with dev-safe adapters, a cookie-aware HTTP client and the email
 * outbox reader. Nothing here talks to a real third party.
 */
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { createServer as netServer } from "node:net";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { Document, Page, Text, renderToBuffer } from "@react-pdf/renderer";
import Stripe from "stripe";

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = netServer();
    s.listen(0, "127.0.0.1", () => {
      const a = s.address();
      s.close(() => (typeof a === "object" && a ? resolve(a.port) : reject(new Error("no port"))));
    });
  });
}

/** E2E_DATABASE_URL, or a throwaway embedded Postgres 16 in a temp dir. */
export async function startDatabase(): Promise<{ url: string; stop: () => Promise<void> }> {
  if (process.env.E2E_DATABASE_URL) return { url: process.env.E2E_DATABASE_URL, stop: async () => {} };
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const dir = mkdtempSync(join(tmpdir(), "lodeline-e2e-pg-"));
  const port = await freePort();
  const pg = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "postgres", port, persistent: false, onLog: () => {} });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("lodeline_e2e");
  return {
    url: `postgresql://postgres:postgres@127.0.0.1:${port}/lodeline_e2e`,
    stop: async () => {
      await pg.stop();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export async function migrateAndSeed(databaseUrl: string, adminEmail: string) {
  // The database is wiped first. Refuse anything that does not look like a throwaway e2e/test database.
  const name = new URL(databaseUrl).pathname.slice(1);
  if (!/e2e|test/i.test(name)) throw new Error(`Refusing to reset database "${name}": E2E_DATABASE_URL must point at a database whose name contains "e2e" or "test".`);
  const env = { ...process.env, DATABASE_URL: databaseUrl, SEED_ADMIN_EMAIL: adminEmail };
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
  // Empty every table (same as the DB test suite) so a reused e2e database starts clean.
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  const rows = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length) await db.$executeRawUnsafe(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(", ")} CASCADE`);
  await db.$disconnect();
  execSync("npx tsx prisma/seed.ts", { env, stdio: "pipe" });
}

export interface FakeSession {
  id: string;
  mode: string;
  amount: number;
  metadata: Record<string, string>;
  clientReferenceId: string | null;
  successUrl: string;
  customerEmail: string | null;
}

/**
 * Local stand-in for the Stripe API (only POST /v1/checkout/sessions). The app
 * uses the official SDK pointed here via STRIPE_API_BASE; webhooks are signed
 * with the real SDK helper and the shared test secret.
 */
export async function startFakeStripe(): Promise<{ base: string; sessions: FakeSession[]; stop: () => Promise<void> }> {
  const sessions: FakeSession[] = [];
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.method === "POST" && req.url === "/v1/checkout/sessions") {
        const p = new URLSearchParams(body);
        const metadata: Record<string, string> = {};
        for (const [k, v] of p) {
          const m = k.match(/^metadata\[(.+)\]$/);
          if (m) metadata[m[1]] = v;
        }
        const s: FakeSession = {
          id: `cs_test_e2e_${sessions.length + 1}`,
          mode: p.get("mode") ?? "payment",
          amount: Number(p.get("line_items[0][price_data][unit_amount]") ?? 0),
          metadata,
          clientReferenceId: p.get("client_reference_id"),
          successUrl: p.get("success_url") ?? "",
          customerEmail: p.get("customer_email"),
        };
        sessions.push(s);
        res.writeHead(200, { "content-type": "application/json", "request-id": `req_e2e_${sessions.length}` });
        res.end(JSON.stringify({ id: s.id, object: "checkout.session", mode: s.mode, url: `${base}/pay/${s.id}`, metadata, amount_total: s.amount, payment_status: "unpaid" }));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: `fake stripe: ${req.method} ${req.url} not implemented` } }));
    });
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", () => r()));
  return { base, sessions, stop: () => new Promise((r) => server.close(() => r())) };
}

export const WEBHOOK_SECRET = "whsec_e2e_local_only";
const signer = new Stripe("sk_test_e2e_local_only");

/** A checkout.session.completed event for a fake session, signed like Stripe would. */
export function signedCheckoutCompleted(s: FakeSession, eventId: string, secret = WEBHOOK_SECRET) {
  const payload = JSON.stringify({
    id: eventId,
    object: "event",
    api_version: "2025-01-27.acacia",
    created: Math.floor(Date.now() / 1000),
    type: "checkout.session.completed",
    data: {
      object: {
        id: s.id,
        object: "checkout.session",
        mode: s.mode,
        payment_status: "paid",
        amount_total: s.amount,
        metadata: s.metadata,
        client_reference_id: s.clientReferenceId,
        subscription: s.mode === "subscription" ? `sub_e2e_${s.id}` : null,
      },
    },
  });
  return { payload, signature: signer.webhooks.generateTestHeaderString({ payload, secret }) };
}

export async function startApp(env: Record<string, string>, port: number, log: string[]): Promise<{ base: string; proc: ChildProcess; stop: () => Promise<void> }> {
  const base = `http://127.0.0.1:${port}`;
  const proc = spawn("npx", ["next", "dev", "-p", String(port), "-H", "127.0.0.1"], { env: { ...process.env, ...env, NODE_ENV: "development" }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  proc.stdout?.on("data", (d) => log.push(String(d)));
  proc.stderr?.on("data", (d) => log.push(String(d)));
  const deadline = Date.now() + 120_000;
  for (;;) {
    if (proc.exitCode !== null) throw new Error(`next dev exited (${proc.exitCode}):\n${log.join("").slice(-3000)}`);
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error("next dev did not become healthy in 120s");
    await new Promise((r) => setTimeout(r, 1000));
  }
  return {
    base,
    proc,
    stop: async () => {
      try {
        process.kill(-proc.pid!, "SIGTERM");
      } catch {
        /* already gone */
      }
      await new Promise((r) => setTimeout(r, 500));
    },
  };
}

/** fetch with a cookie jar; never follows redirects (so Set-Cookie and Location can be checked). */
export class Client {
  cookies = new Map<string, string>();
  constructor(readonly base: string, readonly ip: string) {}
  async req(path: string, init: RequestInit & { json?: unknown } = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("x-forwarded-for", this.ip);
    if (this.cookies.size) headers.set("cookie", [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "));
    let body = init.body;
    if (init.json !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(init.json);
    }
    const res = await fetch(path.startsWith("http") ? path : `${this.base}${path}`, { ...init, headers, body, redirect: "manual" });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(";");
      const i = kv.indexOf("=");
      this.cookies.set(kv.slice(0, i), kv.slice(i + 1));
    }
    return res;
  }
  async json<T = Record<string, unknown>>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<{ status: number; body: T }> {
    const r = await this.req(path, init);
    const text = await r.text();
    let body: T;
    try {
      body = JSON.parse(text) as T;
    } catch {
      body = { raw: text.slice(0, 500) } as T;
    }
    return { status: r.status, body };
  }
  async html(path: string): Promise<{ status: number; text: string }> {
    const r = await this.req(path);
    // React splits adjacent text nodes with <!-- --> markers; drop them so text checks read naturally.
    return { status: r.status, text: (await r.text()).replace(/<!-- -->/g, "") };
  }
}

export interface OutboxMail {
  at: string;
  to: string;
  subject: string;
  text: string;
}
export function readOutbox(path: string): OutboxMail[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as OutboxMail);
}

/** Synthetic certificate PDF: one Text per line so the label extractor sees lines. */
export async function makePdf(pages: string[][]): Promise<Uint8Array> {
  const doc = React.createElement(
    Document,
    null,
    pages.map((lines, i) => React.createElement(Page, { key: i, size: "LETTER", style: { padding: 40, fontSize: 11 } }, lines.map((l, j) => React.createElement(Text, { key: j }, l))))
  );
  return new Uint8Array(await renderToBuffer(doc as Parameters<typeof renderToBuffer>[0]));
}
