-- CreateTable
CREATE TABLE "GenesisRecipe" (
    "root" TEXT NOT NULL,
    "tokens" TEXT[],
    "unitQty" TEXT[],
    "unitSize" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GenesisRecipe_pkey" PRIMARY KEY ("root")
);
