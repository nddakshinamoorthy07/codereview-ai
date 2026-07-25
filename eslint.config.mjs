import { defineConfig } from "eslint/config";

export default defineConfig([
  {
    ignores: [".next/**", "out/**", "build/**", "node_modules/**"],
  },
  {
    rules: {
      "no-unused-vars": "warn",
      "no-undef": "error",
    },
  },
]);
