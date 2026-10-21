/**
 * Import the supplier DB's buyer-facing export into the marketplace.
 *
 *   npm run import:suppliers                      # reads $SUPPLIER_SEED_PATH or the default path
 *   npm run import:suppliers -- path/to/seed.json [--publish] [--dry-run] [--keep-missing]
 *
 * Idempotent: keyed on the export's supplier id. Never commit the seed file.
 * See src/services/seed-import.ts and docs/plan/04-marketplace-data.md.
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { DEFAULT_SEED_PATH, importSeed, parseSeed } from "../src/services/seed-import";

const args = process.argv.slice(2);
const path = args.find((a) => !a.startsWith("--")) ?? process.env.SUPPLIER_SEED_PATH ?? DEFAULT_SEED_PATH;
const parsed = parseSeed(JSON.parse(readFileSync(path, "utf8")));
console.log(`Read ${parsed.rows.length} rows from ${path}; rejected ${parsed.rejected.length}.`);
for (const r of parsed.rejected) console.log(`  rejected ${r.key}: ${r.reason}`);
if (args.includes("--dry-run")) {
  const byRegion: Record<string, number> = {};
  for (const r of parsed.rows) byRegion[r.region ?? "unknown"] = (byRegion[r.region ?? "unknown"] ?? 0) + 1;
  console.log("By region:", byRegion);
  process.exit(0);
}
const db = new PrismaClient();
importSeed(db, parsed, { publish: args.includes("--publish"), hideMissing: !args.includes("--keep-missing") })
  .then((s) => {
    console.log(`Created ${s.created}, updated ${s.updated}, skipped (claimed or verified) ${s.protectedSkipped}, hidden ${s.hidden}.`);
    console.log("By region:", s.byRegion);
  })
  .finally(() => db.$disconnect());
