import js from "@eslint/js";
import tseslint from "typescript-eslint";

// Shared flat-config base. Consumers: `export { default } from "@meridian/config/eslint";`
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { ignores: ["dist/", "node_modules/", ".next/"] },
);
