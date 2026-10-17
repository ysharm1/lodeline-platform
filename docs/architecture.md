# Lodeline architecture

## Runtime
- **Framework:** one Next.js 15 app (App Router, Node runtime for all API routes).
- **Hosting:** Vercel (iad1) or Render (Oregon).
- **Data:** Postgres 16 through Prisma 6.
- **Storage:** S3 (us-west-2, SSE). In dev, local disk with HMAC-signed URLs.

## Route groups and layouts
| Group | Root layout | Styling | Contents |
|---|---|---|---|
| `app/(site)` | `app/(site)/layout.tsx` | original lodeline.org CSS (`app/_site/site.css`, `pack.css`) + `platform.css` | `/`, `/sample-evidence-pack`, `/readiness-checklist`, `/privacy`, `/industries/*` |
| `app/(platform)` | `app/(platform)/layout.tsx` | Tailwind 4 (`globals.css`) + `AppShell` | `/demo`, `/pack`, `/audit`, `/login`, `/buyer/*`, `/s/[token]`, `/suppliers/*`, `/for-suppliers`, `/admin/*`, `/supplier` |
| `app/api` | – | – | route handlers |

Each group has its own root layout, so the two CSS systems never load on the same document.

The marketing markup in `app/_site/pages/*.tsx` is **generated** by `scripts/port-site.py` from `vendor/lodeline-site/*.html`. Don't hand-edit it; edit the patches in the script and re-run it. The interactive islands are hand-written React:
- `readiness-check.tsx`
- `lead-form-client.tsx`
- `site-behaviors.tsx`
- `turnstile.tsx`

## Layers (pattern from LoadEnergy)
```
app routes ─► src/http (auth context, rate limit, Turnstile, error mapping)
           ─► src/composition/root.ts (container(): adapters chosen from env; production boot checks)
           ─► src/services (business rules; DI via PlatformDeps)
           ─► src/infra (LLM, email, billing, S3, PDF text) + Prisma
src/domain: types + DomainError taxonomy (validation/auth/authorization/not_found/conflict/…)
```
- `container()` is a process singleton.
- `platform()` exposes the DB-backed services and throws `DATABASE_REQUIRED` without a database:
  - packs, suppliers, intake, review, directory
  - leads, applications
- In production, boot fails if any of these are missing:
  - `DATABASE_URL`, S3, `APP_BASE_URL`, `SESSION_SECRET`
  - `LLM_ZDR_CONFIRMED=true`
  - Stripe and `CRON_SECRET`
  - a real email provider

## Data model (Prisma)
| Area | Models |
|---|---|
| Identity | `Organization`, `User` (buyer/supplier/admin), `Session` (hashed token), `MagicLink` |
| Free audit | `PartsAudit`, `AuditPart` |
| Packs | `EvidencePack` (pending_payment → collecting → … → ready), `WebhookEvent` (idempotency) |
| Suppliers and evidence | `Supplier`, `SupplierRequest` (token hash + ciphertext, TTL, reminders), `OutreachEmail`, `EvidenceDocument`, `DocumentPage`, `EvidenceClaim` (verbatim quotes, geocode, covered flag, review status) |
| Directory | `SupplierListing` (published, verifiedAt, verifiedFromDocumentIds/ClaimIds, GIN FTS index), `SupplierApplication` (pending/approved/rejected → listing) |
| Marketing | `Lead` (readiness_call / checklist, ipHash, notifiedAt, status) |
| Ops | `AuditEntry` (append-only), `GeocodeCache` (hits and misses), `RateLimitBucket` |
| Referrals (stub) | `Referral`, `CommissionInvoice` |

## Security and privacy controls
- **Sessions:** HttpOnly cookie holding a random token; the DB stores only its SHA-256. Magic links are single-use, expire after 15 minutes, and use a validated `next` path.
- **Authorization:** `requireRole` and `requireAdmin` fail closed. Pages return 404 on a wrong role, so a page's existence isn't leaked.
- **Supplier links:** 256-bit tokens, looked up by hash, revocable, with a TTL.
- **Uploads:**
  - Presigned PUTs with a signed Content-Length and SSE.
  - Magic-byte checks.
  - Drawings and ITAR/CUI markings are rejected.
  - Never send controlled data to the LLM: the wrapper refuses to run without `LLM_ZDR_CONFIRMED`, sends `store:false`, logs metadata only and validates output with zod.
- **Claims:**
  - Every field must quote its page verbatim.
  - Only admin-accepted claims reach buyers.
- **Abuse:** Postgres rate limiter with one atomic upsert per check, shared across instances. Turnstile on public forms. Honeypots on the lead and application forms.
- **Audit log:** append-only. Payloads carry ids and kinds only, never contact details or document contents.
- **Leads:** IP addresses are stored only as a salted hash. The readiness check never leaves the browser.
- **Headers:** `nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`.

## SEO
- `app/sitemap.ts` and `app/robots.ts` build URLs from `APP_BASE_URL` (default `https://lodeline.org`).
- The sitemap lists only public pages. Robots disallows `/api`, `/admin`, `/buyer`, `/s`, `/login` and audit results.
- Each marketing page carries the live site's title and description, plus canonical, Open Graph and Twitter tags (`app/_site/seo.ts`).

## Testing
- Vitest runs two projects:
  - `unit`: pure logic (parsers, classifiers, readiness scoring, citation filter, countries, webhooks, the site port, SEO).
  - `db`: an embedded Postgres 16 with migrations applied, covering packs, supplier flow, directory FTS, rate limiter, leads and applications.
- CI uses a `postgres:16` service.
