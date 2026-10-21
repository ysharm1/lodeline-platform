# 03. What to port from lodeline-platform, and what to retire

Every path below was checked against `main` at commit `65fa2a9` (October 20, 2026). Paths that differ from the original brief are marked **corrected**.

Target locations in Dylan's app are **TBD** until we can see his repo.

## Port

### Services (pure logic, with tests)

| Path | What it does | Tests |
|---|---|---|
| `src/services/directory.ts` | `DirectoryService`, filter parsing for the supplier directory | `directory.db.test.ts` (needs a DB) |
| `src/services/directory-query.ts` | Filter schema; deterministic (no-LLM) parser for plain-English questions; template answer | `directory-query.test.ts` |
| `src/services/matchmaker.ts` | Ranks listings for a material + stage need; matches pack rows and audit needs to suppliers (up to 3 per need) | `matchmaker.test.ts` |
| `src/services/stage-rules.ts` | Required stages per material; which stages are undocumented; stage and material labels | `stage-rules.test.ts` |
| `src/services/geocoder.ts` | Country centroid geocoder, optional Nominatim/Mapbox, cache | `geocoder.test.ts` |
| `src/services/countries.ts` | Covered countries (CN, RU, IR, KP), ISO-2 conversion, covered-country flag | `countries.test.ts` |
| `src/services/memberships.ts` | Org roles (buyer/seller) and `canActAs` | `memberships.test.ts` |
| `src/services/drawing-detect.ts` | Rejects CAD files, technical drawings and files marked ITAR / EXPORT CONTROLLED / EAR99 / CUI; PDF only, 20 MB cap | `drawing-detect.test.ts` |

`geocoder.ts` reads a cache through Prisma (`PrismaGeocodeCache`, `GeocodeCache` model). Port the pure parts; adapt the cache to Dylan's database.

### Pages

| Path | Notes |
|---|---|
| `app/(platform)/suppliers/page.tsx` | Directory list → becomes `/app/marketplace` |
| `app/(platform)/suppliers/[listingId]/page.tsx` | Listing detail → becomes `/app/marketplace/[id]` |
| `app/(platform)/suppliers/ask-box.tsx` | Plain-English search box; calls `app/api/suppliers/ask/route.ts` |
| `app/(platform)/buyer/listings/page.tsx` | Org's own listings → becomes `/app/listings` |
| `app/(platform)/buyer/listings/own-listing-form.tsx` | **Added**: the listing form used by that page |

Related API routes to port with them: `app/api/suppliers/route.ts`, `app/api/suppliers/ask/route.ts`, `app/api/listings/mine/route.ts` (**added**).

### Database schema (`prisma/schema.prisma`)

**Corrected line numbers:**

- `Stage` enum: lines 24-30 (mine, separation, metal_alloy, magnet, component).
- `Material` enum: lines 32-38 (ndfeb, smco, tungsten, tantalum, other).
- `SupplierListing` model: lines 365-391.
- `VerificationStatus` enum: lines 393-398; `SupplierVerification` model: lines 400-427 (including its doc comment) (useful starting point for ListingVerification).
- `OrgRole` enum: lines 19-22 (buyer, seller).

The brief said "~lines 365-402" for the model and enums; the stage and material enums are near the top of the file, not in that range.

### Seed pattern

`prisma/seed.ts`: seeds a few clearly marked fictional rows (`isExample: true`, names ending "(sample listing)", positions from `COUNTRY_CENTROIDS`), skipping rows that already exist. Keep the pattern: example rows are labelled and never mixed up with real companies.

### Optional: free parts-list check

| Path | Notes |
|---|---|
| `src/services/free-audit.ts` | Upload → file gate → parse → classify → likely/possible/not likely counts |
| `src/services/keyword-classifier.ts` | **Corrected**: the brief said `part-classifier`. There is no `part-classifier.ts`; the classifier is `keyword-classifier.ts` (`classifyPart`, rules version `rules-v2`). Its test is `src/services/part-classifier.test.ts`. |
| `src/services/part-patterns.data.ts` | Part-name patterns used by the classifier |

`free-audit.ts` also calls an LLM through `@/infra/llm` (with a keyword fallback in dev). If ported, the LLM must use zero data retention (see 05), or run keyword-only.

## Retire (do not port)

| Path | Why |
|---|---|
| `app/(platform)/demo/page.tsx` (the `/demo` route) | Replaced by Dylan's demo |
| `app/api/demo/route.ts`, `app/api/demo/sample-parts-list/route.ts` | Same |
| `src/services/demo-sample.ts` (+ `demo-sample.test.ts`) | Same |
| `app/(platform)/s/[token]/*` (page, consent, forward, upload) and `app/api/s/[token]/*` | Separate supplier portal; Dylan's EN/繁中 portal replaces it |
| `app/(site)/*` | Marketing site copy; stale compared with live lodeline.org |
| `app/_site/*` | **Added**: the components and page bodies used by `app/(site)`; retire together |
| `vendor/lodeline-site/*` | Static copy of the old site; stale |
| branch `business-model-update` | Stale. Last commit October 18, 2026; it has no commits that are not already on `main` (main is 9 commits ahead). Safe to delete after Yash confirms. |

Retiring here means "do not carry into Dylan's app". Nothing is deleted from this repo by this plan.
