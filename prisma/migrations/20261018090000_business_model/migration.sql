-- Business model update (see docs/business-model.md):
--   1. Evidence packs get a price tier.
--   2. Supplier requests record the supplier's consent to reuse documents.
--   3. Supplier requests can belong to a supplier-paid verification instead of a pack.
--   4. New tables: SupplierVerification (supplier pays) and RefreshSubscription (buyer pays monthly).

-- CreateEnum
CREATE TYPE "PackTierLevel" AS ENUM ('starter', 'standard', 'custom');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('pending_payment', 'collecting', 'complete', 'cancelled');

-- CreateEnum
CREATE TYPE "RefreshStatus" AS ENUM ('pending', 'active', 'cancelled');

-- AlterTable: every existing pack was sold at the single $2,000-$5,000 fixed fee; record it as starter.
ALTER TABLE "EvidencePack" ADD COLUMN     "tier" "PackTierLevel" NOT NULL DEFAULT 'starter';

-- AlterTable
ALTER TABLE "SupplierRequest" ALTER COLUMN "packId" DROP NOT NULL,
ADD COLUMN     "verificationId" TEXT,
ADD COLUMN     "reuseConsentAt" TIMESTAMP(3),
ADD COLUMN     "reuseConsentName" TEXT,
ADD COLUMN     "reuseConsentWithdrawnAt" TIMESTAMP(3);

-- A request belongs to exactly one of: a buyer pack, or a supplier verification.
ALTER TABLE "SupplierRequest" ADD CONSTRAINT "SupplierRequest_one_owner_check" CHECK (("packId" IS NULL) <> ("verificationId" IS NULL));

-- CreateTable
CREATE TABLE "SupplierVerification" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactName" TEXT,
    "facilities" INTEGER NOT NULL,
    "tier" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "status" "VerificationStatus" NOT NULL DEFAULT 'pending_payment',
    "stripeCheckoutId" TEXT,
    "checkoutUrl" TEXT,
    "paidAt" TIMESTAMP(3),
    "periodEndsAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "completedNote" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshSubscription" (
    "id" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "tier" "PackTierLevel" NOT NULL,
    "monthlyCents" INTEGER NOT NULL,
    "intervalDays" INTEGER NOT NULL,
    "status" "RefreshStatus" NOT NULL DEFAULT 'pending',
    "stripeCheckoutId" TEXT,
    "stripeSubscriptionId" TEXT,
    "startedAt" TIMESTAMP(3),
    "nextRefreshDueAt" TIMESTAMP(3),
    "lastRefreshedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierRequest_verificationId_idx" ON "SupplierRequest"("verificationId");

-- CreateIndex
CREATE INDEX "SupplierVerification_listingId_idx" ON "SupplierVerification"("listingId");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshSubscription_packId_key" ON "RefreshSubscription"("packId");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshSubscription_stripeSubscriptionId_key" ON "RefreshSubscription"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "RefreshSubscription_status_nextRefreshDueAt_idx" ON "RefreshSubscription"("status", "nextRefreshDueAt");

-- AddForeignKey
ALTER TABLE "SupplierRequest" ADD CONSTRAINT "SupplierRequest_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "SupplierVerification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierVerification" ADD CONSTRAINT "SupplierVerification_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "SupplierListing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshSubscription" ADD CONSTRAINT "RefreshSubscription_packId_fkey" FOREIGN KEY ("packId") REFERENCES "EvidencePack"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
