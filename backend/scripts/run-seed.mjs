// Transpile and run prisma/seed.ts using esbuild (no tsx/ts-node required).
// esbuild is already a transitive devDependency via vitest.
import { build } from "esbuild";
import { existsSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const src = join(root, "prisma", "seed.ts");
const out = join(root, "prisma", ".seed-dist.mjs");

let exitCode = 1;
try {
  await build({
    entryPoints: [src],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: out,
    external: ["@prisma/adapter-pg", "@prisma/client", "pg"],
  });

  const { status } = spawnSync(process.execPath, [out], { stdio: "inherit", env: process.env });
  exitCode = status ?? 1;
} finally {
  if (existsSync(out)) unlinkSync(out);
}
process.exit(exitCode);
