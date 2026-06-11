-- DropForeignKey
ALTER TABLE "Constituent" DROP CONSTRAINT "Constituent_basketId_fkey";

-- DropForeignKey
ALTER TABLE "FairValueAttestation" DROP CONSTRAINT "FairValueAttestation_basketId_fkey";

-- DropForeignKey
ALTER TABLE "Holding" DROP CONSTRAINT "Holding_basketId_fkey";

-- DropForeignKey
ALTER TABLE "NavSnapshot" DROP CONSTRAINT "NavSnapshot_basketId_fkey";

-- DropForeignKey
ALTER TABLE "QueueEntry" DROP CONSTRAINT "QueueEntry_basketId_fkey";

-- DropIndex
DROP INDEX "Constituent_basketId_token_key";

-- DropIndex
DROP INDEX "FairValueAttestation_basketId_timestamp_idx";

-- DropIndex
DROP INDEX "NavSnapshot_basketId_timestamp_idx";

-- DropIndex
DROP INDEX "QueueEntry_basketId_nonce_key";

-- DropIndex
DROP INDEX "QueueEntry_basketId_status_submittedAt_idx";

-- AlterTable
ALTER TABLE "Basket" DROP CONSTRAINT "Basket_pkey",
DROP COLUMN "basketId",
DROP COLUMN "cashComponentPerUnit",
DROP COLUMN "creationUnitSize",
ADD COLUMN     "unitSize" DECIMAL(78,0) NOT NULL,
ALTER COLUMN "basketToken" DROP NOT NULL,
ADD CONSTRAINT "Basket_pkey" PRIMARY KEY ("vaultAddress");

-- AlterTable
ALTER TABLE "Constituent" DROP COLUMN "basketId",
DROP COLUMN "decimals",
DROP COLUMN "weightBps",
ADD COLUMN     "vaultAddress" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "FairValueAttestation" DROP COLUMN "basketId",
ADD COLUMN     "vaultAddress" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "NavSnapshot" DROP COLUMN "basketId",
ADD COLUMN     "vaultAddress" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "QueueEntry" DROP COLUMN "basketId",
ADD COLUMN     "vaultAddress" TEXT NOT NULL;

-- DropTable
DROP TABLE "Holding";

-- CreateIndex
CREATE UNIQUE INDEX "Constituent_vaultAddress_token_key" ON "Constituent"("vaultAddress", "token");

-- CreateIndex
CREATE INDEX "FairValueAttestation_vaultAddress_timestamp_idx" ON "FairValueAttestation"("vaultAddress", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "NavSnapshot_vaultAddress_timestamp_idx" ON "NavSnapshot"("vaultAddress", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "QueueEntry_vaultAddress_status_submittedAt_idx" ON "QueueEntry"("vaultAddress", "status", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "QueueEntry_vaultAddress_nonce_key" ON "QueueEntry"("vaultAddress", "nonce");

-- AddForeignKey
ALTER TABLE "Constituent" ADD CONSTRAINT "Constituent_vaultAddress_fkey" FOREIGN KEY ("vaultAddress") REFERENCES "Basket"("vaultAddress") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NavSnapshot" ADD CONSTRAINT "NavSnapshot_vaultAddress_fkey" FOREIGN KEY ("vaultAddress") REFERENCES "Basket"("vaultAddress") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueEntry" ADD CONSTRAINT "QueueEntry_vaultAddress_fkey" FOREIGN KEY ("vaultAddress") REFERENCES "Basket"("vaultAddress") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FairValueAttestation" ADD CONSTRAINT "FairValueAttestation_vaultAddress_fkey" FOREIGN KEY ("vaultAddress") REFERENCES "Basket"("vaultAddress") ON DELETE CASCADE ON UPDATE CASCADE;
