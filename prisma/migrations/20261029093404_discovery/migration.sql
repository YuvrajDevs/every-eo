-- AlterTable
ALTER TABLE "Domain" ADD COLUMN "category" TEXT;

-- AlterTable
ALTER TABLE "Page" ADD COLUMN "headings" TEXT;

-- CreateTable
CREATE TABLE "GscQuery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "domainId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL,
    "impressions" INTEGER NOT NULL,
    "ctr" REAL,
    "position" REAL,
    "importedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GscQuery_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "GscQuery_domainId_idx" ON "GscQuery"("domainId");

