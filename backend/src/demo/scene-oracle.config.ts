import { Injectable } from "@nestjs/common";
import { ConfigService } from "../config/config.service.js";

@Injectable()
export class SceneOracleConfig {
  readonly enabled: boolean;
  private readonly map: Record<string, string> = {};
  constructor(config: ConfigService) {
    this.enabled = config.get("DEMO_MODE") as unknown as boolean;
    try {
      for (const [t, m] of Object.entries(JSON.parse((config.get("DEMO_SCENE") as string) ?? "{}"))) {
        this.map[t.toLowerCase()] = m as string;
      }
    } catch {
      /* malformed DEMO_SCENE -> empty scene */
    }
  }
  isSceneToken(token: string): boolean { return Boolean(this.map[token.toLowerCase()]); }
  mockFor(token: string): string | undefined { return this.map[token.toLowerCase()]; }
  tokens(): string[] { return Object.keys(this.map); }
}
