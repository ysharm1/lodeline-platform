# Lodeline: Repo Changes Plan (supersedes the magnets module in code-edits.md)

Source reviewed: `ysharm1/LoadEnergy` read-only clone at `/workspace/LoadEnergy-ro`, commit `5efd998` (2026-10-11 22:09 PT). I could not refresh it (`gh` is not authenticated on the box), so check for any commits pushed after that date. Nothing was pushed and no PRs were opened.
Prior spec: `/workspace/rare-earth/code-edits.md` (magnets P0 inside LoadEnergy). **This document replaces that plan.** See §5.

---
## 1. Current repo summary (what exists)

| Area | What's there (real paths) | Reuse for Lodeline? |
|---|---|---|
| Stack | Next 15.5, React 19, Prisma 6.19.3, Postgres 16, Vitest 4 + fast-check (`package.json`, `vitest.config.ts`) | Same stack: copy it |
| Layering | `src/domain/types.ts` → `src/services/*.ts` → `src/http/handlers/*.ts` → `app/api/**/route.ts`; DI in `src/composition/root.ts`; repo port `src/repository/repository.ts` + `in-memory.ts` / `prisma.ts` / `repository-contract.ts` | Copy the pattern (very testable) |
| Auth | Phone + bcrypt password (`src/services/auth.ts`, `src/services/password.ts`). Server sessions store a SHA-256 token hash (`src/session/prisma-store.ts`, `src/http/session-cookie.ts`, `src/http/auth-context.ts`, `app/_lib/session.ts`). `User.phone` is **required and unique** | Copy the session code. The login identity must change to email (B2B compliance buyers) |
| Roles | `enum Role { buyer supplier admin }`, `requireAction`/`requireAdmin`, `ROLE_NAVIGATION` (`src/services/authorization.ts` ~L476–495) | Copy. Add `reviewer`, and give suppliers token-only access |
| Models | Company (kind buyer/supplier, approval status, geo radius), User, Session, Site, Request, Offer, Order, Delivery, CommissionInvoice, AuditEntry, PilotGeofence (`prisma/schema.prisma`) | Copy the shapes of Company/User/Session/AuditEntry. Request/Offer/Order/Delivery are diesel-specific |
| Audit log | `AuditEntry` is append-only (insert + read only) with an `AuditAction` enum (`src/services/audit.ts`) | **Reuse directly**: this meets the "audit log" compliance item |
| Upload | `src/infra/s3-ticket-photo-storage.ts` (PutObject, default region `us-west-2`, lazy env, `S3_ENDPOINT`), `src/services/ticket-photo.ts` (upload failure is non-fatal). `src/http/request.ts` handles multipart fields | Generalize into `S3DocumentStorage` (US region, SSE, presigned GET) |
| Email | `src/infra/smtp-email-sender.ts` (nodemailer, plain text), the `EmailSender` port in `src/services/notifications.ts`, and a per-notification failure record | Keep the port. Add a Postmark/Resend adapter |
| SMS | `src/infra/twilio-sms-sender.ts` | Not needed |
| Commission | `src/services/commission.ts` (`commissionAmount`, `roundToCents`, `isWaivedWin`, first two wins waived), `CommissionInvoice` (one per order, unpaid/paid, marked paid by an admin), `app/admin/commission/page.tsx`, `app/api/admin/commission-due/route.ts`, `app/api/admin/invoices/[invoiceId]/mark-paid/route.ts` | Template for referral commissions: idempotent invoice per deal, admin mark-paid |
| Quote/RFQ | `Request`→`Offer`→`Order`, `src/services/matching.ts` (radius), `app/api/rfqs/route.ts`, `app/_components/supplier-rfq-inbox.tsx` | Template for the marketplace "request intro" flow (P2) |
| BOL | `Delivery` with BOL gallons, ticket number and photo key | Not reusable beyond the photo-upload pattern |
| Payments | **None.** No Stripe. Commission is tracked as a ledger and marked paid by hand | Stripe is new |
| PDF / LLM / CSV / XLSX | **None** | New |
| Deploy | `render.yaml`: Oregon web + `basic-256mb` Postgres, `migrate deploy` in the build, SMTP/S3 left commented as optional | Copy for a new blueprint |
| Planning docs | `.kiro/specs/load-energy/{requirements,design,tasks}.md` | Same format for a `.kiro/specs/lodeline/` |

