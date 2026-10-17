-- CreateEnum
CREATE TYPE "LeadKind" AS ENUM ('readiness_call', 'checklist');

-- CreateEnum
CREATE TYPE "SupplierApplicationStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "kind" "LeadKind" NOT NULL,
    "name" TEXT,
    "company" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "supplies" TEXT,
    "message" TEXT,
    "sourcePath" TEXT,
    "ipHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierApplication" (
    "id" TEXT NOT NULL,
    "status" "SupplierApplicationStatus" NOT NULL DEFAULT 'pending',
    "companyName" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "website" TEXT,
    "city" TEXT,
    "countryIso" TEXT,
    "stages" "Stage"[],
    "materials" "Material"[],
    "summary" TEXT NOT NULL,
    "documentsNote" TEXT,
    "ipHash" TEXT,
    "listingId" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Lead_createdAt_idx" ON "Lead"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierApplication_listingId_key" ON "SupplierApplication"("listingId");

-- CreateIndex
CREATE INDEX "SupplierApplication_status_createdAt_idx" ON "SupplierApplication"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "SupplierApplication" ADD CONSTRAINT "SupplierApplication_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "SupplierListing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

