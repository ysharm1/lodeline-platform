-- E2E flow: custom quotes, pack release, supplier forwarding, per-stage uploads,
-- deterministic claim confidence, directory map coordinates. Additive only.
-- AlterTable
ALTER TABLE "EvidenceClaim" ADD COLUMN     "confidence" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "EvidenceDocument" ADD COLUMN     "declaredStage" "Stage";

-- AlterTable
ALTER TABLE "EvidencePack" ADD COLUMN     "releasedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PartsAudit" ADD COLUMN     "quotedAt" TIMESTAMP(3),
ADD COLUMN     "quotedById" TEXT,
ADD COLUMN     "quotedMaxSuppliers" INTEGER,
ADD COLUMN     "quotedPriceCents" INTEGER;

-- AlterTable
ALTER TABLE "SupplierListing" ADD COLUMN     "geocodeProvider" TEXT,
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "SupplierRequest" ADD COLUMN     "parentRequestId" TEXT;

-- CreateIndex
CREATE INDEX "SupplierRequest_parentRequestId_idx" ON "SupplierRequest"("parentRequestId");

-- AddForeignKey
ALTER TABLE "SupplierRequest" ADD CONSTRAINT "SupplierRequest_parentRequestId_fkey" FOREIGN KEY ("parentRequestId") REFERENCES "SupplierRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

