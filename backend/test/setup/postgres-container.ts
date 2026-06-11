import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { TestProject } from "vitest/node";

let container: StartedPostgreSqlContainer;

// Resolve backend workspace root and repo root from this file's location:
// __dirname → backend/test/setup → backend/test → backend
const setupDir = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(setupDir, "../..");
const repoRoot = path.resolve(backendDir, "..");
// prisma is hoisted to the repo root's node_modules
const prismaBin = path.join(repoRoot, "node_modules", "prisma", "build", "index.js");

export async function setup(project: TestProject): Promise<void> {
  // Windows + Docker Desktop: make the daemon and credential helper reachable for testcontainers
  // (the Docker CLI is often not on PATH). No-op on Linux/CI, where Docker is auto-detected.
  if (process.platform === "win32") {
    process.env.DOCKER_HOST ??= "npipe:////./pipe/docker_engine";
    const dockerBin = "C:\\Program Files\\Docker\\Docker\\resources\\bin";
    if (!(process.env.PATH ?? "").includes(dockerBin)) {
      process.env.PATH = `${dockerBin};${process.env.PATH ?? ""}`;
    }
  }

  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  const url = container.getConnectionUri();

  // Apply migrations to the ephemeral DB.
  // cwd must be backend/ (where prisma.config.ts lives) so Prisma finds the config + migrations.
  execSync(`node "${prismaBin}" migrate deploy`, {
    cwd: backendDir,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
  });

  // Expose to tests via project context.
  project.provide("databaseUrl", url);
  // Also set on process.env so PrismaService (via ConfigService) picks it up.
  process.env.DATABASE_URL = url;
}

export async function teardown(): Promise<void> {
  await container?.stop();
}

declare module "vitest" {
  interface ProvidedContext {
    databaseUrl: string;
  }
}
