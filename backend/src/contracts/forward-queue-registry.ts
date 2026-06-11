import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "../config/config.service.js";

/** Resolves vault -> ForwardCashQueue from the FORWARD_QUEUES JSON env map (lowercased keys). */
@Injectable()
export class ForwardQueueRegistry {
  private readonly logger = new Logger(ForwardQueueRegistry.name);
  private readonly map: Record<string, string>;

  constructor(config: ConfigService) {
    const raw = (config.get("FORWARD_QUEUES") as string) ?? "{}";
    let parsed: Record<string, string> = {};
    try {
      const obj = JSON.parse(raw) as Record<string, string>;
      for (const [vault, queue] of Object.entries(obj)) parsed[vault.toLowerCase()] = queue;
    } catch {
      this.logger.warn("FORWARD_QUEUES is not valid JSON; treating as empty");
      parsed = {};
    }
    this.map = parsed;
  }

  queueFor(vault: string): string | undefined {
    return this.map[vault.toLowerCase()];
  }

  pairs(): { vault: string; queue: string }[] {
    return Object.entries(this.map).map(([vault, queue]) => ({ vault, queue }));
  }
}
