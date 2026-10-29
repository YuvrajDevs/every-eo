-- AlterTable
ALTER TABLE "Crawl" ADD COLUMN "platform" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Finding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "crawlId" TEXT NOT NULL,
    "layer" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "url" TEXT,
    "fixability" TEXT NOT NULL DEFAULT 'you',
    "howTo" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Finding_crawlId_fkey" FOREIGN KEY ("crawlId") REFERENCES "Crawl" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Finding" ("code", "crawlId", "createdAt", "detail", "evidence", "id", "layer", "severity", "title", "url") SELECT "code", "crawlId", "createdAt", "detail", "evidence", "id", "layer", "severity", "title", "url" FROM "Finding";
DROP TABLE "Finding";
ALTER TABLE "new_Finding" RENAME TO "Finding";
CREATE INDEX "Finding_crawlId_idx" ON "Finding"("crawlId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
