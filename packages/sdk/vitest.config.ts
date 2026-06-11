import { defineConfig } from "vitest/config";
import { realpathSync } from "node:fs";

// Force the OS-canonical drive-letter casing so the config, test files and the
// runner all resolve under one module identity regardless of whether the CLI
// was launched with a lowercase `d:\` or canonical `D:\` cwd (Windows FS is
// case-insensitive, so the two casings otherwise load as distinct modules).
const root = realpathSync.native(import.meta.dirname);

export default defineConfig({
  root,
  test: {
    include: ["src/**/*.spec.ts"],
    environment: "node",
  },
});
