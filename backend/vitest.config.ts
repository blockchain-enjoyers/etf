import { realpathSync } from "node:fs";
import swc from "unplugin-swc";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

// Force the OS-canonical drive-letter casing so config, test files and the
// runner all resolve under one module identity regardless of whether the CLI
// was launched with a lowercase `d:\` or canonical `D:\` cwd.
const root = realpathSync.native(import.meta.dirname);

export default defineConfig({
  root,
  plugins: [tsconfigPaths(), swc.vite()],
  // Vite 8 defaults to OXC; disable it so unplugin-swc remains the sole transformer.
  oxc: false,
  test: {
    globals: true,
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["src/**/*.spec.ts"] },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["test/integration/**/*.int.spec.ts", "test/e2e/**/*.e2e.spec.ts"],
          globalSetup: ["test/setup/postgres-container.ts"],
          testTimeout: 60000,
          hookTimeout: 120000,
        },
      },
    ],
  },
});
