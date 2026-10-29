-- AlterTable
ALTER TABLE "Page" ADD COLUMN "excerpt" TEXT;

-- CreateTable
CREATE TABLE "WpConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "domainId" TEXT NOT NULL,
    "siteUrl" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "pluginVersion" TEXT,
    "yoast" BOOLEAN NOT NULL DEFAULT false,
    "robotsFile" BOOLEAN NOT NULL DEFAULT false,
    "lastCheckedAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WpConnection_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Fix" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "findingCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'applied',
    "error" TEXT,
    "appliedAt" DATETIME,
    "verifiedAt" DATETIME,
    "rolledBackAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Fix_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Fix_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "WpConnection_domainId_key" ON "WpConnection"("domainId");

-- CreateIndex
CREATE UNIQUE INDEX "Fix_domainId_key_key" ON "Fix"("domainId", "key");
