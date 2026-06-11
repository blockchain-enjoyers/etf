// Windows workspace shim. `yarn workspace <pkg> test` launches binaries with a
// lowercase drive letter (`d:\…`) while a direct `cd app && yarn vitest` uses
// the OS-canonical uppercase (`D:\…`). Vitest registers its test runner keyed
// on the casing of its own entrypoint module path; when a worker re-resolves
// that module under the canonical casing, the lookup misses and every suite
// dies with "Vitest failed to find the runner". Re-exec the vitest CLI through
// its OS-canonical path so registration and lookup always agree.
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const vitestBin = realpathSync.native(
  join(dirname(require.resolve("vitest/package.json")), "vitest.mjs"),
);

// Also canonicalize the cwd so node_modules / config / test-file resolution
// hangs off the OS-canonical casing, matching the canonicalized bin path.
process.chdir(realpathSync.native(process.cwd()));

const { status } = spawnSync(process.execPath, [vitestBin, ...process.argv.slice(2)], {
  stdio: "inherit",
});

process.exit(status ?? 1);