## 2. Key decision: separate repo/app (recommended) vs module

**Recommend a new repo `ysharm1/lodeline`, a new Render service, and a new DB.** It is seeded by copying the scaffolding files listed in §4.
Reasons:
1. Different identity model. LoadEnergy requires a unique `User.phone` with phone login, while Lodeline needs email, magic links and supplier tokens. Changing a live pilot's auth for this is risky.
2. Different domain and brand (lodeline.vercel.app, info@lodeline.org) and a different customer (defense/EV procurement vs Phoenix fleets). A shared DB mixes compliance-sensitive supplier docs with the fuel ledger.
3. Compliance scope. The audit log, US-only storage, LLM no-retention and drawing rejection apply cleanly to a small, auditable codebase. Putting them in the diesel repo would pull it into scope.
4. Independent deploys. A heavy PDF/LLM worker should not compete with the diesel PWA on a `starter` instance.
5. Little code is actually shared. Only the layering pattern, sessions, audit, S3, the email port and the commission math carry over, and those are copied once.
Cost: duplicated boilerplate, and fixes are not shared. Fine at this stage.

Hosting: the marketing site can stay on Vercel. Run the app on **Render Oregon** (as `render.yaml` does today) or on Vercel pinned to US regions with Postgres on Render/Neon US. Render Oregon plus S3 `us-west-2` is the simplest US-hosting story.

## 3. Prisma models (new repo `prisma/schema.prisma`)

