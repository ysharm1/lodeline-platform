# 06. Roadmap

Owners are placeholders: **Dylan** (app), **Yash** (sales and data), **Delilah** (Taiwan supplier side). Dates beyond Phase 0 are **TBD**.

The validation rule from 01 applies throughout: if fewer than 3 of about 40 buyers would pay for a trace, stop or change direction before Phase 2.

## Phase 0: this week

**Access (Yash, Dylan)**
- Give ysharm1 collaborator access to Dylan's repo and the Vercel project.

**Try page (Dylan)**
- State the rule plainly: DFARS 252.225-7052, magnets, tungsten and tantalum, and January 1, 2027.

**T-001 truly finished (Dylan)**
- Pre-generated evidence pack.
- Auto-refresh after "generate".
- Target date in the future.
- Fill the processing-link warnings.

**Pack fixes (Dylan)**
- Title matches the materials in the trace.
- Add a scope line.
- Fix the sparse page 3.

**Review UX (Dylan)**
- "Accept all".
- Block empty fields.
- Clear stale messages.

**Supplier portal polish (Dylan, Delilah)**
- Instant language toggle (EN / 繁中).
- Read-only after submit.
- Normalise 澳洲 to "Australia".
- Sample questions for T-002.

**Clean-up (Dylan)**
- Fix the 7 console errors.
- Replace emoji icons.

**Sales (Yash)**
- Start the ~40-buyer validation using the demo.
- Legal check of the current 7052 clause version (see 01).

## Phase 1: customer accounts and dashboard shell (Dylan)

- Customer sign-up, organization, membership and roles (buyer, seller).
- Convert a demo workspace into a real account.
- Dashboard shell with tabs: Traces | Evidence packs | Marketplace | Supply-chain map | My listings (last one seller-only, hidden until Phase 4).
- Uploads off or locked down (see 05).

## Phase 2: Marketplace tab (Dylan, Yash)

- Port directory, directory-query, matchmaker, stage-rules, countries, geocoder (see 03).
- `/app/marketplace` with filters (stage, material, region, country, status) and `/app/marketplace/[id]`.
- Idempotent import from `platform-seed.json` with the "Unverified, from public sources" label (see 04). Yash owns the data.
- "Request intro" (ContactRequest), routed through Lodeline; no emails shown.

## Phase 3: Supply-chain map (Dylan)

- `/app/map`: mine → refine → alloy → magnet, by country and supplier.
- Coverage gaps from traces (covered-country or undocumented stages), each with "Find a China-free supplier for this open stage".

## Phase 4: My listings and verification (Dylan, Delilah, Yash)

- `/app/listings`: sellers claim and edit their own listings (two-sided marketplace).
- Verification workflow: prospect → verified from checked documents, with expiry (see 04).
- Delilah leads Taiwan supplier onboarding.

## Phase 5: later

- Paid plans and billing (Stripe).
- Recycled-magnet matching (year 2).
- US–Taiwan supply bridge (~2028–2030).

## Open questions for Dylan

1. Which database, ORM and auth library does the app use? Can it host organizations, memberships and roles as in 02?
2. How are demo workspaces stored, and how should one convert into a real account?
3. Where does the app store uploads and generated PDFs today, and in which region?
4. Which AI provider reads documents, and is zero data retention on?
5. Can the passkey sign-in extend to customers, or do customers need email links too?
6. Where should ported services and the seed import script live in your repo?
7. What are the 7 console errors, and which are already known?
8. Is the Calendly link yours or a shared Lodeline account?
9. Who owns the Vercel project and domain, and how do we agree ownership in writing?
10. Are you OK moving the marketplace and map into `/app/*` routes as proposed, or do you prefer another layout?
