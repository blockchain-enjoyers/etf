-- CreateEnum
CREATE TYPE "ForwardEnableStatus" AS ENUM ('Pending', 'Wiring', 'Live', 'Failed');

-- CreateTable
CREATE TABLE "ForwardQueueConfig" (
    "vaultAddress" TEXT NOT NULL,
    "queueAddress" TEXT,
    "requestedBy" TEXT NOT NULL,
    "status" "ForwardEnableStatus" NOT NULL DEFAULT 'Pending',
    "params" JSONB NOT NULL,
    "step" TEXT,
    "txHashes" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ForwardQueueConfig_pkey" PRIMARY KEY ("vaultAddress")
);

-- CreateTable
CREATE TABLE "ForwardEnableNonce" (
    "vaultAddress" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForwardEnableNonce_pkey" PRIMARY KEY ("vaultAddress","nonce")
);

-- CreateIndex
CREATE INDEX "ForwardQueueConfig_status_idx" ON "ForwardQueueConfig"("status");
