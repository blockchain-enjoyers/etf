// Windows workspace shim (see app/scripts/run-vitest.mjs for the full rationale).
// `yarn workspace <pkg> test` can launch binaries with a lowercase drive letter
// (`d:\…`) while a direct run uses the OS-canonical uppercase (`D:\…`). Vitest
// keys its runner registration on the casing of its own entrypoint module path;
// a re-resolve under a different casing misses and every suite dies with
// "Vitest failed to find the runner". Re-exec the vitest CLI and the cwd through
// their OS-canonical paths so registration and lookup always agree.
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const vitestBin = realpathSync.native(
  join(dirname(require.resolve("vitest/package.json")), "vitest.mjs"),
);

process.chdir(realpathSync.native(process.cwd()));

const { status } = spawnSync(process.execPath, [vitestBin, ...process.argv.slice(2)], {
  stdio: "inherit",
});

process.exit(status ?? 1);
