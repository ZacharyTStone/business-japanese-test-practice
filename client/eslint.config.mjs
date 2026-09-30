/**
 * The one lint the app runs: the rules of hooks.
 *
 * TypeScript already checks the types, and a formatter's opinions are not a
 * bug. What neither catches is a hook called conditionally — after an early
 * return, inside a branch — which works until the branch flips and then
 * throws, or an effect that reads a value it does not list, which works until
 * the value changes and the effect does not run again. So those two rules and
 * nothing else: the first is an error, because it is always a bug; the second
 * a warning, because leaving a stable value out on purpose is sometimes right
 * and the reason belongs in a comment beside it.
 *
 * `npm run lint`, and the `checks` workflow.
 */
import tsParser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  {
    ignores: ["node_modules/", "dist/", ".expo/", "web-build/", "src/lib/generated.ts"],
  },
  {
    files: ["**/*.{ts,tsx,js,mjs}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaFeatures: { jsx: true }, sourceType: "module" },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];
