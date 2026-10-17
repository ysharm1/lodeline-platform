# Lodeline

**One product for lodeline.org:** the public marketing site, a free parts audit and demo, a paid stage-by-stage evidence pack, a supplier upload portal, an admin review queue, a generated pack PDF, and a searchable supplier directory. It covers NdFeB/SmCo magnets, tungsten and tantalum under DFARS 252.225-7052.

> Lodeline provides supply-chain documentation and analysis, not legal advice or government certification. Applicability, exceptions, and acceptance depend on the contract and the responsible reviewer.

Contact: [info@lodeline.org](mailto:info@lodeline.org) · Yash Sharma, (602) 315-9861

**Stack**
- Next.js 15 (App Router, TypeScript)
- Prisma 6 and Postgres 16
- Tailwind 4 for the app, plus the original lodeline.org CSS for the public pages
- Vitest
- `@react-pdf/renderer` and `unpdf`
- Stripe Checkout
- Postmark or Resend
- S3 (us-west-2)
- Nominatim or Mapbox
- Leaflet

**Further reading**
- [`docs/workflow.md`](docs/workflow.md): the product workflow, step by step
- [`docs/architecture.md`](docs/architecture.md): code layout, data model and security controls
- [`docs/plan.md`](docs/plan.md): the original build plan

---

## Product overview

| Surface | Path | Who |
|---|---|---|
| Marketing site (ported from lodeline.org) | `/`, `/sample-evidence-pack`, `/readiness-checklist`, `/industries/*`, `/privacy` | public |
| 6-question readiness check (runs in the browser, answers never sent) | `/#check` | public |
| Readiness-call request and checklist download (stored in Postgres, emailed to the team) | `/#contact`, `/#checklist` | public |
| Free demo (fictional parts list through the real audit pipeline) | `/demo` | public |
| Free parts audit (CSV/XLSX upload; results link emailed) | `/audit`, `/audit/[id]?t=…` | public |
| Evidence pack (Stripe Checkout, $2,000–$5,000 fixed fee, default $2,500) | `/pack`, `/buyer/packs`, `/buyer/packs/[id]` | buyer |
| Supplier upload portal (tokenized link, no login) | `/s/[token]` | supplier |
| Admin review queue, packs, directory CRUD, supplier applications, leads, audit log | `/admin/*` | admin |
| Supplier directory with full-text search and a grounded Ask box | `/suppliers`, `/suppliers/[id]` | public |
| "For suppliers": application to be listed as a documented source | `/for-suppliers` | public |
| SEO | `/sitemap.xml`, `/robots.txt`, OG and Twitter metadata, canonical URLs on `APP_BASE_URL` | – |

### Marketing site is a 1:1 copy

The lodeline.org pages are reproduced exactly: same design, layout, copy and link targets. Nothing is added to them and nothing is reworded. A test (`app/_site/site.test.ts`) checks every page's visible text, `href`s and classes against the snapshot in `vendor/lodeline-site/`.

The platform pages (`/demo`, `/pack`, `/suppliers`, `/for-suppliers`, `/audit`, `/login` and the signed-in areas) are **new, separate pages**. They link back to the site (`/`, `/#contact`, `/sample-evidence-pack`, `/privacy`). The marketing pages don't link to them yet.

Adding entry points (for example, pointing an existing CTA at `/demo`) is an owner decision. If approved, make the change as a link-target-only patch in `scripts/port-site.py`.

## Workflow

```
directory ─► free audit / demo ─► paid pack (Stripe) ─► supplier uploads (/s/[token])
   ▲                                                         │
   │                                                         ▼
marketplace referral ◄── pack PDF ◄── admin review (accept/reject/edit claims)
```

1. **Directory.** A buyer searches documented suppliers by material, stage and country, and can ask the directory a question in plain language.
2. **Free audit or demo.** The buyer uploads a parts list. Each part is classified for covered material, and every required upstream stage shows as "no document yet". The results link is emailed.
3. **Paid pack.** The buyer orders a pack from the results page and pays through Stripe Checkout. The webhook marks the pack paid, idempotently.
4. **Supplier uploads.** The buyer adds supplier contacts. Each gets a private 30-day link and reminders on days 3, 7 and 14. Files go straight to S3 through a presigned PUT. Drawings and ITAR/CUI-marked files are rejected.
5. **Review.** Text is extracted, and claims (issuer, date, stage, facility, address, country) must quote the page verbatim. Facilities are geocoded and covered countries (CN/RU/IR/KP) flagged. An admin accepts, rejects or edits each claim.
6. **Pack PDF.** Only accepted claims reach the buyer page, the map and the PDF.
7. **Marketplace referral.** Where a stage has no documented source, Lodeline introduces verified directory suppliers. Today only the schema exists; see *Stubbed*.

Suppliers can also apply at `/for-suppliers`. An approved application becomes an **unpublished, unverified** listing. It is only marked verified when backed by accepted evidence documents.

Details: [`docs/workflow.md`](docs/workflow.md).

## Architecture (short)

