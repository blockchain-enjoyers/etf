-- CreateEnum
CREATE TYPE "ForwardTicketKind" AS ENUM ('Create', 'Redeem');

-- CreateEnum
CREATE TYPE "ForwardTicketStatus" AS ENUM ('Pending', 'Partial', 'Settled', 'Cancelled');

-- CreateEnum
CREATE TYPE "ForwardEventKind" AS ENUM ('CreateRequested', 'RedeemRequested', 'Cancelled', 'Settled', 'PartialFill');

-- CreateTable
CREATE TABLE "ForwardTicket" (
    "id" TEXT NOT NULL,
    "queueAddress" TEXT NOT NULL,
    "vaultAddress" TEXT NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "owner" TEXT NOT NULL,
    "kind" "ForwardTicketKind" NOT NULL,
    "amount" DECIMAL(78,0) NOT NULL,
    "remaining" DECIMAL(78,0) NOT NULL,
    "status" "ForwardTicketStatus" NOT NULL DEFAULT 'Pending',
    "cutoff" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ForwardTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForwardEvent" (
    "id" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "queueAddress" TEXT NOT NULL,
    "vaultAddress" TEXT NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "kind" "ForwardEventKind" NOT NULL,
    "payload" JSONB NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForwardEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ForwardTicket_vaultAddress_status_idx" ON "ForwardTicket"("vaultAddress", "status");

-- CreateIndex
CREATE INDEX "ForwardTicket_owner_idx" ON "ForwardTicket"("owner");

-- CreateIndex
CREATE UNIQUE INDEX "ForwardTicket_queueAddress_ticketId_key" ON "ForwardTicket"("queueAddress", "ticketId");

-- CreateIndex
CREATE INDEX "ForwardEvent_vaultAddress_timestamp_idx" ON "ForwardEvent"("vaultAddress", "timestamp" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ForwardEvent_txHash_logIndex_key" ON "ForwardEvent"("txHash", "logIndex");

-- AddForeignKey
ALTER TABLE "ForwardTicket" ADD CONSTRAINT "ForwardTicket_vaultAddress_fkey" FOREIGN KEY ("vaultAddress") REFERENCES "Basket"("vaultAddress") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForwardEvent" ADD CONSTRAINT "ForwardEvent_vaultAddress_fkey" FOREIGN KEY ("vaultAddress") REFERENCES "Basket"("vaultAddress") ON DELETE CASCADE ON UPDATE CASCADE;
