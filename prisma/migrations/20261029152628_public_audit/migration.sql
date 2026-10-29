-- CreateTable
CREATE TABLE "PublicAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hostname" TEXT NOT NULL,
    "crawlId" TEXT NOT NULL,
    "question" TEXT,
    "aiStatus" TEXT NOT NULL DEFAULT 'none',
    "aiResult" TEXT,
    "ipKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PublicAudit_crawlId_fkey" FOREIGN KEY ("crawlId") REFERENCES "Crawl" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PublicAudit_hostname_createdAt_idx" ON "PublicAudit"("hostname", "createdAt");

-- CreateIndex
CREATE INDEX "PublicAudit_createdAt_idx" ON "PublicAudit"("createdAt");
