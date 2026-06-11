-- CreateTable
CREATE TABLE "PriceSnapshot" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "price" DECIMAL(78,18) NOT NULL,
    "confidence" DECIMAL(78,18) NOT NULL,
    "marketStatus" "MarketStatus" NOT NULL,
    "source" "OracleSource" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holding" (
    "basketId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "amount" DECIMAL(78,0) NOT NULL,
    "decimals" INTEGER NOT NULL DEFAULT 18,
    "blockNumber" BIGINT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Holding_pkey" PRIMARY KEY ("basketId","token")
);

-- CreateTable
CREATE TABLE "IndexerCheckpoint" (
    "chainId" INTEGER NOT NULL,
    "lastProcessedBlock" BIGINT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndexerCheckpoint_pkey" PRIMARY KEY ("chainId")
);

-- CreateIndex
CREATE INDEX "PriceSnapshot_token_timestamp_idx" ON "PriceSnapshot"("token", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "Holding_basketId_idx" ON "Holding"("basketId");

-- AddForeignKey
ALTER TABLE "Holding" ADD CONSTRAINT "Holding_basketId_fkey" FOREIGN KEY ("basketId") REFERENCES "Basket"("basketId") ON DELETE CASCADE ON UPDATE CASCADE;
