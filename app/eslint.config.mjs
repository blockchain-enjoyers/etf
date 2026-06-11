import base from "@meridian/config/eslint";
import globals from "globals";

export default [
  ...base,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    files: ["scripts/**", "*.config.{ts,mjs}"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  { ignores: ["dist/", "node_modules/"] },
];
