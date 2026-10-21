# 05. Security and compliance

## Data we do not hold

- **No CUI, ITAR or EAR technical data.** Customers send parts lists and supplier names only. No controlled drawings.
- Contracts and onboarding say this in writing; the upload screen says it again.

## Uploads in the customer dashboard

Uploads stay **off, or locked down, until hosting and a CUI policy are decided.**

- Vercel is not GovCloud. Hosting choice (Vercel, US-only hosting, or a GovCloud-type provider): **TBD**.
- Consider US-only hosting and storage regions.
- Require an attestation at upload ("this file contains no CUI, ITAR or EAR-controlled data").
- Run `drawing-detect` (see 03) on every file: reject CAD files, technical drawings and anything marked ITAR, EXPORT CONTROLLED, EAR99 or CUI. Files with no text layer go to manual review.
- PDF only for supplier evidence, size-capped (the existing code uses 20 MB).

## AI use

- AI extraction of certificates and declarations runs **only with zero-data-retention** settings from the provider. Provider and contract: **TBD**.
- AI proposes; **a human confirms every record** before it appears in a pack.
- If zero data retention is not available, use keyword-only processing or manual entry.

## Marketplace

- Public business data only: company name, website, countries, stages, materials, production status, public source links.
- Never show contact emails or personal data. Intros go through Lodeline ("Request intro").
- China-linked suppliers are excluded from the seed; any partner or listing later found to be China-linked is flagged and unpublished.

## Claims we must not make

- No "verified compliant", "DFARS compliant", "certified" or similar on listings, packs, the website or sales emails.
- Lodeline **records what documents say**. It does not make a compliance finding; the customer and its counsel do.
- Packs carry a scope line stating what was checked, which documents, and the date.
- Clause wording and dates in customer-facing text get a legal check first (see 01).

## Partners and ownership

- Any China-linked partner (supplier, contractor, investor, data source) is flagged and reviewed before work starts.
- Ownership of code, data, the supplier database and customer records between Dylan, Yash, Delilah and Lodeline is agreed **in writing**. Terms: **TBD**.

## This repo

- `ysharm1/lodeline-platform` **had been public** and was made **private on October 20, 2026**. Assume anything committed before then may have been copied.
- `app/(platform)/_components/app-shell.tsx` contains a **personal phone number** in the footer. Remove it before any public exposure of this code or any port of that component.
- Before anything goes public again: scan history for secrets and personal data, and rotate any keys that were ever committed (**TBD**: scan not done as part of this plan).
