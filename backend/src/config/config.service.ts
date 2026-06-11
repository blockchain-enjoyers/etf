import { Injectable } from "@nestjs/common";
import { type Env, parseEnv } from "./env.schema.js";

@Injectable()
export class ConfigService {
  private readonly env: Env = parseEnv();

  get<K extends keyof Env>(key: K): Env[K] {
    return this.env[key];
  }

  get isProduction(): boolean {
    return this.env.NODE_ENV === "production";
  }
}
