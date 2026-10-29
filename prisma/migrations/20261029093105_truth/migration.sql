-- CreateTable
CREATE TABLE "FactsRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "domainId" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FactsRecord_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TruthIssue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "domainId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "resultId" TEXT NOT NULL,
    "engine" TEXT NOT NULL,
    "promptId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sentence" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "credited" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TruthIssue_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TruthIssue_runId_fkey" FOREIGN KEY ("runId") REFERENCES "VisibilityRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "FactsRecord_domainId_key" ON "FactsRecord"("domainId");

-- CreateIndex
CREATE INDEX "TruthIssue_runId_idx" ON "TruthIssue"("runId");

