-- AlterTable
ALTER TABLE "Crawl" ADD COLUMN "performance" TEXT;

-- AlterTable
ALTER TABLE "Domain" ADD COLUMN "brandName" TEXT;

-- AlterTable
ALTER TABLE "Page" ADD COLUMN "answerScore" INTEGER;
ALTER TABLE "Page" ADD COLUMN "answerSignals" TEXT;

-- CreateTable
CREATE TABLE "Prompt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "domainId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Prompt_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VisibilityRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "trials" INTEGER NOT NULL DEFAULT 3,
    "engines" TEXT NOT NULL,
    "costMicros" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "VisibilityRun_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VisibilityResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "promptId" TEXT NOT NULL,
    "engine" TEXT NOT NULL,
    "trial" INTEGER NOT NULL,
    "mentioned" BOOLEAN NOT NULL DEFAULT false,
    "cited" BOOLEAN NOT NULL DEFAULT false,
    "citedUrls" TEXT,
    "answer" TEXT,
    "error" TEXT,
    "costMicros" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VisibilityResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "VisibilityRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VisibilityResult_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "Prompt" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Prompt_domainId_idx" ON "Prompt"("domainId");

-- CreateIndex
CREATE INDEX "VisibilityRun_domainId_createdAt_idx" ON "VisibilityRun"("domainId", "createdAt");

-- CreateIndex
CREATE INDEX "VisibilityResult_runId_idx" ON "VisibilityResult"("runId");
