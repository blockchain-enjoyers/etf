-- CreateTable
CREATE TABLE "TokenMetadata" (
    "token" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT,
    "decimals" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TokenMetadata_pkey" PRIMARY KEY ("token")
);
