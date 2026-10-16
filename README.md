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

## Setup with Postgres (no Docker needed)

```bash
npm run db:start            # embedded Postgres 16 on :54329, data in .pgdata/ (prints DATABASE_URL)
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54329/lodeline
npx prisma migrate deploy
SEED_ADMIN_EMAIL=you@example.com npm run seed   # admin + 4 clearly-marked EXAMPLE directory rows
npm run dev
```

Tests: `npm test` runs the `unit` project and the `db` project. The `db` project starts an embedded Postgres (or uses `TEST_DATABASE_URL`), runs `prisma migrate deploy` and exercises the real SQL. CI (`.github/workflows/ci.yml`) uses a `postgres:16` service container.

## What works

### Free audit (Week 1)
- `/audit` upload, then a file gate (drawings refused), parse, classify (LLM wrapper or keyword fallback), and stage rules. Results are at `/audit/[id]?t=<token>`.
- **The results link is emailed** to the lead through the `EmailSender` port. The audit log records `audit.results_emailed`, or `audit.results_email_failed` if the send fails (non-fatal).

### Evidence pack ($2k–$5k fixed fee)
- `POST /api/packs` `{auditId, accessToken}`: a signed-in buyer who holds the audit link creates a pack, gets an Organization (created lazily) and is sent to **Stripe Checkout**. The price is `PACK_PRICE_CENTS`, validated to the 200000–500000 range (default $2,500); `STRIPE_PRICE_PACK_STANDARD` can be used instead. With no Stripe key, outside production, packs are marked paid immediately (dev billing).
- `POST /api/webhooks/stripe`: verifies the raw-body signature, ignores unpaid sessions, and is idempotent per event id (`WebhookEvent`) and per pack.
- `/buyer/packs/[id]`: shows status per part and stage (documented / covered country / pending review / requested / no document), a Leaflet + OSM map of facilities from accepted evidence, supplier requests with revoke, the add-supplier form and the PDF download.

### Supplier evidence
- Buyers add suppliers for selected parts, which creates a `SupplierRequest`:
  - 256-bit token, looked up by SHA-256 only. It is also stored AES-GCM encrypted (`TOKEN_ENCRYPTION_KEY`), so reminders can resend the same link.
  - Expires after `SUPPLIER_TOKEN_TTL_DAYS` (30) and can be revoked.
- Outreach emails go out through Postmark or Resend (console in dev). **Reminders at day 3, 7 and 14** after the initial email come from `GET|POST /api/cron/reminders`, which requires `Authorization: Bearer $CRON_SECRET`. Vercel Cron sends that header automatically; Render runs a `type: cron` service that curls the route. Reminders stop on an upload, a bounce, revocation or expiry.
- `POST /api/webhooks/email` receives Resend events (Svix signature) or Postmark events (Basic auth with `EMAIL_WEBHOOK_SECRET`). Opens and bounces update the request, and duplicate events are ignored.
- `/s/[token]` is the supplier portal, with no login. Upload flow:
  1. The browser asks for a **presigned PUT** (S3 with signed Content-Length and SSE; local-disk HMAC URLs in dev).
  2. It PUTs the file directly to storage. Bodies never pass through the app server, so the 4.5 MB Vercel limit doesn't apply. The cap is 20 MB.
  3. It calls `/documents` to process the file.
- Processing:
  - Magic-byte check and SHA-256, then per-page text with **unpdf**.
  - **Drawing rejection**: CAD extensions; title-block heuristics (sparse page plus 3 or more of SCALE / REV / SHEET n OF n / DRAWN BY / CHECKED / TOLERANCES / UNLESS OTHERWISE SPECIFIED / projection…, or 5 or more on any page); ITAR / export-controlled / CUI markings. Image-only PDFs are kept but flagged for manual review (no OCR).
  - **Claim extraction** (issuer, date, stage, facility, address, country) through `llm.ts` (guarded by ZDR; a deterministic "Label: value" extractor runs without a key). The **verbatim-citation filter** keeps a field only if its quote appears verbatim (whitespace-normalised, case-sensitive) on the cited page and contains the value. Claims with no verified field are dropped.
  - **Geocoding**: Nominatim by default, with a contactable User-Agent, at most 1 request per second, and a **DB cache that includes misses**. Mapbox is available with `GEOCODER=mapbox`. Latitude, longitude and ISO country are stored.
  - **Covered countries (CN, RU, IR, KP)** are flagged deterministically when the stated OR geocoded country is covered, and any mismatch is recorded in `coveredReason`.