```prisma
enum Role { buyer reviewer admin }            // suppliers act via tokens; optional supplier login later
enum Stage { mine separation metal_alloy magnet component }
enum Material { ndfeb smco tungsten tantalum other }
enum AuditStatus { uploaded parsing classified failed }
enum EvidenceStatus { requested uploaded extracted in_review accepted rejected }
enum PackStatus { draft generating ready delivered }
enum OutreachStatus { queued sent opened reminded responded bounced }

model Organization { id String @id @default(uuid()); name String; kind String /* buyer|supplier|operator */; country String?; createdAt DateTime @default(now())
  users User[]; audits PartsAudit[]; listings SupplierListing[] }
model User { id String @id @default(uuid()); orgId String; role Role; email String @unique; name String?; passwordHash String?; emailVerifiedAt DateTime?; createdAt DateTime @default(now()) }
model Session { /* copy of LoadEnergy Session: tokenHash, userId, expiresAt */ }
model MagicLink { id String @id @default(uuid()); email String; tokenHash String @unique; expiresAt DateTime; usedAt DateTime? }

// 1) Free audit
model PartsAudit { id String @id @default(uuid()); orgId String?; leadEmail String; companyName String?
  sourceFileKey String; sourceFileName String; sourceSha256 String; rowCount Int; status AuditStatus; llmModel String?; promptVersion String?
  createdAt DateTime @default(now()); parts AuditPart[]; pack EvidencePack? }
model AuditPart { id String @id @default(uuid()); auditId String; rowIndex Int; partNumber String?; description String; supplierName String?; quantity Decimal?
  materials Material[]; llmConfidence Float?; llmRationale String?
  undocumentedStages Stage[]   // deterministic rules output
  ruleVersion String; @@index([auditId]) }

// 2) Evidence pack
model EvidencePack { id String @id @default(uuid()); auditId String @unique; orgId String; status PackStatus; priceCents Int
  stripeCheckoutId String?; paidAt DateTime?; pdfFileKey String?; generatedAt DateTime?
  requests SupplierRequest[]; createdAt DateTime @default(now()) }
model Supplier { id String @id @default(uuid()); name String; country String?; contactEmail String?; contactName String?; orgId String? /* if they join marketplace */ }
model SupplierRequest { id String @id @default(uuid()); packId String; supplierId String; partIds String[]; stagesRequested Stage[]
  tokenHash String @unique; tokenExpiresAt DateTime; revokedAt DateTime?
  outreachStatus OutreachStatus; lastEmailAt DateTime?; reminderCount Int @default(0); nextReminderAt DateTime?
  documents EvidenceDocument[]; emails OutreachEmail[]; @@index([nextReminderAt]) }
model OutreachEmail { id String @id @default(uuid()); requestId String; kind String /* initial|reminder|thanks */; providerMessageId String?; status String; sentAt DateTime?; error String? }
model EvidenceDocument { id String @id @default(uuid()); requestId String; fileKey String; fileName String; mime String; sha256 String; pageCount Int?
  status EvidenceStatus; rejectionReason String?   // e.g. "technical_drawing"
  textExtracted Boolean @default(false); uploadedAt DateTime @default(now()); claims EvidenceClaim[] }
model EvidenceClaim { id String @id @default(uuid()); documentId String; partId String?
  issuer String?; issueDate DateTime?; expiryDate DateTime?; stage Stage?; facilityName String?; country String?; material Material?
  citations Json  // [{page:int, quote:string}] required per field
  llmConfidence Float?; reviewStatus EvidenceStatus @default(in_review); reviewedById String?; reviewedAt DateTime?; reviewerNote String? }
model AuditEntry { /* copy of LoadEnergy AuditEntry, append-only; actorUserId?, actorSupplierRequestId?, action String, subjectId, payload Json, ip String? */ }

// 3) Marketplace
model SupplierListing { id String @id @default(uuid()); orgId String; stages Stage[]; materials Material[]; countries String[]; verifiedAt DateTime?; verifiedFromClaimIds String[]; published Boolean @default(false) }
model Referral { id String @id @default(uuid()); listingId String; buyerOrgId String; status String /* intro|won|lost */; dealValueCents Int?; commissionBps Int; createdAt DateTime @default(now()) }
model CommissionInvoice { id String @id @default(uuid()); referralId String @unique; amountCents Int; paymentStatus String @default("unpaid"); paidAt DateTime?; stripeTransferId String? }
```
Dropped from code-edits.md: `MagnetSupplier`/`MagnetSupplierStep` map to `Supplier` + `SupplierListing` + `EvidenceClaim.stage`. `MagnetRfq`/`MagnetRfqSupplier` map to `EvidencePack` + `SupplierRequest`. `TraceEngagement` maps to `EvidencePack`.

## 4. Files: routes, pages, services, infra (new repo)

**Copied and adapted from LoadEnergy:** `src/http/{request,respond,auth-context,session-cookie}.ts`, `src/domain/errors.ts`, `src/session/*`, `src/services/{audit,authorization,password}.ts`, `src/repository/*` (pattern), `app/_lib/{session,api-client}.ts`, `app/_components/app-shell.tsx`, `src/infra/s3-ticket-photo-storage.ts` → `src/infra/s3-document-storage.ts`, the `EmailSender` port from `src/services/notifications.ts`, the commission math from `src/services/commission.ts`.

Pages:
- `app/page.tsx` landing. `app/audit/page.tsx` upload (public). `app/audit/[auditId]/page.tsx` results (signed link).
- `app/login/page.tsx` (magic link). `app/buyer/packs/page.tsx`, `app/buyer/packs/[packId]/page.tsx`.
- `app/s/[token]/page.tsx` supplier upload portal (no login).
- `app/admin/review/page.tsx` review queue with a side-by-side PDF page view. `app/admin/packs/page.tsx`, `app/admin/suppliers/page.tsx`, `app/admin/referrals/page.tsx`, `app/admin/audit-log/page.tsx`.
- `app/suppliers/page.tsx` + `app/suppliers/[listingId]/page.tsx` public marketplace (P2).