```
app/(site)/        lodeline.org pages: own root layout + original site CSS (no Tailwind)
app/(platform)/    product pages: own root layout + Tailwind + AppShell (role nav)
app/_site/         ported markup (generated), client islands, SEO helpers
app/api/           route handlers (public, buyer, supplier-token, admin, webhooks, cron)
src/domain         types + error taxonomy
src/services       business logic (free audit, packs, suppliers, intake, review, directory,
                   leads, supplier applications, readiness scoring, pack matrix/PDF, …)
src/infra          llm.ts (only LLM entry point; ZDR guard), email, billing (Stripe/dev), S3, pdf text
src/http           rate limiter (Postgres), Turnstile, cookies, auth context, error mapping
src/composition    root.ts: adapter selection + production boot checks
prisma/            schema + migrations + seed (example-only directory rows)
vendor/lodeline-site/  snapshot of the live lodeline.org HTML/CSS (source for the port)
scripts/port-site.py   regenerates app/_site/pages/*.tsx and the site CSS from vendor/
```

The two route groups have separate root layouts. Navigating between the marketing pages and the app therefore does a full page load, which keeps the two CSS systems isolated. Details: [`docs/architecture.md`](docs/architecture.md).

### The lodeline.org port

The site's source isn't in GitHub, so the live pages were fetched into `vendor/lodeline-site/` on 16 Oct 2026. Images, `mark.svg` and the checklist PDF were fetched into `public/assets/`.

`scripts/port-site.py` converts each page into JSX, keeping the copy, markup, classes and links verbatim. Every page comes across:
- the home page, section by section
- the four industry pages
- the sample evidence pack
- the readiness checklist
- privacy

There are no copy or layout patches.

The interactive parts are React islands:
- **`ReadinessCheck`**: the scoring is ported 1:1 to `src/services/readiness.ts` and tested. Answers live in component state only.
- **`LeadForm`** and **`ChecklistForm`**: these POST to `/api/leads`, which applies a honeypot, a Postgres rate limit and Turnstile. The lead is stored in the `Lead` table and the team is notified through the email sender.
- **`SiteBehaviors`**: the frosted nav, mobile sheet, reveal-on-scroll, sticky "Book" bar and print button.

The original site's third-party lead/visitor endpoints (Cornerstone CRM, Web3Forms, visit beacon) are not ported. To re-sync after the live site changes:

```bash
curl -s https://lodeline.org/ -o vendor/lodeline-site/index.html   # etc.
python3 scripts/port-site.py
```

## Local development

```bash
npm ci
cp .env.example .env
npm run db:start                       # embedded Postgres 16 on :54329 (data in .pgdata/), prints DATABASE_URL
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54329/lodeline
npx prisma migrate deploy
SEED_ADMIN_EMAIL=you@example.com npm run seed   # admin + 4 clearly-marked EXAMPLE directory rows
npm run dev                            # http://localhost:3000
```

**Dev behaviour**
- **Magic links** and all other email are printed to the console (`EMAIL_PROVIDER=console`).
- **Billing:** with no `STRIPE_SECRET_KEY`, packs are marked paid immediately (dev billing).
- **Storage:** with no S3 bucket, uploads go to `.uploads/` through HMAC-signed local URLs.
- **LLM:** with no key, or `LLM_ZDR_CONFIRMED` not set to true, classification and extraction use the deterministic keyword/label extractors.

**Running a production build locally**

```bash
npm run build
NODE_ENV=production ALLOW_DEV_ADAPTERS=true ALLOW_CONSOLE_EMAIL=true \
  APP_BASE_URL=http://localhost:3000 LLM_ZDR_CONFIRMED=true SESSION_SECRET=dev-only npm start
```

Never set `ALLOW_DEV_ADAPTERS` or `ALLOW_CONSOLE_EMAIL` on a real deployment.

**Tests**

```bash
npm run typecheck
npm test            # unit + db projects; db tests start their own embedded Postgres (or TEST_DATABASE_URL)
npm run build
```

CI (`.github/workflows/ci.yml`) runs typecheck, the tests and the build against a `postgres:16` service container.

## Deploy

The order of preference is Vercel with the `lodeline.org` domain, or Render.

### Vercel (lodeline.org)

1. Import `ysharm1/lodeline-platform` as a new Vercel project (framework: Next.js). `vercel.json` sets:
   - region `iad1`
   - `prisma migrate deploy && next build`
   - a daily cron on `/api/cron/reminders`
   - 60 s max duration for the processing, PDF and cron routes
2. Create a US-region Postgres database:
   - **Neon:** set `DATABASE_URL` to the pooled URL.
   - **Supabase:** use the session pooler on port 5432 so migrations work.
3. Set the env vars below, with `APP_BASE_URL=https://lodeline.org`.
4. **Domain cutover (owner action, not done).** lodeline.org is currently served by a different Vercel project (`lodeline.vercel.app`). This repo does not touch that project, its DNS or its deployment. When Yash decides to cut over:
   - In that project, remove `lodeline.org` and `www.lodeline.org` under Settings → Domains.
   - Add both to this project. Make the apex primary and redirect `www` to it.
   - DNS stays on Vercel's records (A `76.76.21.21` / CNAME `cname.vercel-dns.com`), so no registrar change is needed if the domain already points at Vercel.
