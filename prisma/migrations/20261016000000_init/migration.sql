-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('buyer', 'supplier', 'admin');

-- CreateEnum
CREATE TYPE "Stage" AS ENUM ('mine', 'separation', 'metal_alloy', 'magnet', 'component');

-- CreateEnum
CREATE TYPE "Material" AS ENUM ('ndfeb', 'smco', 'tungsten', 'tantalum', 'other');

-- CreateEnum
CREATE TYPE "AuditStatus" AS ENUM ('uploaded', 'parsing', 'classified', 'failed');

-- CreateEnum
CREATE TYPE "EvidenceStatus" AS ENUM ('requested', 'uploaded', 'extracted', 'in_review', 'accepted', 'rejected');

-- CreateEnum
CREATE TYPE "PackStatus" AS ENUM ('draft', 'generating', 'ready', 'delivered');

-- CreateEnum
CREATE TYPE "OutreachStatus" AS ENUM ('queued', 'sent', 'opened', 'reminded', 'responded', 'bounced');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "country" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "role" "Role" NOT NULL DEFAULT 'buyer',
    "email" TEXT NOT NULL,
    "name" TEXT,
    "emailVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MagicLink" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MagicLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartsAudit" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "leadEmail" TEXT NOT NULL,
    "companyName" TEXT,
    "sourceFileKey" TEXT NOT NULL,
    "sourceFileName" TEXT NOT NULL,
    "sourceSha256" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "status" "AuditStatus" NOT NULL,
    "llmModel" TEXT,
    "promptVersion" TEXT,
    "accessTokenHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartsAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditPart" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "partNumber" TEXT,
    "description" TEXT NOT NULL,
    "supplierName" TEXT,
    "quantity" DECIMAL(65,30),
    "materials" "Material"[],
    "llmConfidence" DOUBLE PRECISION,
    "llmRationale" TEXT,
    "undocumentedStages" "Stage"[],
    "ruleVersion" TEXT NOT NULL,

    CONSTRAINT "AuditPart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidencePack" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "status" "PackStatus" NOT NULL DEFAULT 'draft',
    "priceCents" INTEGER NOT NULL,
    "stripeCheckoutId" TEXT,
    "paidAt" TIMESTAMP(3),
    "pdfFileKey" TEXT,
    "generatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidencePack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT,
    "contactEmail" TEXT,
    "contactName" TEXT,
    "orgId" TEXT,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierRequest" (
    "id" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "partIds" TEXT[],
    "stagesRequested" "Stage"[],
    "tokenHash" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "outreachStatus" "OutreachStatus" NOT NULL DEFAULT 'queued',
    "lastEmailAt" TIMESTAMP(3),
    "reminderCount" INTEGER NOT NULL DEFAULT 0,
    "nextReminderAt" TIMESTAMP(3),

    CONSTRAINT "SupplierRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachEmail" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "status" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "OutreachEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceDocument" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "pageCount" INTEGER,
    "status" "EvidenceStatus" NOT NULL DEFAULT 'uploaded',
    "rejectionReason" TEXT,
    "textExtracted" BOOLEAN NOT NULL DEFAULT false,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceClaim" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "partId" TEXT,
    "issuer" TEXT,
    "issueDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "stage" "Stage",
    "facilityName" TEXT,
    "country" TEXT,
    "material" "Material",
    "citations" JSONB NOT NULL,
    "llmConfidence" DOUBLE PRECISION,
    "reviewStatus" "EvidenceStatus" NOT NULL DEFAULT 'in_review',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewerNote" TEXT,

    CONSTRAINT "EvidenceClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEntry" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorSupplierRequestId" TEXT,
    "subjectId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierListing" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "stages" "Stage"[],
    "materials" "Material"[],
    "countries" TEXT[],
    "verifiedAt" TIMESTAMP(3),
    "verifiedFromClaimIds" TEXT[],
    "published" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SupplierListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "buyerOrgId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "dealValueCents" INTEGER,
    "commissionBps" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionInvoice" (
    "id" TEXT NOT NULL,
    "referralId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "paymentStatus" TEXT NOT NULL DEFAULT 'unpaid',
    "paidAt" TIMESTAMP(3),
    "stripeTransferId" TEXT,

    CONSTRAINT "CommissionInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MagicLink_tokenHash_key" ON "MagicLink"("tokenHash");

-- CreateIndex
CREATE INDEX "MagicLink_email_idx" ON "MagicLink"("email");

-- CreateIndex
CREATE UNIQUE INDEX "PartsAudit_accessTokenHash_key" ON "PartsAudit"("accessTokenHash");

-- CreateIndex
CREATE INDEX "AuditPart_auditId_idx" ON "AuditPart"("auditId");

-- CreateIndex
CREATE UNIQUE INDEX "EvidencePack_auditId_key" ON "EvidencePack"("auditId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierRequest_tokenHash_key" ON "SupplierRequest"("tokenHash");

-- CreateIndex
CREATE INDEX "SupplierRequest_nextReminderAt_idx" ON "SupplierRequest"("nextReminderAt");

-- CreateIndex
CREATE INDEX "AuditEntry_subjectId_idx" ON "AuditEntry"("subjectId");

-- CreateIndex
CREATE INDEX "AuditEntry_createdAt_idx" ON "AuditEntry"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionInvoice_referralId_key" ON "CommissionInvoice"("referralId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartsAudit" ADD CONSTRAINT "PartsAudit_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditPart" ADD CONSTRAINT "AuditPart_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "PartsAudit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidencePack" ADD CONSTRAINT "EvidencePack_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "PartsAudit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierRequest" ADD CONSTRAINT "SupplierRequest_packId_fkey" FOREIGN KEY ("packId") REFERENCES "EvidencePack"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierRequest" ADD CONSTRAINT "SupplierRequest_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachEmail" ADD CONSTRAINT "OutreachEmail_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "SupplierRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceDocument" ADD CONSTRAINT "EvidenceDocument_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "SupplierRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceClaim" ADD CONSTRAINT "EvidenceClaim_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "EvidenceDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierListing" ADD CONSTRAINT "SupplierListing_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "SupplierListing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionInvoice" ADD CONSTRAINT "CommissionInvoice_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

