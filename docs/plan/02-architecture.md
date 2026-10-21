# 02. Architecture

## Base product: Dylan's Vercel app

Dylan's trace demo is the base we build on. This repo (`lodeline-platform`) is a source of code to port (see 03), not the base.

What is public and observed from outside (not from source):

- `https://lodeline-trace-demo.vercel.app/try` redirects to `https://lodeline-trace-demo-app.vercel.app`.
- Next.js 16 on Vercel, region iad1 (observed from response headers).
- Routes: `/`, `/login`, `/app`, `/api/health`.
- Operator sign-in with a passkey, enrolled by email.
- Anonymous, fictional workspaces that last 24 hours.
- Sample traces T-001 and T-002.
- Supplier portal in English and Traditional Chinese (繁中).
- Reviewer confirmation of each extracted record.
- Evidence pack PDF with page citations.
- Calendly booking link.

**Source:** in Dylan's own GitHub account, not this repo. Exact file paths, framework config, database and auth library in his app are **TBD** until ysharm1 has collaborator access. Everything below is written as routes and models, not file paths, for that reason.

## Target product

One customer account is an **organization** with **users** and **roles**:

- `buyer`: runs traces, sees evidence packs, uses the marketplace and map.
- `seller`: manages its own marketplace listings (later, when the marketplace becomes two-sided).

An organization can hold both roles. (This repo already models this: `OrgRole` enum and `src/services/memberships.ts`.)

### Dashboard tabs

`Traces | Evidence packs | Marketplace | Supply-chain map | My listings`

"My listings" shows only for organizations with the `seller` role.

### Routes

| Route | Purpose |
|---|---|
| `/app` | Dashboard home; Traces tab and Evidence packs tab |
| `/app/marketplace` | Supplier search. Filters: stage, material, region, country, status |
| `/app/marketplace/[id]` | One listing: stages, materials, countries, production status, 7052 status, public sources, "Request intro" |
| `/app/map` | Supply-chain map: mine → refine → alloy → magnet, by country and supplier |
| `/app/listings` | Seller side: create and edit own listings (later, two-sided) |

Route names for traces and packs inside `/app` follow Dylan's existing app: **TBD**.

### Map linked to trace coverage

The map shows each stage of each traced part (mine, separation/refining, metal/alloy, magnet-making) placed by country and supplier. A stage that is in a covered country or has no documents is a **coverage gap**. Each gap has a button: **"Find a China-free supplier for this open stage"**, which opens `/app/marketplace` pre-filtered by that stage and material. The ranking logic exists in this repo (`src/services/matchmaker.ts`, `src/services/stage-rules.ts`).

## Data model (target)

Field names are proposals; final names follow Dylan's schema.

### SupplierListing

| Field | Notes |
|---|---|
| id | Stable id; for imported rows, the supplier DB `id` (slug) |
| name | |
| website | |
| hqCountry | |
| facilityCountries | list |
| region | US, Taiwan, Allied-Europe, Allied-APAC, Canada, LatAm, Africa, Other |
| stages | mine, separation, metal_alloy, magnet, component (+ recycling, distribution: see 04) |
| materials | ndfeb, smco, tungsten, tantalum, other |
| productionStatus | producing, pilot, development, exploration, unknown |
| status7052 | unverified / verified (what documents say, not a compliance finding) |
| listingStatus | prospect / listed / hidden |
| publicSources | list of URLs |
| latitude, longitude | country-level for now (geocoder) |
| published | shown in marketplace |
| isExample | fictional sample row |
| ownerOrgId | null for Lodeline-sourced rows; set when a seller claims the listing |

This repo's current `SupplierListing` (prisma/schema.prisma lines 365-391) has name, summary, website, city, countryIso, lat/long, isExample, stages, materials, countries, verifiedAt, published, orgId. It does **not** have region, hqCountry, productionStatus, status7052, listingStatus or publicSources; those are new.

### ListingVerification

One record per attempt to move a listing to verified: listing id, documents checked, who reviewed, result, date, expiry. Payment, if any, never sets verified; only accepted documents do. (This repo's `SupplierVerification` model, schema lines 400-427, is a supplier-paid version of this idea and can be adapted.)

### ContactRequest

"Request intro" from a buyer to a listed supplier. Fields: buyer org, buyer user, listing id, message, status (new, sent, accepted, declined), timestamps. **Routed through Lodeline.** The marketplace never shows contact emails; Lodeline staff make the introduction.

## Customer accounts (prerequisite for everything above)

Dylan's app today has operator sign-in and anonymous demo workspaces. Before the dashboard tabs we need:

1. Customer sign-up (method TBD: passkey, email link or both).
2. Organization creation.
3. Membership and roles (buyer, seller; admin within org TBD).
4. Converting a demo workspace into a real account, keeping or discarding the fictional data (TBD; likely discard fictional records and keep settings).
