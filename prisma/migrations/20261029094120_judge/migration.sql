-- CreateTable
CREATE TABLE "JudgeRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "crawlId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "model" TEXT NOT NULL,
    "estimateMicros" INTEGER NOT NULL DEFAULT 0,
    "costMicros" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "JudgeRun_crawlId_fkey" FOREIGN KEY ("crawlId") REFERENCES "Crawl" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JudgeResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "judgeRunId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answerable" BOOLEAN,
    "score" INTEGER,
    "quote" TEXT,
    "quoteFound" BOOLEAN,
    "rationale" TEXT,
    "error" TEXT,
    "costMicros" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "JudgeResult_judgeRunId_fkey" FOREIGN KEY ("judgeRunId") REFERENCES "JudgeRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