API (all `runtime="nodejs"`, `dynamic="force-dynamic"`, per LoadEnergy):
- `app/api/audits/route.ts` POST (multipart CSV/XLSX, ≤5 MB, ≤2,000 rows, Turnstile + rate limit). `app/api/audits/[auditId]/route.ts` GET.
- `app/api/auth/magic-link/route.ts`, `app/api/auth/callback/route.ts`, `app/api/auth/logout/route.ts`.
- `app/api/packs/route.ts` POST (creates Stripe Checkout). `app/api/packs/[packId]/route.ts`, `app/api/packs/[packId]/suppliers/route.ts` (add contacts and send outreach), `app/api/packs/[packId]/pdf/route.ts` (presigned GET).
- `app/api/s/[token]/route.ts` GET context. `app/api/s/[token]/documents/route.ts` POST upload.
- `app/api/admin/claims/[claimId]/route.ts` PATCH accept/edit/reject. `app/api/admin/documents/[docId]/route.ts`.
- `app/api/webhooks/stripe/route.ts`, `app/api/webhooks/email/route.ts` (bounces/opens).
- `app/api/cron/reminders/route.ts` and `app/api/cron/process-jobs/route.ts` (protected by `CRON_SECRET`).
- P2: `app/api/listings/route.ts`, `app/api/referrals/route.ts`.

Services (`src/services/`):
- `parts-parser.ts`: CSV via papaparse, XLSX via exceljs. Column mapping heuristics.
- `material-classifier.ts`: batched LLM call with a JSON-schema output, a versioned prompt, and a keyword prefilter (motor, actuator, speaker, sensor, capacitor→Ta, ballast/penetrator→W).
- `stage-rules.ts`: deterministic and pure. For each material, the required stages (magnet: mine→separation→metal_alloy→magnet; W/Ta: mine→separation/refining→metal). A stage is undocumented unless an accepted claim covers it. Property-tested.
- `evidence-intake.ts`: checks hash, MIME and size, then runs the **drawing rejection** heuristic (DWG/DXF/STEP extensions; PDFs with very little text plus title-block keywords such as "SCALE", "REV", "SHEET" and "DRAWN BY"; the LLM gives a "drawing?" verdict) and records why it rejected.
- `pdf-text.ts`: per-page text (unpdf/pdf.js). OCR is out of scope for the MVP (scans get flagged for manual review).
- `claim-extractor.ts`: an LLM is given page-numbered text and must return `{field, value, page, quote}`. The server verifies that each quote appears on the cited page and drops any field whose quote does not match.
- `review.ts`, `pack-generator.ts` (`@react-pdf/renderer`, built only from accepted claims plus the audit log, with SHA-256 of the sources), `outreach.ts` (templates, reminder schedule at days 3/7/14, stop on upload), `billing.ts` (Stripe Checkout), `referral.ts` (later).

Infra (`src/infra/`): `s3-document-storage.ts`, `postmark-email-sender.ts` (or `resend-email-sender.ts`), `llm-client.ts` (a single wrapper that enforces no-retention/zero-data-retention settings, logs only model+promptVersion+tokens, and never logs content), `stripe.ts`, `job-queue.ts` (a Postgres `Job` table polled by the cron/worker. pg-boss is optional).

Nav: `ROLE_NAVIGATION` with buyer → Audits/Packs, reviewer → Review queue, admin → Review/Packs/Suppliers/Referrals/Audit log.

