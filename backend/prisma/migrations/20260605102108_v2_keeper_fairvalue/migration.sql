-- CreateEnum
CREATE TYPE "QueueStatus" AS ENUM ('Pending', 'Settled', 'Failed', 'Cancelled');

-- CreateTable
CREATE TABLE "QueueEntry" (
    "id" TEXT NOT NULL,
    "basketId" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "basketTokenAmount" DECIMAL(78,0) NOT NULL,
    "nonce" BIGINT NOT NULL,
    "status" "QueueStatus" NOT NULL DEFAULT 'Pending',
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "settledTxHash" TEXT,
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QueueEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FairValueAttestation" (
    "id" TEXT NOT NULL,
    "basketId" TEXT NOT NULL,
    "nav" DECIMAL(78,18) NOT NULL,
    "lower" DECIMAL(78,18) NOT NULL,
    "upper" DECIMAL(78,18) NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "signer" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "pushedTxHash" TEXT,
    "pushedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FairValueAttestation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QueueEntry_basketId_status_submittedAt_idx" ON "QueueEntry"("basketId", "status", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "QueueEntry_basketId_nonce_key" ON "QueueEntry"("basketId", "nonce");

-- CreateIndex
CREATE INDEX "FairValueAttestation_basketId_timestamp_idx" ON "FairValueAttestation"("basketId", "timestamp" DESC);

-- AddForeignKey
ALTER TABLE "QueueEntry" ADD CONSTRAINT "QueueEntry_basketId_fkey" FOREIGN KEY ("basketId") REFERENCES "Basket"("basketId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FairValueAttestation" ADD CONSTRAINT "FairValueAttestation_basketId_fkey" FOREIGN KEY ("basketId") REFERENCES "Basket"("basketId") ON DELETE CASCADE ON UPDATE CASCADE;
