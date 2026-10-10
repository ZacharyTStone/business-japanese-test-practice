// Bugs, not style, for the pipeline (bjt/ and tests/). Every rule here flags
// code that does something other than what it says; none has an opinion about
// layout, so the lint never asks for a reformat. Add a rule when it catches a
// kind of mistake this repository has made, not because it exists.
//
// The promise rules are the reason this file exists: the pipeline calls the
// model, the voices, the image model and the bucket, all asynchronously, and a
// call nobody awaits runs after the night has moved on (or never). They need
// the type checker, hence `projectService`.
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["client/**", "node_modules/**", "media/**", "seeds/**", "**/*.mjs"],
  },
  {
    files: ["bjt/**/*.ts", "tests/**/*.ts", "vitest.config.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { "@typescript-eslint": tseslint.plugin },
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: {
      // A promise that is neither awaited, returned nor deliberately voided.
      "@typescript-eslint/no-floating-promises": "error",
      // A promise where a value is expected: `if (asyncFn())` is always true.
      "@typescript-eslint/no-misused-promises": "error",
      // `await` on something that is not a promise: usually a call that was
      // meant to be async and is not, or the reverse.
      "@typescript-eslint/await-thenable": "error",
      // A variable, import or argument nobody reads (pyflakes' F401/F841).
      "@typescript-eslint/no-unused-vars": ["error", { args: "none", caughtErrors: "none", ignoreRestSiblings: true, varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" }],
      // A comparison or an expression that does nothing: usually a lost assert.
      "no-unused-expressions": "off",
      "@typescript-eslint/no-unused-expressions": "error",
      // A comparison with itself, a duplicate key, unreachable code.
      "no-self-compare": "error",
      "no-dupe-keys": "error",
      "no-unreachable": "error",
      // A closure over a loop variable declared with var (B023's cousin).
      "no-loop-func": "error",
      // A cast that changes nothing: it hides the one that would, when the type moves.
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      // An empty block, an empty catch included: an error swallowed without a word.
      "no-empty": ["error", { allowEmptyCatch: false }],
      // A switch over a union that misses a member: a new verdict or role falls through.
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      // A throw of something not an Error: no stack, and `instanceof` checks miss it.
      "@typescript-eslint/only-throw-error": "error",
      // `==` between two things neither of which is null: a coercion nobody meant.
      "eqeqeq": ["error", "smart"],
    },
  },
);
