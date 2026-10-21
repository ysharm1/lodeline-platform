-- Marketplace: listing status, public-source fields, activities (recycling, distribution), import key, ContactRequest. Additive only.
-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('prospect', 'listed', 'hidden');

-- CreateEnum
CREATE TYPE "ContactRequestStatus" AS ENUM ('new', 'introduced', 'closed');

-- AlterTable
ALTER TABLE "SupplierListing" ADD COLUMN     "activities" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "hqCountry" TEXT,
ADD COLUMN     "listingStatus" "ListingStatus" NOT NULL DEFAULT 'listed',
ADD COLUMN     "productionStatus" TEXT,
ADD COLUMN     "publicSources" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "region" TEXT,
ADD COLUMN     "sourceKey" TEXT;

-- CreateTable
CREATE TABLE "ContactRequest" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "orgId" TEXT,
    "userId" TEXT NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    "status" "ContactRequestStatus" NOT NULL DEFAULT 'new',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "handledAt" TIMESTAMP(3),

    CONSTRAINT "ContactRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContactRequest_listingId_idx" ON "ContactRequest"("listingId");

-- CreateIndex
CREATE INDEX "ContactRequest_orgId_idx" ON "ContactRequest"("orgId");

-- CreateIndex
CREATE INDEX "ContactRequest_status_idx" ON "ContactRequest"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierListing_sourceKey_key" ON "SupplierListing"("sourceKey");

-- CreateIndex
CREATE INDEX "SupplierListing_listingStatus_idx" ON "SupplierListing"("listingStatus");

-- AddForeignKey
ALTER TABLE "ContactRequest" ADD CONSTRAINT "ContactRequest_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "SupplierListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactRequest" ADD CONSTRAINT "ContactRequest_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactRequest" ADD CONSTRAINT "ContactRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

