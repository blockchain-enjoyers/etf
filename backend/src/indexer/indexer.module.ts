import { Module } from "@nestjs/common";
import { ChainModule } from "../chain/chain.module.js";
import { ContractsModule } from "../contracts/contracts.module.js";
import { IndexerRepository } from "./indexer.repository.js";
import { ChainLogReader, IndexerService, ViemChainLogReader } from "./indexer.service.js";

/** Event indexer (spec §5.2): viem logs -> read models, resumable via IndexerCheckpoint. */
@Module({
  imports: [ChainModule, ContractsModule],
  providers: [
    IndexerRepository,
    IndexerService,
    { provide: ChainLogReader, useClass: ViemChainLogReader },
  ],
  exports: [IndexerService],
})
export class IndexerModule {}
