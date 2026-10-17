# Lodeline workflow

The happy path through the product, with the code that implements each step.

> Lodeline provides supply-chain documentation and analysis, not legal advice or government certification.

## 0. Discover (lodeline.org)
- Visitors land on the ported marketing site (`app/(site)`).
- The **readiness check** (`app/_site/readiness-check.tsx`, scoring in `src/services/readiness.ts`):
  - Gives two independent results, applicability and documentation. It never gives a percentage, and never says "compliant" or "exempt".
  - Answers stay in React state. Nothing is sent, stored or put in the URL.
- **Readiness-call form and checklist download** (`app/_site/lead-form-client.tsx`) send `POST /api/leads`, which:
  1. applies a honeypot, the per-IP Postgres rate limit (5 per hour) and Turnstile
  2. runs `LeadService.submit`
  3. writes a `Lead` row
  4. sends an email to `LEADS_NOTIFY_EMAIL`
  5. sets `notifiedAt`
- A failed email never loses the lead. Admins see leads at `/admin/leads` and can mark them contacted or closed.
- CTAs lead into the product: `/demo`, `/suppliers`, `/pack`, `/login` and `/for-suppliers`.

## 1. Directory
- `/suppliers` (`DirectoryService.search`) combines Postgres full-text search with material, stage, country, excluded-country and verified-only filters.
- **Ask** (`POST /api/suppliers/ask`):
  1. The question is turned into filters by the LLM (or a keyword parser).
  2. The DB query runs.
  3. The answer cites only the returned rows.
- Only `published` listings are public. "Verified" requires accepted evidence documents (`DirectoryService.verify`).

## 2. Free audit or demo
- **`/demo`** sends `POST /api/demo`. A fictional 8-line motor/actuator parts list (`src/services/demo-sample.ts`) goes through the real `FreeAuditService`, then the browser is redirected to `/audit/[id]?t=…&demo=1`. The demo is rate-limited with the audit limiter, and demo results are not emailed.
- **`/audit`** sends `POST /api/audits`, which runs these checks in order:
  1. Turnstile
  2. the rate limit
  3. a 5 MB cap
  4. a drawing/CAD/PDF/image refusal
  5. CSV/XLSX parsing
  6. LLM or keyword classification
  7. stage rules
- The results link is then emailed to the lead.

## 3. Paid evidence pack
- On the results page, **Order an evidence pack** sends `POST /api/packs` (sign-in required). The magic link keeps the `next` path so the order survives sign-in.
- `PackService.create` creates the `EvidencePack` and the buyer's `Organization`, then opens a Stripe Checkout session.
- `POST /api/webhooks/stripe` verifies the signature and calls `markPaid`, which is idempotent per event and per pack. The pack moves to `collecting`.
- Without Stripe in dev, `DevBilling` marks the pack paid at once.

## 4. Supplier uploads
- On `/buyer/packs/[id]` the buyer adds suppliers for chosen parts (`SupplierService.addRequest`). Each `SupplierRequest` has:
  - a 256-bit token, stored as a SHA-256 hash plus AES-GCM ciphertext
  - a 30-day TTL, and it can be revoked
  - an outreach email
- **Reminders** run on days 3, 7 and 14 from `/api/cron/reminders` (Bearer `CRON_SECRET`). They stop on upload, bounce, revoke or expiry.
- **Upload flow** at `/s/[token]`:
  1. `POST /api/s/[token]/uploads` returns a presigned S3 PUT (signed size, SSE).
  2. The browser PUTs the file directly to storage.
  3. `POST /api/s/[token]/documents` processes it.
- **Processing** (`EvidenceIntakeService`):
  1. magic-byte check and SHA-256
  2. unpdf text per page
  3. drawing and ITAR/CUI rejection
  4. claim extraction with the verbatim-citation filter
  5. geocoding (cached) and the covered-country flag
- Claims land as `in_review`.

## 5. Review
- Admins work from `/admin/review` and `/admin/review/[claimId]`. The cited page text is shown with quotes highlighted, and the source PDF opens via a 5-minute presigned link. The admin accepts, rejects or edits the claim; edits re-geocode and re-flag.
- Every decision is written to the append-only audit log (`/admin/audit-log`).

## 6. Pack PDF
- `buildPackMatrix` uses accepted claims only.
- `GET /api/packs/[id]/pdf` renders the PDF on demand. `POST /api/admin/packs/[id]/generate` stores it and marks the pack `ready`.
- The PDF contains the stage table, verbatim citations, facility coordinates, a document register with SHA-256 hashes, open questions, stated limits and the disclaimer.

## 7. Marketplace referral (stub)
- Where the pack shows a stage with no documented source, the plan is to introduce verified directory suppliers and track the outcome. The `Referral` and `CommissionInvoice` tables exist; the workflow and UI do not yet.

## Supplier listing applications
1. A supplier applies at `/for-suppliers` (`POST /api/supplier-applications`): honeypot, rate limit of 3 per hour, Turnstile, zod validation (stages, materials, an http(s) website, a known country).
2. `SupplierApplication` is created with status `pending`, and the team is emailed.
3. An admin works the queue at `/admin/applications`:
   - **Approve** creates a `SupplierListing` with `published=false` and `verifiedAt=null`, linked to the application.
   - **Reject** records a note.
4. To verify, the admin requests documents, reviews them, then verifies the listing from the accepted documents and publishes it at `/admin/suppliers`.
