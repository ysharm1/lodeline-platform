-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('buyer', 'seller');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "roles" "OrgRole"[] DEFAULT ARRAY['buyer']::"OrgRole"[];

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "roles" "OrgRole"[] DEFAULT ARRAY['buyer']::"OrgRole"[],
    "isOrgAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Membership_orgId_idx" ON "Membership"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_orgId_key" ON "Membership"("userId", "orgId");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill organization capabilities from the legacy kind.
UPDATE "Organization" SET "roles" = ARRAY['seller']::"OrgRole"[] WHERE "kind" = 'supplier';
UPDATE "Organization" SET "roles" = ARRAY['buyer']::"OrgRole"[] WHERE "kind" <> 'supplier';

-- One membership per existing user/org link, roles from the legacy user role.
INSERT INTO "Membership" ("id", "userId", "orgId", "roles", "isOrgAdmin", "createdAt")
SELECT gen_random_uuid()::text, u."id", u."orgId",
       CASE WHEN u."role" = 'supplier' THEN ARRAY['seller']::"OrgRole"[] ELSE ARRAY['buyer']::"OrgRole"[] END,
       true, CURRENT_TIMESTAMP
FROM "User" u
WHERE u."orgId" IS NOT NULL
ON CONFLICT ("userId", "orgId") DO NOTHING;
