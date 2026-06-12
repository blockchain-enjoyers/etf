-- CreateEnum
CREATE TYPE "ActivityKind" AS ENUM ('Mint', 'Redeem', 'ForwardCreateRequested', 'ForwardRedeemRequested', 'ForwardPartialFill', 'ForwardSettled', 'ForwardCancelled');

-- CreateTable
CREATE TABLE "ActivityEvent" (
    "id" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "vaultAddress" TEXT NOT NULL,
    "kind" "ActivityKind" NOT NULL,
    "payload" JSONB NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActivityEvent_owner_timestamp_idx" ON "ActivityEvent"("owner", "timestamp" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ActivityEvent_txHash_logIndex_key" ON "ActivityEvent"("txHash", "logIndex");

-- AddForeignKey
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_vaultAddress_fkey" FOREIGN KEY ("vaultAddress") REFERENCES "Basket"("vaultAddress") ON DELETE CASCADE ON UPDATE CASCADE;
