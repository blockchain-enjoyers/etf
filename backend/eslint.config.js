import base from "@meridian/config/eslint";
import globals from "globals";

// Backend ESLint config: shared preset (@meridian/config) + backend-specific ignores.
// Generated Prisma client and build output are not linted.
export default [
  ...base,
  { ignores: ["dist/", "src/generated/**", "node_modules/", "prisma/migrations/**"] },
  {
    rules: {
      // Underscore-prefixed params/vars are intentionally unused (standard TS convention).
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["scripts/**", "*.config.{ts,mjs}"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
];
