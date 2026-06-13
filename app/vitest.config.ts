import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { realpathSync } from "node:fs";
import path from "node:path";

// Anchor every module identity (config, test files, node_modules/wagmi) to the
// OS-canonical drive-letter casing. On Windows the FS is case-insensitive, so a
// lowercase `d:\` launch and a canonical `D:\` launch load the same file under
// two distinct module identities, breaking vi.mock interception. Forcing the
// canonical root collapses them into one regardless of how the CLI was started.
const root = realpathSync.native(import.meta.dirname);

export default defineConfig({
  root,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "lightweight-charts": path.join(
        root,
        "src/test/__mocks__/lightweight-charts.ts"
      ),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    // Neutralize the dev .env: unit tests always exercise the real (non-fixtures) paths.
    env: { VITE_USE_FIXTURES: "false", VITE_DEMO_MODE: "false" },
    setupFiles: ["./src/test/setup.ts"],
    // Each file gets a fresh module registry; no in-worker concurrency.
    // Prevents vi.mock factories leaking across files (deterministic green run).
    isolate: true,
    fileParallelism: false,
  },
});
