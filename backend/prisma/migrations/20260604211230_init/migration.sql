-- CreateEnum
CREATE TYPE "MarketStatus" AS ENUM ('Unknown', 'PreMarket', 'Regular', 'PostMarket', 'Overnight', 'Closed');

-- CreateEnum
CREATE TYPE "OracleSource" AS ENUM ('Chainlink', 'Pyth', 'RedStone', 'DexTwap', 'PerpMark', 'LastClose');

-- CreateTable
CREATE TABLE "Basket" (
    "basketId" TEXT NOT NULL,
    "vaultAddress" TEXT NOT NULL,
    "basketToken" TEXT NOT NULL,
    "cashToken" TEXT,
    "creationUnitSize" DECIMAL(78,0) NOT NULL,
    "cashComponentPerUnit" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "frozen" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Basket_pkey" PRIMARY KEY ("basketId")
);

-- CreateTable
CREATE TABLE "Constituent" (
    "id" TEXT NOT NULL,
    "basketId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "unitQty" DECIMAL(78,0) NOT NULL,
    "weightBps" INTEGER NOT NULL,
    "decimals" INTEGER NOT NULL,

    CONSTRAINT "Constituent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NavSnapshot" (
    "id" TEXT NOT NULL,
    "basketId" TEXT NOT NULL,
    "nav" DECIMAL(78,18) NOT NULL,
    "confidenceLower" DECIMAL(78,18) NOT NULL,
    "confidenceUpper" DECIMAL(78,18) NOT NULL,
    "marketStatus" "MarketStatus" NOT NULL,
    "source" "OracleSource" NOT NULL,
    "estimated" BOOLEAN NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NavSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Constituent_basketId_token_key" ON "Constituent"("basketId", "token");

-- CreateIndex
CREATE INDEX "NavSnapshot_basketId_timestamp_idx" ON "NavSnapshot"("basketId", "timestamp" DESC);

-- AddForeignKey
ALTER TABLE "Constituent" ADD CONSTRAINT "Constituent_basketId_fkey" FOREIGN KEY ("basketId") REFERENCES "Basket"("basketId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NavSnapshot" ADD CONSTRAINT "NavSnapshot_basketId_fkey" FOREIGN KEY ("basketId") REFERENCES "Basket"("basketId") ON DELETE CASCADE ON UPDATE CASCADE;