5. Pages that are pre-rendered at build time (the marketing pages, sitemap and robots) read `APP_BASE_URL`, `TURNSTILE_SITE_KEY` and `CALENDLY_URL` **at build time**. Redeploy after changing them.
6. Add `https://lodeline.org` to the S3 bucket CORS (PUT/GET).
7. Stripe:
   - Add the webhook endpoint `https://lodeline.org/api/webhooks/stripe` for the event `checkout.session.completed`.
   - Put the signing secret in `STRIPE_WEBHOOK_SECRET`.
8. Email:
   - Verify `lodeline.org` in Postmark or Resend (SPF/DKIM).
   - Point the provider's webhook at `/api/webhooks/email`.

### Render (Oregon)

`render.yaml` defines:
- the web service, with `preDeployCommand: npx prisma migrate deploy`
- Postgres `basic-1gb`
- a daily cron service that curls `/api/cron/reminders` with the `CRON_SECRET` bearer
- every secret declared with `sync: false`

Add `lodeline.org` and `www.lodeline.org` under Custom Domains. `APP_BASE_URL` already defaults to `https://lodeline.org` in the blueprint.

### S3

- Bucket in us-west-2, with Block Public Access and SSE-S3.
- CORS allows `PUT` and `GET` from `APP_BASE_URL`, with the headers `content-type` and `x-amz-server-side-encryption`.

## Environment variables

Production refuses to boot without the **required** variables (`src/composition/root.ts`).

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Postgres |
| `APP_BASE_URL` | yes | canonical origin: emails, Stripe redirects, sitemap, OG (`https://lodeline.org`) |
| `SESSION_SECRET` | yes | session/HMAC secret; also the fallback token-encryption key |
| `LLM_ZDR_CONFIRMED` | yes (`true`) | confirms a zero-data-retention LLM agreement; the wrapper refuses otherwise |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | yes | Checkout and webhook verification |
| `CRON_SECRET` | yes | bearer for `/api/cron/reminders` |
| `S3_DOCS_BUCKET`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | yes | document storage (`S3_ENDPOINT` for S3-compatible stores) |
| `EMAIL_PROVIDER` (`postmark`/`resend`), `POSTMARK_SERVER_TOKEN` or `RESEND_API_KEY`, `EMAIL_FROM` | yes | outbound email |
| `EMAIL_WEBHOOK_SECRET` | recommended | Resend Svix secret or Postmark basic-auth password |
| `SEED_ADMIN_EMAIL` | recommended | comma-separated emails that become admins on first sign-in |
| `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`, `LLM_PROVIDER` | optional | LLM classification, extraction and Ask; keyword fallback without a key |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `TURNSTILE_REQUIRED` | recommended | bot protection on the audit, lead, application and supplier-upload forms |
| `TOKEN_ENCRYPTION_KEY` | recommended | encrypts supplier-link tokens at rest |
| `PACK_PRICE_CENTS` (200000–500000) or `STRIPE_PRICE_PACK_STANDARD` | optional | pack fee (default $2,500) |
| `GEOCODER` (`nominatim`/`mapbox`/`none`), `GEOCODER_USER_AGENT`, `NOMINATIM_BASE_URL`, `MAPBOX_TOKEN` | optional | facility geocoding |
| `LEADS_NOTIFY_EMAIL` | optional | where lead and application notifications go (default `info@lodeline.org`) |
| `CALENDLY_URL` | optional | inline booking in the contact section; an empty string means form only |
| `RATE_LIMIT_AUDITS_PER_HOUR`, `RATE_LIMIT_LEADS_PER_HOUR` | optional | per-IP limits (defaults 10 and 5) |
| `SUPPLIER_TOKEN_TTL_DAYS` | optional | supplier link lifetime (default 30) |

## What's stubbed or not done

| Area | State |
|---|---|
| Marketplace referrals / commission ledger | schema only (`Referral`, `CommissionInvoice`); `/admin/referrals` is a stub |
| OCR for scanned certificates | not built; image-only PDFs are flagged for manual claim entry |
| Background job queue | document processing runs inside the request (60 s max); move to a queue as volume grows |
| Supplier accounts | suppliers use token links only; `/supplier` is a placeholder |
| Applicant email on approval or rejection | not sent automatically; admins reply from the queue |
| Map image in the PDF | coordinate table instead |
| Calendly "booked" notification | not ported (Calendly emails the booking itself) |
| Live Stripe/Postmark/Resend/Nominatim/Turnstile | adapters implemented and tested with fakes; not exercised against live services in CI |
| Privacy notice | copied verbatim from lodeline.org. It still describes the old pipeline (HighLevel CRM, Web3Forms fallback, text alerts, visit notice). The platform instead stores leads in Postgres, emails the team and has no visit beacon. **Owner decision needed:** update the copy, or restore the old pipeline, before this app serves lodeline.org |
| Entry links from the marketing pages to the platform | none, by design (1:1 copy); owner decision |
