# 04. Marketplace data

## Source: one file only

Seed the marketplace from the supplier DB export:

`/workspace/lodeline-docs/supplier-db/platform-seed.json`

(This path is on Lodeline's working machine, not in this repo. The importer takes the path at run time, from an env var or this default, and the file is gitignored.)

Facts checked from the file on October 20, 2026 (`generated_at` 2026-10-20T18:28:33-07:00, `schema_version` 1):

- **204 rows**, all with unique `id`s.
- China-linked rows (`china_link_flag=true`, 53) and hidden rows (2) are already excluded by the export.
- **No contact emails** in the file (checked by pattern search).
- Regions:

| Region | Rows |
|---|---|
| US | 105 |
| Allied-Europe | 39 |
| Allied-APAC | 34 |
| Canada | 20 |
| LatAm | 3 |
| Taiwan | 2 |
| Africa | 1 |
| **Total** | **204** |

"Other 6" in the brief = LatAm 3 + Taiwan 2 + Africa 1. Taiwan is its own region in the export, separate from Allied-APAC.

- Every row has `listing_status = prospect` and `dfars_7052_status = unverified`.
- `production_status`: producing 106, unknown 47, development 31, exploration 11, pilot 9.
- Every row's `supplierListing.published` is `false` (the export sets it true only for listed + verified rows) and `city` is null.

Re-check these counts from the file at import time; the export is regenerated whenever the supplier DB changes.

## Never import

The supplier DB's full internal exports and prospect lists (CSV, JSON, SQLite and backups). These hold contact details and internal notes. Only `platform-seed.json` is buyer-facing.

**Do not commit the seed file, any rows from it, or any contact data to a repo.** The import reads the file at run time.

## Label

All imported rows are unverified prospects. Every listing shows:

> **Unverified, from public sources**

with the row's `public_sources` links, until documents are checked (see Verification). Never show "verified", "compliant" or "certified" for these rows (see 05).

## Display decision needed

The export sets `published: false` on every row, meaning "not a verified listing". The plan is to show the rows in the marketplace with the unverified label. So the import needs a separate field (`listingStatus = prospect`, shown with the label) rather than reusing `published`. Decision: **TBD** (Yash + Dylan). Until decided, import with `published = false`.

## Field mapping

Each row has buyer fields plus a `supplierListing` object already shaped for this repo's Prisma `SupplierListing`.

| Seed field | Target field |
|---|---|
| `id` | `id` (import key) |
| `company` / `supplierListing.name` | `name` |
| `products_summary` / `supplierListing.summary` | `summary` |
| `website` | `website` |
| `hq_country` | `hqCountry` |
| `facility_countries` | `facilityCountries` |
| `supplierListing.countryIso` | `countryIso` (all rows have one) |
| `region` | `region` |
| `stages` (mapped) | `stages` |
| `materials` (mapped) | `materials` |
| `production_status` | `productionStatus` |
| `dfars_7052_status` | `status7052` |
| `listing_status` | `listingStatus` |
| `public_sources` | `publicSources` |
| — | `isExample = false`, `ownerOrgId = null` |

Mapping rules (from the export's `enums.platform_stage_map` / `platform_material_map`):

- Stages: mining→mine, separation_refining→separation, metal_alloy→metal_alloy, magnet_making→magnet, part_fabrication→component. `recycling` and `distribution` have no platform enum.
- Materials: NdFeB→ndfeb, SmCo→smco, tungsten, tantalum; everything else (ferrite, alnico, rare earth oxide/metal, niobium, other) → other.

Gaps to decide:

- **34 rows** have only recycling and/or distribution stages, so their mapped `stages` list is empty. Either add `recycling` and `distribution` to the stage enum (recycling also matters for the year-2 recycled-magnet idea) or keep the raw stages in a separate field. **TBD.**
- 98 rows include `other` after mapping (58 of them map to `other` only); keep the raw material list too so filters are not lossy. **TBD.**

## Import

- A one-off script (location TBD in Dylan's app) reads the file and upserts each row **keyed on supplier `id`**. Running it twice gives the same result (idempotent).
- Rows already verified or claimed by a seller are not overwritten by the import (fields owned by verification or the seller win). Exact rule: TBD.
- Rows that disappear from the export (for example newly China-flagged) are unpublished, not deleted. They keep an audit trail.
- Coordinates: **country level** from `countryIso` via `src/services/geocoder.ts` (`CountryCentroidGeocoder` / `listingPosition`). `city` is null in every row, so no city-level geocoding yet.
- The script logs counts by region and status so they can be checked against this page.

## Verification workflow (prospect → verified)

1. A listing is a **prospect** (imported, unverified label).
2. Lodeline (or the supplier, once claimed) collects documents: certificates of origin, mill certs, declarations, facility addresses for each stage.
3. AI may read the documents (zero data retention only); **a human reviewer confirms every record**.
4. If every listed stage has a document showing a non-covered country, the reviewer marks the listing **verified** and records which documents and pages support it, the reviewer, the date and an expiry.
5. On expiry the listing returns to unverified until re-checked.
6. "Verified" means "documents checked by Lodeline say X", never "compliant" or "certified".

Payment from a supplier never sets verified; only accepted documents do (same rule as `SupplierVerification` in this repo).
