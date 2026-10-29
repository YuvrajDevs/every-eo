-- CreateTable
CREATE TABLE "ShopifyConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "domainId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "installationId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShopifyConnection_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopifyConnection_domainId_key" ON "ShopifyConnection"("domainId");

-- CreateIndex
CREATE UNIQUE INDEX "ShopifyConnection_shop_key" ON "ShopifyConnection"("shop");

