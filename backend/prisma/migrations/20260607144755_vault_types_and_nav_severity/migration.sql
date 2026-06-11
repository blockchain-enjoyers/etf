-- CreateEnum
CREATE TYPE "VaultType" AS ENUM ('Basket', 'Managed', 'Committed');

-- CreateEnum
CREATE TYPE "OracleSeverity" AS ENUM ('Open', 'Degraded', 'Halted', 'Closed', 'Unknown');

-- AlterTable
ALTER TABLE "Basket" ADD COLUMN     "manager" TEXT,
ADD COLUMN     "managerFeeBps" INTEGER,
ADD COLUMN     "recipeCommitment" TEXT,
ADD COLUMN     "vaultType" "VaultType" NOT NULL DEFAULT 'Basket';

-- AlterTable
ALTER TABLE "NavSnapshot" ADD COLUMN     "safe" BOOLEAN,
ADD COLUMN     "severity" "OracleSeverity";
