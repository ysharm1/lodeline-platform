-- CreateEnum
CREATE TYPE "Coverage" AS ENUM ('likely', 'possible', 'not_likely');

-- AlterTable
ALTER TABLE "AuditPart" ADD COLUMN     "classifiedBy" TEXT NOT NULL DEFAULT 'rules',
ADD COLUMN     "coverage" "Coverage" NOT NULL DEFAULT 'not_likely',
ADD COLUMN     "manufacturer" TEXT,
ADD COLUMN     "material" TEXT,
ADD COLUMN     "mpn" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "reason" TEXT NOT NULL DEFAULT '';

-- Backfill rows classified before rules-v2: anything with a covered material was a "likely" flag.
UPDATE "AuditPart"
SET "coverage" = 'likely',
    "reason" = COALESCE(NULLIF("llmRationale", ''), 'Classified before rules-v2')
WHERE "materials" && ARRAY['ndfeb', 'smco', 'tungsten', 'tantalum']::"Material"[];

UPDATE "AuditPart"
SET "reason" = COALESCE(NULLIF("llmRationale", ''), 'Classified before rules-v2')
WHERE "reason" = '';
