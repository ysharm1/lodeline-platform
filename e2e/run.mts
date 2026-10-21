/**
 * Lodeline end-to-end run: walks the whole product against a real Next dev
 * server, a throwaway Postgres and local stand-ins for every third party.
 *
 *   npm run e2e
 *
 * Steps (docs/workflow.md):
 *   1 free audit (CSV + XLSX)   2 sign-up / sign-in       3 pack purchase (Stripe checkout + signed webhook)
 *   4 supplier questionnaires, portal, forwarding up the chain
 *   5 supplier uploads, parsing, verbatim claims, covered-country flags, confidence
 *   6 staff review + one-click release   7 pack PDF (whole + per part)
 *   8 marketplace: directory + map, China-free filter, Ask, matchmaker, listing + verification, buyer lists own supplies
 *   9 customer dashboard: account setup, Traces, Evidence packs, Marketplace + Request intro, Supply-chain map, My listings
 *
 * Safety: email goes to a local JSONL outbox (EMAIL_PROVIDER=file) and every
 * recipient must be a *.test address; Stripe is a local stand-in reached by the
 * official SDK (STRIPE_API_BASE); geocoding is offline (GEOCODER=country); no LLM
 * key. All parts-list rows are public catalogue parts; all PDFs are synthetic
 * and say so on the page.
 *
 * Env: E2E_DATABASE_URL (optional; database name must contain e2e/test, it is
 * reset), E2E_KEEP=1 keeps the temp dir, E2E_BOM overrides the parts list.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { extractText } from "unpdf";
import { Client, WEBHOOK_SECRET, freePort, makePdf, migrateAndSeed, readOutbox, signedCheckoutCompleted, startApp, startDatabase, startFakeStripe, type FakeSession } from "./harness.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const BOM = process.env.E2E_BOM ?? join(ROOT, "e2e/fixtures/real-parts-bom.csv");
const BOM_XLSX = join(ROOT, "e2e/fixtures/real-parts-bom.xlsx");
const ANSWER_KEY = join(ROOT, "e2e/fixtures/real-parts-answer-key.csv");
const ADMIN = "admin@e2e.lodeline.test";
const BUYER = "buyer@e2e.lodeline.test";
const BUYER_CO = "E2E Test Buyer Co (synthetic)";
const SYNTH = "SYNTHETIC TEST DATA - NOT A REAL CERTIFICATE (Lodeline e2e run)";

type StepResult = { step: number; name: string; ok: boolean; checks: number; error?: string };
const results: StepResult[] = [];
let checks = 0;
function check(cond: unknown, msg: string): asserts cond {
  checks++;
  if (!cond) throw new Error(`check failed: ${msg}`);
}
async function step(n: number, name: string, fn: () => Promise<void>) {
  const before = checks;
  const t = Date.now();
  process.stdout.write(`\n[e2e] step ${n}: ${name}\n`);
  try {
    await fn();
    results.push({ step: n, name, ok: true, checks: checks - before });
    process.stdout.write(`[e2e] step ${n} PASS (${checks - before} checks, ${((Date.now() - t) / 1000).toFixed(1)}s)\n`);
  } catch (e) {
    results.push({ step: n, name, ok: false, checks: checks - before, error: (e as Error).message });
    process.stdout.write(`[e2e] step ${n} FAIL: ${(e as Error).stack}\n`);
    throw e;
  }
}

function csvRows(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  const split = (l: string) => {
    const out: string[] = [];
    let cur = "";
    let q = false;
    for (const ch of l) {
      if (ch === '"') q = !q;
      else if (ch === "," && !q) {
        out.push(cur);
        cur = "";
      } else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const head = split(lines[0]);
  return lines.slice(1).map((l) => Object.fromEntries(split(l).map((v, i) => [head[i], v])));
}

async function main() {
  const work = mkdtempSync(join(tmpdir(), "lodeline-e2e-"));
  const outbox = join(work, "outbox.jsonl");
  const log: string[] = [];
  const db0 = await startDatabase();
  const stripe = await startFakeStripe();
  let app: Awaited<ReturnType<typeof startApp>> | undefined;
  let prisma: PrismaClient | undefined;
  try {
    process.stdout.write(`[e2e] database ${db0.url.replace(/:[^:@]*@/, ":***@")}\n[e2e] migrate + seed\n`);
    await migrateAndSeed(db0.url, ADMIN);
    prisma = new PrismaClient({ datasourceUrl: db0.url });
    const port = await freePort();
    const env: Record<string, string> = {
      DATABASE_URL: db0.url,
      APP_BASE_URL: `http://127.0.0.1:${port}`,
      SESSION_SECRET: "e2e-session-secret-local-only",
      TOKEN_ENCRYPTION_KEY: "e2e-token-key-local-only",
      SEED_ADMIN_EMAIL: ADMIN,
      EMAIL_PROVIDER: "file",
      EMAIL_OUTBOX_FILE: outbox,
      LEADS_NOTIFY_EMAIL: "team@e2e.lodeline.test",
      STRIPE_SECRET_KEY: "sk_test_e2e_local_only",
      STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
      STRIPE_API_BASE: stripe.base,
      S3_DOCS_BUCKET: "",
      LOCAL_UPLOAD_DIR: join(work, "uploads"),
      GEOCODER: "country",
      LLM_ZDR_CONFIRMED: "false",
      LLM_API_KEY: "",
      TURNSTILE_SECRET_KEY: "",
      TURNSTILE_SITE_KEY: "",
      TURNSTILE_REQUIRED: "false",
      CRON_SECRET: "e2e-cron-secret",
      NEXT_TELEMETRY_DISABLED: "1",
    };
    process.stdout.write(`[e2e] starting next dev on :${port}\n`);
    app = await startApp(env, port, log);
    const db = prisma;
    const anon = new Client(app.base, "10.0.0.1");
    const buyer = new Client(app.base, "10.0.0.2");
    const admin = new Client(app.base, "10.0.0.3");
    const supplierIp = new Client(app.base, "10.0.0.4");
    const mails = () => readOutbox(outbox);
    const mailTo = (to: string, re?: RegExp) => mails().filter((m) => m.to === to && (!re || re.test(m.subject) || re.test(m.text)));
    const linkIn = (text: string, re: RegExp) => text.match(re)?.[0] ?? null;

    let auditId = "";
    let auditToken = "";
    let starterAudit = { id: "", token: "" };
    let packId = "";
    let starterPackId = "";
    const portal: Record<string, string> = {};
    let partIdByPn: Record<string, string> = {};

    // ---------------------------------------------------------------- 1
    await step(1, "Free quick audit (CSV + XLSX): likely / possible / not likely", async () => {
      check((await anon.html("/")).status === 200, "marketing home page renders");
      check((await anon.html("/audit")).status === 200, "/audit renders");
      const fd = new FormData();
      fd.set("file", new Blob([readFileSync(BOM)], { type: "text/csv" }), "real-parts-bom.csv");
      fd.set("email", BUYER);
      fd.set("company", BUYER_CO);
      const up = await anon.json<{ auditId: string; accessToken: string; emailed: boolean }>("/api/audits", { method: "POST", body: fd });
      check(up.status === 201, `audit upload 201 (got ${up.status} ${JSON.stringify(up.body)})`);
      auditId = up.body.auditId;
      auditToken = up.body.accessToken;
      const r = await anon.json<{ parts: { id: string; partNumber: string; coverage: string; materials: string[]; reason: string; undocumentedStages: string[] }[]; coverage: { likely: number; possible: number; notLikely: number } }>(`/api/audits/${auditId}?t=${encodeURIComponent(auditToken)}`);
      check(r.status === 200, "audit results API 200");
      const parts = r.body.parts;
      partIdByPn = Object.fromEntries(parts.map((p) => [p.partNumber, p.id]));
      check(parts.length === 22, `22 rows parsed (got ${parts.length})`);
      const key = csvRows(readFileSync(ANSWER_KEY, "utf8"));
      let agree = 0;
      for (const k of key) {
        const p = parts.find((x) => x.partNumber === k.part);
        check(p, `row ${k.part} present`);
        const flagged = p.coverage !== "not_likely";
        if (flagged === (k.expected_flagged === "yes")) agree++;
      }
      process.stdout.write(`[e2e]   answer key agreement (flagged yes/no): ${agree}/${key.length}; coverage ${JSON.stringify(r.body.coverage)}\n`);
      check(agree === key.length, `flagged yes/no matches the answer key for every row (${agree}/${key.length})`);
      const by = (pn: string) => parts.find((p) => p.partNumber === pn)!;
      check(by("BX041").coverage === "likely" && by("BX041").materials.includes("ndfeb"), "BX041 likely NdFeB");
      check(by("DII15-60-201A").materials.includes("smco"), "DII15-60-201A SmCo (material column)");
      check(by("T491A106K016AT").coverage === "likely" && by("T491A106K016AT").materials.includes("tantalum"), "KEMET T491 likely tantalum");
      check(by("40400-03140B2").materials.includes("tungsten"), "balance weight -> tungsten");
      check(by("F83208").coverage === "not_likely", "ferrite magnet likely not covered");
      check(by("AS04504AS").coverage === "possible", "speaker possible (confirm with supplier)");
      check(parts.every((p) => p.reason.length > 10), "every row carries a cited reason");
      check(JSON.stringify(by("BX041").undocumentedStages) === JSON.stringify(["mine", "separation", "metal_alloy", "magnet"]), "NdFeB: mine, separation, metal/alloy, magnet undocumented");
      const page = await anon.html(`/audit/${auditId}?t=${encodeURIComponent(auditToken)}`);
      check(page.status === 200 && page.text.includes("likely covered") && page.text.includes("Request a quote"), "results page renders with Custom-scope quote CTA");
      check(page.text.includes('data-testid="audit-matches"'), "results page shows directory sources for flagged materials");
      check(mailTo(BUYER, /results|audit/i).length === 1, "results link emailed to the lead (outbox)");

      const fx = new FormData();
      fx.set("file", new Blob([readFileSync(BOM_XLSX)]), "real-parts-bom.xlsx");
      fx.set("email", BUYER);
      const ux = await anon.json<{ auditId: string; accessToken: string }>("/api/audits", { method: "POST", body: fx });
      check(ux.status === 201, `XLSX upload 201 (got ${ux.status})`);
      const rx = await anon.json<{ coverage: unknown }>(`/api/audits/${ux.body.auditId}?t=${encodeURIComponent(ux.body.accessToken)}`);
      check(JSON.stringify(rx.body.coverage) === JSON.stringify(r.body.coverage), "XLSX gives the same classification as CSV");

      const lines = readFileSync(BOM, "utf8").trim().split(/\r?\n/);
      const fs = new FormData();
      fs.set("file", new Blob([[lines[0], lines[1], lines[2], lines[3]].join("\n")], { type: "text/csv" }), "starter-subset.csv");
      fs.set("email", BUYER);
      fs.set("company", BUYER_CO);
      const us = await anon.json<{ auditId: string; accessToken: string }>("/api/audits", { method: "POST", body: fs });
      check(us.status === 201, "starter-size audit 201");
      starterAudit = { id: us.body.auditId, token: us.body.accessToken };
      const sp = await anon.html(`/audit/${starterAudit.id}?t=${encodeURIComponent(starterAudit.token)}`);
      check(sp.text.includes("Starter") && sp.text.includes("$2,500"), "3-part list priced as Starter $2,500");
      const bad = new FormData();
      bad.set("file", new Blob([Buffer.from("%PDF-1.4 drawing")]), "drawing.pdf");
      bad.set("email", BUYER);
      const refused = await anon.json<{ error: { code: string } }>("/api/audits", { method: "POST", body: bad });
      check(refused.status === 415, `PDF/drawing refused as a parts list (got ${refused.status} ${JSON.stringify(refused.body)})`);
    });

    // ---------------------------------------------------------------- 2
    async function signIn(c: Client, email: string, next: string) {
      const fd = new FormData();
      fd.set("email", email);
      fd.set("next", next);
      const before = mailTo(email).length;
      const r = await c.req("/api/auth/magic-link", { method: "POST", body: fd });
      check(r.status === 303, `magic-link request 303 (got ${r.status})`);
      const m = mailTo(email).slice(before).find((x) => /\/api\/auth\/callback\?token=/.test(x.text));
      check(m, `magic link emailed to ${email}`);
      const link = linkIn(m.text, /https?:\/\/\S+\/api\/auth\/callback\?\S+/);
      check(link, "magic link URL found");
      const cb = await c.req(link);
      check(cb.status === 303 && c.cookies.has("ll_session"), "callback sets the session cookie");
      return cb.headers.get("location") ?? "";
    }
    await step(2, "Sign-up / sign-in (magic link) and dual-role-ready accounts", async () => {
      const loc = await signIn(buyer, BUYER, `/audit/${auditId}?t=${auditToken}`);
      check(loc.includes(`/audit/${auditId}`), "sign-in returns to the audit (next path kept)");
      check((await buyer.html("/buyer/packs")).status === 200, "buyer area reachable");
      await signIn(admin, ADMIN, "/admin/review");
      check((await admin.html("/admin/review")).status === 200, "admin review queue reachable");
      check((await buyer.html("/admin/review")).status === 404, "buyer cannot open admin pages");
      check((await anon.req("/buyer/packs")).status === 307, "signed-out visitor redirected to login");
      const u = await db.user.findUniqueOrThrow({ where: { email: BUYER } });
      check(u.role === "buyer" && u.emailVerifiedAt, "buyer account created and email verified");
    });

    // ---------------------------------------------------------------- 3
    const sessionFor = (refId: string): FakeSession => {
      const s = [...stripe.sessions].reverse().find((x) => x.metadata.refId === refId);
      check(s, `Stripe checkout session for ${refId}`);
      return s;
    };
    async function pay(s: FakeSession, eventId: string) {
      const ev = signedCheckoutCompleted(s, eventId);
      return anon.json("/api/webhooks/stripe", { method: "POST", body: ev.payload, headers: { "stripe-signature": ev.signature, "content-type": "application/json" } });
    }
    await step(3, "Buy an evidence pack: tiers, Custom quote, Stripe checkout, signed webhook", async () => {
      const q = await buyer.json<{ error: { code: string } }>("/api/packs", { method: "POST", json: { auditId, accessToken: auditToken } });
      check(q.status === 409 && q.body.error?.code === "QUOTE_REQUIRED", `15 parts / 11 suppliers is larger than Standard: quote required (got ${q.status} ${JSON.stringify(q.body)})`);
      const qp = await admin.html("/admin/quotes");
      check(qp.status === 200 && qp.text.includes(auditId.slice(0, 8)), "audit appears in the admin quote queue");
      const setQ = await admin.json("/api/admin/audits/" + auditId + "/quote", { method: "POST", json: { priceCents: 750000, maxSuppliers: 12 } });
      check(setQ.status === 200, `admin sets Custom quote (got ${setQ.status} ${JSON.stringify(setQ.body)})`);
      const rp = await buyer.html(`/audit/${auditId}?t=${encodeURIComponent(auditToken)}`);
      check(rp.text.includes("Order the Custom pack ($7,500)"), "results page offers the quoted Custom pack");
      const o = await buyer.json<{ packId: string; checkoutUrl: string }>("/api/packs", { method: "POST", json: { auditId, accessToken: auditToken } });
      check(o.status === 201 && o.body.checkoutUrl.startsWith(stripe.base), `order returns a Stripe Checkout URL (got ${o.status} ${JSON.stringify(o.body)})`);
      packId = o.body.packId;
      const s = sessionFor(packId);
      check(s.amount === 750000 && s.metadata.kind === "pack" && s.mode === "payment" && s.customerEmail === BUYER, "checkout session: $7,500 one-time, kind=pack, buyer email");
      let pack = await db.evidencePack.findUniqueOrThrow({ where: { id: packId } });
      check(pack.status === "pending_payment" && !pack.paidAt && pack.tier === "custom", "pack pending payment before the webhook");
      const forged = signedCheckoutCompleted(s, "evt_e2e_forged", "whsec_wrong");
      const f = await anon.json("/api/webhooks/stripe", { method: "POST", body: forged.payload, headers: { "stripe-signature": forged.signature } });
      check(f.status === 401, `webhook with a bad signature refused (got ${f.status})`);
      check((await pay(s, "evt_e2e_pack_1")).status === 200, "signed webhook accepted");
      check((await pay(s, "evt_e2e_pack_1")).status === 200, "webhook replay accepted (idempotent)");
      pack = await db.evidencePack.findUniqueOrThrow({ where: { id: packId } });
      check(pack.status === "collecting" && pack.paidAt, "webhook marked the pack paid (collecting)");
      check((await db.auditEntry.count({ where: { action: "pack.paid", subjectId: packId } })) === 1, "paid exactly once");
      const org = await db.organization.findUniqueOrThrow({ where: { id: pack.orgId }, include: { memberships: true } });
      check(org.roles.includes("buyer") && org.memberships.some((m) => m.roles.includes("buyer") && m.isOrgAdmin), "buyer org + org-admin buyer membership created");
      const st = await buyer.json<{ packId: string; checkoutUrl: string }>("/api/packs", { method: "POST", json: { auditId: starterAudit.id, accessToken: starterAudit.token } });
      check(st.status === 201, "Starter pack ordered");
      starterPackId = st.body.packId;
      const ss = sessionFor(starterPackId);
      check(ss.amount === 250000, "Starter checkout is $2,500");
      check((await pay(ss, "evt_e2e_pack_starter")).status === 200, "Starter webhook accepted");
      check((await db.evidencePack.findUniqueOrThrow({ where: { id: starterPackId } })).paidAt, "Starter pack paid");
      check((await buyer.html(`/buyer/packs/${packId}`)).status === 200, "buyer pack page renders");
    });

    // ---------------------------------------------------------------- 4
    await step(4, "Supplier questionnaires, portal per-stage forms, forwarding up the chain", async () => {
      const add = async (name: string, email: string, country: string, pns: string[]) => {
        const r = await buyer.json<{ requestId: string }>(`/api/packs/${packId}/suppliers`, { method: "POST", json: { name, contactEmail: email, contactName: "Test Contact", country, partIds: pns.map((p) => partIdByPn[p]) } });
        check(r.status === 201, `request to ${name} created (got ${r.status} ${JSON.stringify(r.body)})`);
        const m = mailTo(email).find((x) => x.text.includes("/s/"));
        check(m && m.subject.includes(BUYER_CO), `questionnaire emailed to ${email} naming the buyer`);
        const link = linkIn(m.text, /https?:\/\/\S+\/s\/[A-Za-z0-9_-]+/);
        check(link, "supplier link present");
        return link.split("/s/")[1];
      };
      portal.kj = await add("Synthetic Magnet Supplier (TEST)", "kj-test@example.test", "US", ["BX041", "D82"]);
      portal.wt = await add("Synthetic Tungsten Supplier (TEST)", "tungsten-test@example.test", "US", ["40400-03140B2", "4SNC18F-W30M08B"]);
      portal.kemet = await add("KEMET (test contact)", "kemet-test@example.test", "US", ["T491A106K016AT", "T356A685K006AT"]);
      portal.pui = await add("PUI Audio (test contact)", "pui-test@example.test", "US", ["AS04504AS"]);
      const pui = await supplierIp.html(`/s/${portal.pui}`);
      check(pui.text.includes('data-stage="magnet"') && pui.text.includes("AS04504AS"), "possible part with unknown material (speaker) gets the magnet-chain questionnaire");
      const kjText = mails().find((m) => m.to === "kj-test@example.test")!.text;
      check(/mine/.test(kjText) && /magnet/.test(kjText) && /DFARS 252\.225-7052/.test(kjText), "questionnaire lists the requested stages and the clause");
      const pg = await supplierIp.html(`/s/${portal.kj}`);
      check(pg.status === 200, "supplier portal renders (no login)");
      for (const s of ["mine", "separation", "metal_alloy", "magnet"]) check(pg.text.includes(`data-stage="${s}"`), `portal has a form for stage ${s}`);
      const wtp = await supplierIp.html(`/s/${portal.wt}`);
      check(wtp.text.includes('data-stage="mine"') && !wtp.text.includes('data-stage="magnet"'), "tungsten portal asks mine/separation/metal only");
      const fw = await supplierIp.json<{ requestId: string; emailed: boolean }>(`/api/s/${portal.kj}/forward`, { method: "POST", json: { stages: ["metal_alloy"], name: "Synthetic Alloy Supplier (TEST)", contactEmail: "alloy-test@example.test", country: "China" } });
      check(fw.status === 201 && fw.body.emailed, `magnet supplier forwards metal/alloy upstream (got ${fw.status} ${JSON.stringify(fw.body)})`);
      const fm = mailTo("alloy-test@example.test")[0];
      check(fm && fm.text.includes("forwarded this request") && /metal\/alloy/.test(fm.text), "upstream supplier gets its own questionnaire, naming who forwarded it");
      portal.alloy = linkIn(fm.text, /https?:\/\/\S+\/s\/[A-Za-z0-9_-]+/)!.split("/s/")[1];
      const ap = await supplierIp.html(`/s/${portal.alloy}`);
      check(ap.text.includes("Forwarded to you by") && ap.text.includes('data-stage="metal_alloy"') && !ap.text.includes('data-stage="mine"'), "upstream portal shows only the forwarded stage");
      check((await supplierIp.html(`/s/${portal.kj}`)).text.includes("Forwarded to Synthetic Alloy Supplier (TEST)"), "magnet supplier portal shows the stage as forwarded");
      const badStage = await supplierIp.json(`/api/s/${portal.kj}/forward`, { method: "POST", json: { stages: ["component"], name: "X", contactEmail: "x@example.test" } });
      check(badStage.status === 400, "cannot forward a stage that was not requested");
      check((await supplierIp.html(`/s/${"x".repeat(43)}`)).text.includes("Link unavailable"), "unknown token refused");
      const reqs = await db.supplierRequest.findMany({ where: { packId } });
      check(reqs.length === 5 && reqs.filter((r) => r.parentRequestId).length === 1, "4 buyer requests + 1 forwarded request on the pack");
    });

    // ---------------------------------------------------------------- 5
    const upload = async (token: string, fileName: string, bytes: Uint8Array, stage?: string) => {
      const a = await supplierIp.json<{ documentId: string; upload: { url: string; headers: Record<string, string> } }>(`/api/s/${token}/uploads`, { method: "POST", json: { fileName, sizeBytes: bytes.byteLength, stage } });
      if (a.status !== 201) return { status: a.status, body: a.body as unknown as Record<string, unknown> };
      const put = await fetch(a.body.upload.url, { method: "PUT", headers: a.body.upload.headers, body: Buffer.from(bytes) });
      check(put.ok, `presigned PUT to local storage ok (${put.status})`);
      const d = await supplierIp.json<{ status: string; claims: number; rejectionReason: string | null }>(`/api/s/${token}/documents`, { method: "POST", json: { documentId: a.body.documentId } });
      return { status: d.status, body: { ...d.body, documentId: a.body.documentId } as Record<string, unknown> };
    };
    const docs: Record<string, string> = {};
    await step(5, "Supplier uploads: unpdf parsing, verbatim claims, covered-country red flags, confidence", async () => {
      const magnet = await makePdf([[SYNTH, "Certificate of Origin: sintered magnets", "Issuer: Example Magnet Plant KK (synthetic)", "Date: 2026-09-15", "Stage: Sintered NdFeB magnet manufacture", "Facility: Example Magnet Plant No. 1", "Address: 1-2-3 Example-cho, Kitakyushu, Japan", "Country: Japan"]]);
      const r1 = await upload(portal.kj, "kj-magnet-certificate-SYNTHETIC.pdf", magnet, "magnet");
      check(r1.status === 200 && r1.body.status === "in_review" && Number(r1.body.claims) === 1, `magnet certificate parsed into 1 claim (got ${JSON.stringify(r1.body)})`);
      docs.magnet = String(r1.body.documentId);
      const upstream = await makePdf([[SYNTH, "Supplier declaration", "Issuer: Example Rare Earth Trading Ltd (synthetic)", "Date: 2026-08-01", "Stage: Mining of rare earth ore", "Facility: Example Mine A", "Country: Australia", "---", "Stage: Solvent extraction separation and refining", "Facility: Example Separation Plant", "Address: 9 Example Industrial Park, Kuantan, Malaysia", "Country: Malaysia"]]);
      const r2 = await upload(portal.kj, "kj-upstream-declaration-SYNTHETIC.pdf", upstream);
      check(r2.status === 200 && Number(r2.body.claims) === 2, `multi-stage declaration parsed into 2 claims (got ${JSON.stringify(r2.body)})`);
      docs.upstream = String(r2.body.documentId);
      const alloy = await makePdf([[SYNTH, "Certificate of Origin: NdPr alloy", "Issuer: Example Alloy Works (synthetic)", "Date: 2026-07-20", "Stage: NdPr metal and alloy smelting", "Facility: Example Alloy Works", "Address: 88 Example Road, Baotou, China", "Country: China"]]);
      const r3 = await upload(portal.alloy, "alloy-certificate-SYNTHETIC.pdf", alloy, "metal_alloy");
      check(r3.status === 200 && Number(r3.body.claims) === 1, "forwarded upstream supplier uploads through its own link");
      docs.alloy = String(r3.body.documentId);
      const tungsten = await makePdf([[SYNTH, "Tungsten origin declaration", "Issuer: Example Tungsten Mill (synthetic)", "Date: 2026-06-30", "Stage: Tungsten ore mining", "Facility: Example Tungsten Mine", "Address: 1 Example Strasse, Mittersill, Austria", "Country: Austria", "---", "Stage: APT refining and tungsten metal powder", "Facility: Example Tungsten Refinery", "Address: 100 Example Ave, Pittsburgh, PA, USA", "Country: United States"]]);
      const r4 = await upload(portal.wt, "tungsten-declaration-SYNTHETIC.pdf", tungsten);
      check(r4.status === 200 && Number(r4.body.claims) === 2, `tungsten declaration parsed (got ${JSON.stringify(r4.body)})`);
      docs.tungsten = String(r4.body.documentId);
      const tant = await makePdf([[SYNTH, "Conflict minerals and origin declaration: tantalum", "Issuer: Example Capacitor Co (synthetic)", "Date: 2026-05-10", "Stage: Tantalum ore mining (coltan concentrate)", "Facility: Example Coltan Mine", "Country: Rwanda"]]);
      const r5 = await upload(portal.kemet, "tantalum-declaration-SYNTHETIC.pdf", tant, "mine");
      check(r5.status === 200 && Number(r5.body.claims) === 1, "tantalum declaration parsed");
      docs.tant = String(r5.body.documentId);

      const drawing = await makePdf([[SYNTH, "DWG NO 12345", "SCALE 2:1", "SHEET 1 OF 1", "DRAWN BY X", "CHECKED BY Y", "TOLERANCES UNLESS OTHERWISE SPECIFIED", "THIRD ANGLE PROJECTION"]]);
      const rd = await upload(portal.kemet, "part-drawing-SYNTHETIC.pdf", drawing);
      check(rd.body.status === "rejected" && rd.body.rejectionReason === "technical_drawing", "technical drawing rejected");
      const itar = await makePdf([[SYNTH, "WARNING: this document contains technical data subject to ITAR"]]);
      const ri = await upload(portal.kemet, "itar-marked-SYNTHETIC.pdf", itar);
      check(ri.body.status === "rejected" && ri.body.rejectionReason === "export_controlled_marking", "ITAR-marked document rejected");
      check((await upload(portal.kemet, "assembly.step", new Uint8Array(10))).status === 415, "CAD file refused before upload");
      check((await upload(portal.wt, "x.pdf", magnet, "magnet")).status === 400, "per-stage form refuses a stage that was not requested");
      const notPdf = await upload(portal.kemet, "fake.pdf", new TextEncoder().encode("hello, not a pdf"));
      check(notPdf.body.status === "rejected" && notPdf.body.rejectionReason === "not_pdf", "non-PDF bytes rejected by magic-byte check");

      const claims = await db.evidenceClaim.findMany({ where: { document: { request: { packId } } }, include: { document: { include: { pages: true } } } });
      check(claims.length === 7, `7 claims extracted for the pack (got ${claims.length})`);
      const norm = (s: string) => s.replace(/\s+/g, " ").trim();
      for (const c of claims) {
        const cites = c.citations as { field: string; page: number; quote: string }[];
        check(cites.length > 0, "every claim carries citations");
        for (const q of cites) check(norm(c.document.pages.find((p) => p.page === q.page)!.text).includes(norm(q.quote)), `quote is verbatim on page ${q.page}: "${q.quote}"`);
        check(typeof c.confidence === "number" && c.confidence >= 0 && c.confidence <= 1, "claim has a 0..1 confidence score");
      }
      const cn = claims.find((c) => c.facilityName === "Example Alloy Works")!;
      check(cn.coveredCountry && cn.countryIso === "CN" && /covered country CN/.test(cn.coveredReason ?? ""), "China facility red-flagged as covered country");
      check(claims.filter((c) => c.coveredCountry).length === 1, "no other claim flagged");
      const jp = claims.find((c) => c.facilityName === "Example Magnet Plant No. 1")!;
      check(jp.stage === "magnet" && jp.countryIso === "JP" && jp.confidence === 1 && jp.latitude != null, "complete magnet claim: stage, JP, confidence 1.0, geocoded");
      const rw = claims.find((c) => c.facilityName === "Example Coltan Mine")!;
      check((rw.confidence ?? 1) < 1, "claim without an address scores lower");
      const doc = await db.evidenceDocument.findUniqueOrThrow({ where: { id: docs.magnet } });
      check(doc.declaredStage === "magnet" && doc.sha256.length === 64 && doc.pageCount === 1, "document stored with declared stage, SHA-256, page count");
      const audit = await db.partsAudit.findUniqueOrThrow({ where: { id: auditId } });
      check(audit.llmModel === "keyword-fallback", `no-LLM deterministic path used (llmModel=${audit.llmModel})`);
      const consent = await supplierIp.json(`/api/s/${portal.kj}/consent`, { method: "POST", json: { consent: true, name: "Test Contact" } });
      check(consent.status === 200, "supplier gives reuse consent");
      const req = await db.supplierRequest.findFirstOrThrow({ where: { packId, supplier: { contactEmail: "kj-test@example.test" } } });
      check(req.outreachStatus === "responded" && req.nextReminderAt === null, "upload stopped the reminders");
    });

    // ---------------------------------------------------------------- 6
    await step(6, "Staff review queue: approve / correct / reject, one-click release", async () => {
      const q = await admin.html("/admin/review");
      check(q.status === 200 && q.text.includes("covered") && q.text.includes("Example Magnet Plant No. 1"), "review queue lists claims with the covered flag");
      const claims = await db.evidenceClaim.findMany({ where: { document: { request: { packId } } } });
      const first = claims[0];
      check((await buyer.json(`/api/admin/claims/${first.id}`, { method: "PATCH", json: { action: "accept" } })).status === 403, "buyer cannot review claims");
      check((await admin.html(`/admin/review/${first.id}`)).status === 200, "claim detail page renders");
      const early = await admin.json<{ error: { code: string } }>(`/api/admin/packs/${packId}/release`, { method: "POST" });
      check(early.status === 409 && early.body.error.code === "REVIEW_PENDING", "release refused while claims are pending");
      for (const c of claims) {
        let body: Record<string, unknown> = { action: "accept" };
        if (c.facilityName === "Example Mine A") body = { action: "reject", note: "e2e: mine claim rejected to show a gap" };
        if (c.facilityName === "Example Coltan Mine") body = { action: "accept", note: "e2e: reviewer added the address", edit: { address: "Example District, Rwanda", country: "Rwanda" } };
        const r = await admin.json(`/api/admin/claims/${c.id}`, { method: "PATCH", json: body });
        check(r.status === 200, `decision on ${c.facilityName} (${body.action})`);
      }
      const edited = await db.evidenceClaim.findFirstOrThrow({ where: { facilityName: "Example Coltan Mine" } });
      check(edited.reviewStatus === "accepted" && edited.address === "Example District, Rwanda" && edited.countryIso === "RW" && !edited.coveredCountry, "correction saved and re-flagged");
      check((await admin.html("/admin/review")).text.includes("No claims waiting"), "queue empty after review");
      check((await db.auditEntry.count({ where: { action: "claim.reviewed" } })) === claims.length, "every decision in the audit log");
      const rel = await admin.json<{ status: string; emailed: boolean }>(`/api/admin/packs/${packId}/release`, { method: "POST" });
      check(rel.status === 200 && rel.body.status === "delivered" && rel.body.emailed, `one-click release (got ${rel.status} ${JSON.stringify(rel.body)})`);
      const pack = await db.evidencePack.findUniqueOrThrow({ where: { id: packId } });
      check(pack.status === "delivered" && pack.releasedAt && pack.pdfFileKey, "pack delivered with a stored PDF");
      check(mailTo(BUYER, /evidence pack is ready/i).length === 1, "buyer emailed that the pack is ready");
    });

    // ---------------------------------------------------------------- 7
    await step(7, "Evidence pack PDF (whole pack and per part) downloadable", async () => {
      const r = await buyer.req(`/api/packs/${packId}/pdf`);
      const bytes = new Uint8Array(await r.arrayBuffer());
      check(r.status === 200 && r.headers.get("content-type") === "application/pdf" && Buffer.from(bytes.subarray(0, 4)).toString() === "%PDF", "pack PDF downloads");
      const { text } = await extractText(bytes.slice(), { mergePages: true });
      const t = String(text);
      check(t.includes("Example Magnet Plant No. 1") && t.includes("Example Alloy Works"), "PDF lists accepted facilities");
      check(!t.includes("Example Mine A"), "rejected claim is not in the PDF");
      check(/Covered country/.test(t), "PDF shows the covered-country status");
      check(/not legal advice/.test(t) && /How Lodeline is paid/.test(t), "PDF carries the disclaimer and payment disclosure");
      check(t.includes("BX041") && t.includes("T491A106K016AT"), "PDF has a row per part");
      writeFileSync(join(work, "evidence-pack.pdf"), bytes);
      const one = await buyer.req(`/api/packs/${packId}/pdf?part=${partIdByPn["BX041"]}`);
      const ob = new Uint8Array(await one.arrayBuffer());
      check(one.status === 200 && Buffer.from(ob.subarray(0, 4)).toString() === "%PDF", "per-part PDF downloads");
      const ot = String((await extractText(ob.slice(), { mergePages: true })).text);
      check(ot.includes("BX041") && !ot.includes("T491A106K016AT") && ot.includes("single part"), "per-part PDF contains only that part");
      writeFileSync(join(work, "evidence-pack-BX041.pdf"), ob);
      check((await buyer.req(`/api/packs/${packId}/pdf?part=00000000-0000-0000-0000-000000000000`)).status === 404, "unknown part 404");
      check((await anon.req(`/api/packs/${packId}/pdf`)).status === 401, "PDF needs sign-in");
      const page = await buyer.html(`/buyer/packs/${packId}`);
      check(page.text.includes('data-testid="part-pdfs"') && page.text.includes("Documented") && page.text.includes("Covered country"), "buyer page shows the matrix and per-part PDF links");
    });

    // ---------------------------------------------------------------- 8
    await step(8, "Marketplace: directory + map, China-free filter, Ask, matchmaker, listing + verification, buyer lists own supplies", async () => {
      const dir = await anon.html("/suppliers");
      check(dir.status === 200 && dir.text.includes('data-testid="directory-map"') && dir.text.includes("Example Magnet Works"), "directory page renders with the map section");
      const s1 = await anon.json<{ listings: { name: string; latitude: number | null; countryIso: string }[] }>("/api/suppliers?material=ndfeb&stage=magnet");
      check(s1.body.listings.length >= 1 && s1.body.listings.every((l) => l.latitude != null), "search by material + stage returns geolocated rows");
      const s2 = await anon.json<{ listings: { countryIso: string }[] }>("/api/suppliers?q=tungsten");
      check(s2.body.listings.length >= 1, "full-text search works");
      const ask = await anon.json<{ answer: string; citedIds: string[]; listings: { id: string }[] }>("/api/suppliers/ask", { method: "POST", json: { question: "Who makes NdFeB magnets outside China?" } });
      check(ask.status === 200 && ask.body.answer.length > 0 && ask.body.citedIds.every((id) => ask.body.listings.some((l) => l.id === id)), "Ask box answers citing only returned rows (no LLM)");

      const app = await anon.json<{ id: string }>("/api/supplier-applications", { method: "POST", json: { companyName: "Synthetic Tungsten Refiner (TEST)", contactName: "Test Person", email: "refiner-test@example.test", city: "Pittsburgh", country: "US", stages: ["separation", "metal_alloy"], materials: ["tungsten"], summary: "Synthetic e2e listing: APT refining and tungsten metal powder. Not a real company." } });
      check(app.status === 201, `supplier application submitted (got ${app.status} ${JSON.stringify(app.body)})`);
      const ap = await admin.json<{ listingId: string }>(`/api/admin/applications/${app.body.id}`, { method: "PATCH", json: { action: "approve" } });
      check(ap.status === 200, "admin approves the application");
      const listingId = ap.body.listingId;
      let listing = await db.supplierListing.findUniqueOrThrow({ where: { id: listingId } });
      check(!listing.published && !listing.verifiedAt && listing.latitude != null, "approved listing is unpublished, unverified, geolocated");
      const ver = await admin.json<{ verificationId: string; checkoutUrl: string; priceCents: number }>(`/api/admin/listings/${listingId}/verification`, { method: "POST", json: { contactEmail: "refiner-test@example.test", contactName: "Test Person", facilities: 1 } });
      check(ver.status === 201 && ver.body.priceCents === 150000 && ver.body.checkoutUrl.startsWith(stripe.base), "supplier verification checkout ($1,500)");
      check(mailTo("refiner-test@example.test", /payment link/i).length === 1, "payment link emailed to the supplier");
      check((await pay(sessionFor(ver.body.verificationId), "evt_e2e_verification")).status === 200, "verification webhook accepted");
      const vm = mailTo("refiner-test@example.test").find((m) => /upload your origin documents/i.test(m.subject));
      check(vm, "verification upload link emailed after payment");
      const vt = linkIn(vm.text, /https?:\/\/\S+\/s\/[A-Za-z0-9_-]+/)!.split("/s/")[1];
      const vpdf = await makePdf([[SYNTH, "Facility declaration", "Issuer: Synthetic Tungsten Refiner (TEST)", "Date: 2026-10-01", "Stage: APT refining and separation", "Facility: Synthetic Refinery Line 1", "Address: 200 Example St, Pittsburgh, PA, USA", "Country: United States"]]);
      const vu = await upload(vt, "verification-declaration-SYNTHETIC.pdf", vpdf, "separation");
      check(vu.status === 200 && Number(vu.body.claims) === 1, "supplier uploads its own evidence");
      const vc = await db.evidenceClaim.findFirstOrThrow({ where: { documentId: String(vu.body.documentId) } });
      check((await admin.json(`/api/admin/claims/${vc.id}`, { method: "PATCH", json: { action: "accept" } })).status === 200, "admin accepts the verification claim");
      const vf = await admin.json(`/api/admin/listings/${listingId}/verify`, { method: "POST", json: { documentIds: [String(vu.body.documentId)] } });
      check(vf.status === 200, `listing verified from accepted evidence (got ${vf.status} ${JSON.stringify(vf.body)})`);
      const pub = await admin.json(`/api/admin/listings/${listingId}`, { method: "PATCH", json: { name: listing.name, summary: listing.summary, city: "Pittsburgh", country: "US", stages: ["separation", "metal_alloy"], materials: ["tungsten"], published: true } });
      check(pub.status === 200, "admin publishes the listing");
      listing = await db.supplierListing.findUniqueOrThrow({ where: { id: listingId } });
      check(listing.published && listing.verifiedAt, "listing published and verified");
      const verified = await anon.json<{ listings: { id: string }[] }>("/api/suppliers?verified=1&material=tungsten");
      check(verified.body.listings.some((l) => l.id === listingId), "verified-only search finds it");

      // China-free filter: add a covered-country listing and check it is excluded.
      const cnL = await admin.json<{ listing: { id: string } }>("/api/admin/listings", { method: "POST", json: { name: "Synthetic Covered-Country Smelter (TEST)", summary: "Synthetic e2e row in a covered country.", city: "Baotou", country: "CN", stages: ["metal_alloy"], materials: ["ndfeb"], published: true } });
      check(cnL.status === 201 || cnL.status === 200, `covered-country listing created (got ${cnL.status} ${JSON.stringify(cnL.body)})`);
      const all = await anon.json<{ listings: { countryIso: string }[] }>("/api/suppliers?material=ndfeb");
      const free = await anon.json<{ listings: { countryIso: string }[] }>("/api/suppliers?material=ndfeb&excludeCovered=1");
      check(all.body.listings.some((l) => l.countryIso === "CN") && !free.body.listings.some((l) => ["CN", "RU", "IR", "KP"].includes(l.countryIso)), "China-free filter drops covered-country listings");
      check((await anon.html("/suppliers?excludeCovered=1")).status === 200, "directory page with the China-free filter renders");

      const mm = await buyer.json<{ matches: { partNumber: string; needs: { material: string; stage: string; reason: string; suggestions: { id: string; name: string; countryIso: string; verified: boolean }[] }[] }[] }>(`/api/packs/${packId}/matches`);
      check(mm.status === 200 && mm.body.matches.length > 0, "matchmaker returns suggestions for open stages");
      const allSug = mm.body.matches.flatMap((m) => m.needs.flatMap((n) => n.suggestions));
      check(allSug.length > 0 && allSug.every((s) => !["CN", "RU", "IR", "KP"].includes(s.countryIso)), "suggestions never come from covered countries");
      const bx = mm.body.matches.find((m) => m.partNumber === "BX041")!;
      check(bx.needs.some((n) => n.stage === "metal_alloy" && n.reason === "covered_country" && n.suggestions.some((s) => s.name.startsWith("Example Alloy Smelter"))), "BX041 covered-country alloy stage gets a non-covered alternative");
      check(bx.needs.some((n) => n.stage === "mine" && n.reason === "no_document"), "rejected mine claim leaves an open need");
      check((await buyer.html(`/buyer/packs/${packId}`)).text.includes('data-testid="matchmaker"'), "pack page shows matchmaker suggestions");

      const own = await buyer.json<{ listing: { id: string; published: boolean } }>("/api/listings/mine", { method: "POST", json: { name: "E2E Test Buyer Co - Magnet Assemblies (synthetic)", summary: "Synthetic e2e listing for a buyer that also sells.", city: "Phoenix", country: "US", stages: ["component"], materials: ["ndfeb"] } });
      check(own.status === 201 && !own.body.listing.published, `buyer lists its own supplies (got ${own.status} ${JSON.stringify(own.body)})`);
      const u = await db.user.findUniqueOrThrow({ where: { email: BUYER }, include: { memberships: true, org: true } });
      check(u.org!.roles.includes("buyer") && u.org!.roles.includes("seller"), "org is now buyer + seller");
      check(u.memberships.some((m) => m.roles.includes("seller") && m.roles.includes("buyer")), "membership holds both roles");
      check((await buyer.html("/buyer/listings")).text.includes("Magnet Assemblies"), "My listings page shows it");
      check(!(await anon.json<{ listings: { id: string }[] }>("/api/suppliers?q=Assemblies")).body.listings.some((l) => l.id === own.body.listing.id), "unpublished until Lodeline publishes it");
      const pub2 = await admin.json(`/api/admin/listings/${own.body.listing.id}`, { method: "PATCH", json: { name: "E2E Test Buyer Co - Magnet Assemblies (synthetic)", summary: "Synthetic e2e listing for a buyer that also sells.", city: "Phoenix", country: "US", stages: ["component"], materials: ["ndfeb"], published: true } });
      check(pub2.status === 200, "admin publishes the buyer's listing");
      check((await anon.json<{ listings: { id: string }[] }>("/api/suppliers?material=ndfeb&stage=component")).body.listings.some((l) => l.id === own.body.listing.id), "buyer's listing is now in the directory");
      check((await buyer.html(`/buyer/packs/${packId}`)).status === 200, "dual-role buyer still reaches its packs");
    });

    // ---------------------------------------------------------------- 9
    await step(9, "Customer dashboard: account setup, Traces, Evidence packs, Marketplace + Request intro, Supply-chain map, My listings", async () => {
      check((await anon.req("/app")).status === 307, "signed-out visitor sent to login from /app");
      const tabs = await buyer.html("/app");
      check(tabs.status === 200 && tabs.text.includes('data-testid="dashboard-tabs"') && ["Traces", "Evidence packs", "Marketplace", "Supply-chain map", "My listings"].every((t) => tabs.text.includes(`>${t}</a>`)), "dashboard renders the five tabs");
      check(tabs.text.includes("https://lodeline-trace-demo.vercel.app/try") && tabs.text.includes("Try the live trace demo"), "Traces tab links to the live trace demo");
      check(tabs.text.includes(`/buyer/packs/${packId}`) && /stage\(s\) documented/.test(tabs.text), "Traces tab lists the buyer's trace with stage coverage");
      const packsTab = await buyer.html("/app/packs");
      check(packsTab.status === 200 && packsTab.text.includes(`/api/packs/${packId}/pdf`), "Evidence packs tab links the finished pack PDF");

      // New customer: magic-link sign-up lands on /app, names the company.
      const newco = new Client(app!.base, "10.0.0.5");
      const loc = await signIn(newco, "newco@e2e.lodeline.test", "");
      check(new URL(loc, app!.base).pathname === "/app", `new buyer lands on the dashboard (got ${loc})`);
      check((await newco.html("/app")).text.includes('data-testid="org-setup"'), "new buyer is asked to set up a company account");
      const fd = new FormData();
      fd.set("name", "New Co Motors (synthetic)");
      const os = await newco.req("/api/org", { method: "POST", body: fd });
      check(os.status === 303, `company account created (got ${os.status})`);
      const nu = await db.user.findUniqueOrThrow({ where: { email: "newco@e2e.lodeline.test" }, include: { org: true, memberships: true } });
      check(nu.org?.name === "New Co Motors (synthetic)" && nu.memberships.some((m) => m.isOrgAdmin && m.roles.includes("buyer")), "org + org-admin buyer membership created");
      const home = await newco.html("/app");
      check(home.text.includes("New Co Motors (synthetic)") && !home.text.includes('data-testid="org-setup"') && home.text.includes('data-testid="no-traces"'), "dashboard shows the company and an empty trace list");

      // Marketplace: fictional prospects imported with the idempotent importer.
      const { importSeed, parseSeed } = await import("../src/services/seed-import");
      const seed = parseSeed(JSON.parse(readFileSync(join(ROOT, "test/fixtures/seed-example.json"), "utf8")));
      const imp = await importSeed(db, seed);
      const imp2 = await importSeed(db, seed);
      check(imp.created === 3 && imp2.created === 0 && imp2.updated === 3 && imp.rejected.length === 2, "seed importer is idempotent and rejects covered-country / email rows");
      const mk = await newco.html("/app/marketplace");
      check(mk.status === 200 && !mk.text.includes("Marketplace unavailable"), `marketplace renders (got ${mk.status} ${mk.text.match(/Marketplace unavailable[^<]*/)?.[0] ?? ""})`);
      check(mk.text.includes("Example Prospect Separation (fictional)"), `marketplace lists imported prospects (${mk.text.match(/(\d+) listing\(s\)/)?.[0]})`);
      check(mk.text.includes("Unverified, from public sources") && mk.text.includes('data-testid="marketplace-map"'), "prospects labelled unverified, with the map");
      check(!(await anon.html("/suppliers")).text.includes("Example Prospect Separation"), "prospects stay out of the public directory");
      const tw = await newco.html("/app/marketplace?region=Taiwan&stage=separation");
      check(tw.text.includes("Example Prospect Separation (fictional)") && !tw.text.includes("Example Prospect Recycler"), "region + stage filters");
      check((await newco.html("/app/marketplace?stage=recycling")).text.includes("Example Prospect Recycler (fictional)"), "recycling activity filter");
      const api = await newco.json<{ listings: { name: string; status: string }[] }>("/api/marketplace?status=prospect");
      check(api.status === 200 && api.body.listings.length >= 3 && api.body.listings.every((l) => l.status === "Unverified, from public sources") && !JSON.stringify(api.body).includes("@"), "marketplace API: prospects only, no contact details");
      check((await anon.req("/api/marketplace")).status === 401, "marketplace API needs sign-in");
      const pl = await db.supplierListing.findUniqueOrThrow({ where: { sourceKey: "example-separation-tw" } });
      const detail = await newco.html(`/app/marketplace/${pl.id}`);
      check(detail.status === 200 && detail.text.includes('data-testid="request-intro"') && !/mailto:|tel:/.test(detail.text.split("<footer")[0]), "listing page has Request intro and no contact details");
      const intro = await newco.json<{ id: string; duplicate: boolean }>("/api/intros", { method: "POST", json: { listingId: pl.id, message: "NdPr metal for sintered magnets (synthetic e2e)" } });
      check(intro.status === 201 && !intro.body.duplicate, `intro requested (got ${intro.status} ${JSON.stringify(intro.body)})`);
      check(mailTo("team@e2e.lodeline.test", /Intro request: Example Prospect Separation/).length === 1, "intro request routed to the Lodeline team inbox");
      check((await newco.json<{ duplicate: boolean }>("/api/intros", { method: "POST", json: { listingId: pl.id } })).body.duplicate, "open request is not duplicated");
      check((await admin.html("/admin/intros")).text.includes("Example Prospect Separation (fictional)"), "admin sees the intro request");
      check((await admin.json(`/api/admin/intros/${intro.body.id}`, { method: "PATCH", json: { status: "introduced" } })).status === 200, "admin marks it introduced");
      check((await newco.json(`/api/admin/intros/${intro.body.id}`, { method: "PATCH", json: { status: "closed" } })).status === 403, "buyer cannot change intro status");

      // Supply-chain map linked to the trace's open stages.
      const map = await buyer.html(`/app/map?trace=${packId}`);
      check(map.status === 200 && map.text.includes('data-testid="supply-chain-map"') && map.text.includes('data-testid="stage-country-table"'), "supply-chain map renders with the stage x country table");
      check(map.text.includes("Find a China-free supplier for this open stage") && map.text.includes("excludeCovered=1"), "open trace stages link to China-free marketplace searches");

      // My listings (seller side).
      const ml = await buyer.html("/app/listings");
      check(ml.status === 200 && ml.text.includes("Magnet Assemblies") && ml.text.includes("seller role"), "My listings shows the seller's own listing");
      check((await newco.html("/app/listings")).text.includes("Example Prospect Separation (fictional)"), "My listings shows the buyer's intro requests");
    });

    // ---------------------------------------------------------------- safety
    const serverLog = log.join("");
    check(!/ 500 in \d/.test(serverLog) && !serverLog.includes("[api] unhandled error"), "no request returned a 500 / unhandled error during the run");
    const all = mails();
    const bad = all.filter((m) => !/\.test$/i.test(m.to));
    check(bad.length === 0, `every email went to a .test address in the local outbox (bad: ${bad.map((m) => m.to).join(", ")})`);
    process.stdout.write(`\n[e2e] outbox: ${all.length} emails, all to *.test, none sent\n[e2e] artifacts: ${work}\n`);
  } finally {
    await app?.stop();
    await prisma?.$disconnect();
    await stripe.stop();
    await db0.stop();
    if (!process.env.E2E_KEEP && results.every((r) => r.ok)) rmSync(work, { recursive: true, force: true });
    else process.stdout.write(`[e2e] kept ${work}\n`);
    if (results.some((r) => !r.ok) && log.length) process.stdout.write(`[e2e] last server log:\n${log.join("").slice(-4000)}\n`);
  }
}

main()
  .then(() => {
    printTable();
    process.exit(results.length === 9 && results.every((r) => r.ok) ? 0 : 1);
  })
  .catch((e) => {
    printTable();
    process.stdout.write(`[e2e] FAILED: ${(e as Error).message}\n`);
    process.exit(1);
  });

function printTable() {
  process.stdout.write("\n| Step | Result | Checks | Name |\n|---|---|---|---|\n");
  for (const r of results) process.stdout.write(`| ${r.step} | ${r.ok ? "PASS" : "FAIL"} | ${r.checks} | ${r.name}${r.error ? ` (${r.error})` : ""} |\n`);
  process.stdout.write(`\nTotal checks passed: ${checks - results.filter((r) => !r.ok).length}\n`);
}
