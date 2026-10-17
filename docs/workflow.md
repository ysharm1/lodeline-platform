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
- The marketing pages are a 1:1 copy of lodeline.org, so their CTAs keep their original targets (`#contact`, `/sample-evidence-pack`, …). The platform pages (`/demo`, `/suppliers`, `/pack`, `/login`, `/for-suppliers`) are separate pages.

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
  6. classification (rules-v2, see "Classification" below)
  7. stage rules (only for parts with a known covered material)

### Classification (rules-v2)
- **Columns.** The parser keeps Part Number, MPN, Description, Manufacturer, Supplier, Material and Notes/Comments (broad header synonyms: `MFR`, `Mfg P/N`, `Vendor`, `Material Spec`, `Remarks`, …). All of them go to the classifier.
- **Categories.** Every part gets exactly one, with a reason that cites the rule or pattern id and the column it matched (e.g. `[ndfeb.grade, Description]`):
  - **Likely covered**: a named material (NdFeB grade/`neo`/`rare earth`, SmCo/`2:17`/`1:5`/`samarium`, tungsten/`W` in the Material column/heavy alloy/`W-Ni-Fe`/densimet, tantalum/`TANT`/`Ta`) or a verified manufacturer+MPN pattern.
  - **Possible: confirm with supplier**: weaker signals (`balance/ballast/counter weight`, `molded polarized` capacitor, BLDC/servo), conflicting signals (e.g. NdFeB and ferrite in one row), a bare `motor/magnet/speaker/actuator` (needs check, no material assumed), or an empty description.
  - **Likely not covered**: a negative rule (ferrite, ceramic magnet, C5/C8, AlNiCo, ceramic/aluminium-electrolytic capacitor, ferrite brushed motor) with no conflicting signal, or no signal at all. The reason always says which; ambiguous rows are never silently cleared.
- **Pattern table.** `src/services/part-patterns.data.ts` holds manufacturer + MPN patterns. Each entry carries source URLs and the date it was checked; only add patterns verified on a manufacturer or major distributor page.
- **LLM.** Only rows still uncertain after rules (no signal) go to the LLM, in batches of 50, with PN, MPN, manufacturer, supplier, material, notes, description and the rule hint, behind the `llm.ts` ZDR guard. With no key the LLM step is skipped (`llmModel = keyword-mock`). The LLM can upgrade a row but never clears one the rules marked possible.
- The results link is then emailed to the lead.

## 3. Paid evidence pack
- On the results page, **Order an evidence pack** sends `POST /api/packs` (sign-in required). The magic link keeps the `next` path so the order survives sign-in.
- `PackService.create` creates the `EvidencePack` and the buyer's `Organization` (roles `[buyer]`) with a buyer `Membership` (org admin), then opens a Stripe Checkout session.
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
