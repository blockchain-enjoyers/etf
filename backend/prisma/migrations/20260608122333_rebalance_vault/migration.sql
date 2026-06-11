-- CreateEnum
CREATE TYPE "TargetChangeKind" AS ENUM ('Scheduled', 'Activated');

-- AlterEnum
ALTER TYPE "VaultType" ADD VALUE 'Rebalance';

-- AlterTable
ALTER TABLE "Basket" ADD COLUMN     "keeperBps" INTEGER,
ADD COLUMN     "keeperEscrow" TEXT;

-- CreateTable
CREATE TABLE "RebalanceEvent" (
    "id" TEXT NOT NULL,
    "vaultAddress" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "recipient" TEXT NOT NULL,
    "acquire" JSONB NOT NULL,
    "acquireIn" JSONB NOT NULL,
    "release" JSONB NOT NULL,
    "releaseOut" JSONB NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RebalanceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TargetChange" (
    "id" TEXT NOT NULL,
    "vaultAddress" TEXT NOT NULL,
    "kind" "TargetChangeKind" NOT NULL,
    "tokens" JSONB NOT NULL,
    "unitQty" JSONB NOT NULL,
    "effectiveAt" TIMESTAMP(3),
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TargetChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KeeperPayout" (
    "id" TEXT NOT NULL,
    "vaultAddress" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "amount" DECIMAL(78,0) NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KeeperPayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RebalanceEvent_vaultAddress_timestamp_idx" ON "RebalanceEvent"("vaultAddress", "timestamp" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "RebalanceEvent_txHash_logIndex_key" ON "RebalanceEvent"("txHash", "logIndex");

-- CreateIndex
CREATE INDEX "TargetChange_vaultAddress_timestamp_idx" ON "TargetChange"("vaultAddress", "timestamp" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "TargetChange_txHash_logIndex_key" ON "TargetChange"("txHash", "logIndex");

-- CreateIndex
CREATE INDEX "KeeperPayout_vaultAddress_timestamp_idx" ON "KeeperPayout"("vaultAddress", "timestamp" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "KeeperPayout_txHash_logIndex_key" ON "KeeperPayout"("txHash", "logIndex");

-- AddForeignKey
ALTER TABLE "RebalanceEvent" ADD CONSTRAINT "RebalanceEvent_vaultAddress_fkey" FOREIGN KEY ("vaultAddress") REFERENCES "Basket"("vaultAddress") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TargetChange" ADD CONSTRAINT "TargetChange_vaultAddress_fkey" FOREIGN KEY ("vaultAddress") REFERENCES "Basket"("vaultAddress") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeeperPayout" ADD CONSTRAINT "KeeperPayout_vaultAddress_fkey" FOREIGN KEY ("vaultAddress") REFERENCES "Basket"("vaultAddress") ON DELETE CASCADE ON UPDATE CASCADE;