## 5. Env vars
`DATABASE_URL`, `NODE_ENV`, `APP_BASE_URL`, `SESSION_SECRET`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`;
`S3_DOCS_BUCKET`, `AWS_REGION=us-west-2`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (or role);
`EMAIL_PROVIDER=postmark|resend`, `POSTMARK_SERVER_TOKEN` | `RESEND_API_KEY`, `EMAIL_FROM=info@lodeline.org`, `EMAIL_WEBHOOK_SECRET`;
`LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_ZDR_CONFIRMED=true` (boot refuses to start in production without it);
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PACK_STANDARD` (later `STRIPE_CONNECT_CLIENT_ID`);
`TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `CRON_SECRET`, `SUPPLIER_TOKEN_TTL_DAYS=30`.

## 6. render.yaml (new repo)
Start from LoadEnergy's `render.yaml`, renamed (`lodeline`, `lodeline-db`), with `region: oregon` on everything and `ipAllowList: []`. Add:
- a `type: worker` (`npm run worker`) for PDF/LLM/PDF-gen jobs, or a `type: cron` (`*/10 * * * *`) that calls `/api/cron/reminders`;
- every secret from §5 declared as `sync: false` (do not leave email/S3 commented out as LoadEnergy does; they are required here);
- a Postgres plan of at least `basic-1gb`, plus a `preDeployCommand: npx prisma migrate deploy` once on a paid plan.

## 7. Dependencies
`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, `@prisma/client`/`prisma` 6.19.3, `papaparse`, `exceljs`, `unpdf` (or `pdfjs-dist`), `@react-pdf/renderer`, `postmark` or `resend`, `stripe`, the LLM SDK, `zod` (LLM output validation), `file-type` (MIME sniffing). Drop `twilio` and `nodemailer` unless SMTP is kept as a fallback.

## 8. Leave untouched (LoadEnergy)
Everything. The diesel pilot stays as it is: `prisma/schema.prisma` + its migration, `src/services/*`, `render.yaml`, `ROLE_NAVIGATION`. **Do not implement the magnets module from code-edits.md in LoadEnergy.** Open items from that spec, carried forward:
- Honeypot-only protection on public POSTs → replace with Turnstile + per-IP rate limit + size caps.
- SMTP not configured in render.yaml → the new blueprint requires an email provider.
- DFARS wording needs legal review → still open. Add it to the landing page, the audit report and the pack PDF disclaimer ("evidence compilation, not a compliance determination"; DFARS 252.225-7052 references reviewed by counsel).

## 9. Phased plan
**MVP (2–3 weeks, one dev)**
- Wk1: scaffold the repo from the copied files, schema, email magic-link auth, S3 storage, audit log, free audit (parse → classify → stage rules → results page + lead capture email).
- Wk2: Stripe Checkout for the pack, supplier records, tokenized upload portal, Postmark outreach + reminder cron, PDF text + claim extraction with citation verification, drawing rejection.
- Wk3: admin review queue, pack PDF generator, the full audit-log view, Render deploy, a security pass (rate limits, token expiry, presigned short TTLs), the seed, 1–2 pilot buyers.

**Later**
- OCR for scanned certs (Textract us-west-2), supplier accounts, re-use of accepted claims across packs.
- Marketplace listings + referrals + commission ledger (port `commission.ts`), then Stripe Connect payouts.
- SSO and CMMC/ITAR posture, SOC 2 readiness, multi-reviewer sign-off, expiry alerts on certificates.

## 10. Risks
- **LLM false negatives/positives** on parts lists. Show confidence, frame results as "likely", keep the deterministic prefilter, and let the buyer override.
- **Hallucinated citations.** Require quote-on-page verification server-side, and accept nothing without human review.
- **Controlled data.** Buyers may upload ITAR/CUI drawings or BOMs. Reject drawings, state "no CUI/ITAR" in the ToS, use US-only storage, and confirm the LLM vendor's ZDR + US processing in writing. ITAR may require US-person-only access, which an API LLM may not satisfy.
- **Supplier response rates** are low (the real bottleneck). Reminders, buyer co-signed emails and a short upload form help.
- **Email deliverability** from a new domain. Set SPF/DKIM/DMARC on lodeline.org and warm up.
- **Legal:** DFARS wording, liability for the pack's conclusions, and a marketplace referral fee that could look like a conflict with "verified".
- **Scope creep** into the marketplace before evidence packs sell. Hold P2 until there are ≥3 paid packs.
- Repo snapshot is from 2026-10-11 and was not refreshed.
