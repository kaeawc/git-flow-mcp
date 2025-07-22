import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [
  {
    files: ["**/*.ts"],
    plugins: {
      "@typescript-eslint": typescriptEslint,
    },
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { args: "none", caughtErrors: "none" },
      ],
      "no-var": "error",
      "prefer-const": "error",
      "no-debugger": "error",
      "no-console": "warn",
      "eqeqeq": "error",
      "curly": "error",
      "semi": "error",
      "quotes": ["error", "double"],
      "indent": ["error", 2],
      "no-trailing-spaces": "error",
      "eol-last": "error",
    },
  },
  {
    files: ["test/**/*.ts", "**/scratch/**/*.ts"],
    plugins: {
      "@typescript-eslint": typescriptEslint,
    },
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { args: "none", caughtErrors: "none" },
      ],
      "no-var": "error",
      "prefer-const": "error",
      "no-debugger": "error",
      "no-console": "off",
      "eqeqeq": "error",
      "curly": "error",
      "semi": "error",
      "quotes": ["error", "double"],
      "indent": ["error", 2],
      "no-trailing-spaces": "error",
      "eol-last": "error",
      "no-unused-expressions": "off",
    },
  },
  {
    files: ["**/*.generated.ts", "**/generated/**/*.ts", "**/*.d.ts"],
    plugins: {
      "@typescript-eslint": typescriptEslint,
    },
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { args: "none", caughtErrors: "none" },
      ],
      "no-var": "error",
      "prefer-const": "error",
      "no-debugger": "error",
      "no-console": "warn",
      "eqeqeq": "error",
      "curly": "error",
      "semi": "error",
      "quotes": ["error", "double"],
      "indent": ["error", 2],
      "no-trailing-spaces": "error",
      "eol-last": "error",
      "no-mixed-spaces-and-tabs": "off",
    },
  },
];