- Every claim lands as `in_review`.

### Admin review
- `/admin/review`: the queue. `/admin/review/[claimId]`: a side-by-side view of the cited page text with the quotes highlighted, a link to the source PDF page (presigned, 5 min), and accept / reject / edit. Edits re-geocode and re-flag. Every decision is audited. **Only accepted claims ever reach the buyer page, the map or the PDF.**
- Documents with no extractable claims are listed. Manual claims can be added via `POST /api/admin/documents/[id]/claims`.

### Evidence pack PDF
- `@react-pdf/renderer`, built from the DB only, contains:
  - the stage table per part
  - accepted claims with verbatim citations
  - a facility coordinate table (no tile snapshot in the PDF)
  - a document register with SHA-256
  - open questions per gap
  - stated limits, and the disclaimer on the first and last page and in the footer
- `GET /api/packs/[id]/pdf` renders it on demand. `POST /api/admin/packs/[id]/generate` stores it in S3 and marks the pack `ready`.

### Supplier directory
- `/suppliers`: public. Uses Postgres full-text search (`websearch_to_tsquery` with a GIN expression index) plus filters for material, stage, country, excluded country and verified-only. JSON is at `GET /api/suppliers`.
- **Ask box** (`POST /api/suppliers/ask`, rate limited):
  - The LLM, or a keyword parser when there is no key, turns the question into structured filters, and the DB query runs.
  - The answer can only cite the returned rows. Unknown `[n]` refs cause a fallback to a deterministic answer, and the LLM is never called with zero rows.
- Admin CRUD is at `/admin/suppliers`. **Verification** needs evidence documents with at least one accepted claim, and records the document and claim ids. The seed creates 4 fictional rows marked as examples.

### Platform
- **Rate limiting in Postgres** (`RateLimitBucket`, one atomic upsert per check, shared across instances) for audits, magic links, supplier uploads and Ask.
- Magic links carry a validated `next` path, so ordering a pack from the audit page survives login.

## Deploy

### Render (Oregon), primary
`render.yaml` sets up:
- the web service, with `preDeployCommand: npx prisma migrate deploy`
- Postgres `basic-1gb`
- a daily `type: cron` reminder job
- every secret declared with `sync: false`

### Vercel, alternative
`vercel.json` sets:
- region `iad1` (US East)
- a daily cron on `/api/cron/reminders`; set `CRON_SECRET` and Vercel sends the Bearer header
- 60 s max duration for the processing, PDF and cron routes
- `prisma migrate deploy` in the build

Use a US-region **Neon** or **Supabase** Postgres. For Neon, `DATABASE_URL` is the pooled URL; if you add `directUrl` to the schema, migrations use the direct URL. For Supabase, use the session pooler (port 5432) for migrations. Uploads already bypass the 4.5 MB function body limit through presigned S3 PUTs.

### S3 bucket
- us-west-2, Block Public Access on, SSE-S3.
- CORS: allow `PUT` and `GET` from `APP_BASE_URL` with the `content-type` and `x-amz-server-side-encryption` headers.

## Stubbed / not done

| Area | State |
|---|---|
| OCR for scanned certificates | not built (scans flagged for manual entry) |
| Background job queue | processing runs inside the upload request (60 s max); move to a worker/queue when volumes grow |
| Referrals / commission ledger | schema only (`Referral`, `CommissionInvoice`); admin page still a stub |
| Supplier accounts | suppliers use token links only |
| Map snapshot image in PDF | coordinate table instead (no tile-server dependency at render time) |
| Live Postmark/Resend/Stripe/Nominatim calls | adapters implemented and unit-tested with fakes; not exercised against live services from CI |

