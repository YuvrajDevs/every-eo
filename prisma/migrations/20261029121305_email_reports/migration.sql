-- AlterTable
ALTER TABLE "Alert" ADD COLUMN "emailedAt" DATETIME;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Organization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'standard',
    "brandName" TEXT,
    "brandLogoUrl" TEXT,
    "brandColor" TEXT,
    "reportFooter" TEXT,
    "alertEmails" BOOLEAN NOT NULL DEFAULT true,
    "reportSchedule" TEXT NOT NULL DEFAULT 'off',
    "reportRecipients" TEXT,
    "nextReportAt" DATETIME,
    "parentId" TEXT,
    "plan" TEXT NOT NULL DEFAULT 'trial',
    "planStatus" TEXT,
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "currentPeriodEnd" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Organization_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Organization" ("brandColor", "brandLogoUrl", "brandName", "createdAt", "currentPeriodEnd", "id", "kind", "name", "parentId", "plan", "planStatus", "reportFooter", "stripeCustomerId", "stripeSubscriptionId") SELECT "brandColor", "brandLogoUrl", "brandName", "createdAt", "currentPeriodEnd", "id", "kind", "name", "parentId", "plan", "planStatus", "reportFooter", "stripeCustomerId", "stripeSubscriptionId" FROM "Organization";
DROP TABLE "Organization";
ALTER TABLE "new_Organization" RENAME TO "Organization";
CREATE UNIQUE INDEX "Organization_stripeCustomerId_key" ON "Organization"("stripeCustomerId");
CREATE UNIQUE INDEX "Organization_stripeSubscriptionId_key" ON "Organization"("stripeSubscriptionId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

