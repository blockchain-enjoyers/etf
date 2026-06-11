import { Injectable, Logger } from "@nestjs/common";
import { IndexerService } from "../indexer/indexer.service.js";

/** Producer step (spec §5.2): advance the event indexer by one resumable tick. */
@Injectable()
export class IndexerTickHandler {
  private readonly logger = new Logger(IndexerTickHandler.name);

  constructor(private readonly indexer: IndexerService) {}

  async run(): Promise<void> {
    try {
      const processed = await this.indexer.tick();
      if (processed > 0) this.logger.debug(`indexer-tick processed ${processed} logs`);
    } catch (e) {
      this.logger.error(
        `indexer-tick failed: ${e instanceof Error ? e.message : String(e)}`,
        e instanceof Error ? e.stack : undefined,
      );
      throw e;
    }
  }
}
