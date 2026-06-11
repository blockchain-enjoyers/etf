import { Global, Module } from "@nestjs/common";
import { BasketRepository } from "./basket.repository.js";
import { PrismaService } from "./prisma.service.js";

@Global()
@Module({
  providers: [PrismaService, BasketRepository],
  exports: [PrismaService, BasketRepository],
})
export class PersistenceModule {}
