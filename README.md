# Lodeline platform

Supply-chain evidence for NdFeB/SmCo magnets, tungsten and tantalum (DFARS 252.225-7052).

> Lodeline provides supply-chain documentation and analysis, not legal advice or government certification.

Next.js 15 (App Router, TypeScript) · Prisma 6 · Postgres 16 · Tailwind 4 · Vitest. Hosted on Render Oregon, with S3 `us-west-2`.
The full plan is in [`docs/plan.md`](docs/plan.md).

## Setup

```bash
npm ci
cp .env.example .env        # dev works with no DB: in-memory repo + storage, console email
npm run dev                 # http://localhost:3000
npm test                    # unit tests
npm run build
```

With Postgres: set `DATABASE_URL`, then `npx prisma migrate deploy` (or `npm run prisma:migrate` while you change the schema).

Admin access: put your email in `SEED_ADMIN_EMAIL`. Your first magic-link sign-in with that address creates an admin. In dev the link is printed to the console.

Running `next start` locally without a DB/S3 needs `ALLOW_DEV_ADAPTERS=true ALLOW_CONSOLE_EMAIL=true` (never set these on Render).

## Layout (pattern copied from LoadEnergy)

```
src/domain        types + error taxonomy
src/services      pure-ish services: parts-parser, keyword-classifier, stage-rules,
                  free-audit, magic-link, audit (append-only log), authorization (ROLE_NAVIGATION)
src/infra         llm.ts (the only LLM wrapper), email.ts (console/postmark/resend), s3-document-storage.ts
src/repository    Repository port + in-memory + Prisma adapters
src/session       hashed-token sessions (in-memory + Prisma)
src/http          rate limit, Turnstile hook, cookie, auth context, error responses
src/composition   root.ts: adapter selection + production boot checks
app/              pages + app/api route handlers
```

## What works (Week 1)

- **Free parts audit, end to end**: `/audit` → `POST /api/audits` (multipart CSV/XLSX, ≤5 MB, ≤2,000 rows) → file gate → parse → classify → stage rules → `/audit/[id]?t=<token>` results page. Results are only reachable with the per-audit access token (only its hash is stored).
- **Drawing rejection** on upload: CAD/drawing/image/PDF extensions refused, and content is sniffed (PDF/DWG magic bytes, DXF/STEP headers, binary-in-CSV, non-zip XLSX) so renamed files are refused too. Nothing is stored for rejected files.
- **LLM wrapper** (`src/infra/llm.ts`): refuses unless `LLM_ZDR_CONFIRMED=true`; logs only provider/model/promptVersion/tokens/ms, never content; sends `store:false`; validates output with zod and falls back to keywords. With no `LLM_API_KEY` it runs the deterministic keyword classifier (mock). If ZDR is not confirmed, the audit uses keywords only, so no content leaves the server.
- **Stage rules**: NdFeB/SmCo need mine → separation → metal/alloy → magnet; W/Ta need mine → separation → metal. A stage is undocumented unless an accepted claim covers it (all of them, in the free audit).
- **Magic-link login**: 15-minute single-use links (stored hashed), sessions with hashed tokens in an HttpOnly cookie, and no account enumeration. Email goes through the `EmailSender` port: console by default, Postmark and Resend adapters selected with `EMAIL_PROVIDER`.
- **Roles** `buyer | supplier | admin` with `ROLE_NAVIGATION`. Page guards redirect to login, and the wrong role gets a 404.
- **Security**: per-IP rate limits (audits 10/h, magic links 5/15 min), size caps, a honeypot, a Turnstile hook (enforced when `TURNSTILE_SECRET_KEY` is set, fails closed with `TURNSTILE_REQUIRED=true`), and security headers. Production refuses to boot without a DB, S3, a base URL and LLM ZDR confirmation.
- **Audit log**: an append-only `AuditEntry` on every write (audit created/classified/failed, magic link requested/consumed, logout). The payload carries ids and metadata only, never parts content. Visible at `/admin/audit-log`.
- **Prisma schema** with every model from the plan, plus the initial migration in `prisma/migrations/`.

## Stubbed / TODO

| Area | State |
|---|---|
| Evidence packs (`/buyer/packs`, `POST /api/packs`, Stripe Checkout) | stub page / 501 (week 2) |
| Supplier token portal (`/s/[token]`, `/api/s/[token]`, `/documents`) | stub / 501 (week 2) |
| Outreach + reminder cron (`/api/cron/reminders`) | 501 (week 2) |
| PDF text, claim extraction with citation verification | not started (week 2) |
| Admin review queue, claims PATCH, pack PDF | stub / 501 (week 3) |
| Supplier directory, referrals, commission ledger | stub (P2) |
| Emailing the audit results link to the lead | TODO (in-page link only today) |
| Postmark/Resend adapters | implemented but never exercised against the live APIs |
| Rate limiter | in-process (single instance only) |
| Turnstile widget | rendered when `TURNSTILE_SITE_KEY` is set; no keys yet |

## Deploy

`render.yaml`: Oregon web service plus Postgres `basic-1gb`, `preDeployCommand: npx prisma migrate deploy`. Every secret is declared `sync: false`.
