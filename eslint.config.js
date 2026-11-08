import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["poc/**", "mod/**", "coverage/**", "node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ["*.js", ".*.cjs"] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Guide C3: complexity 10 or less; review files at 300 lines, hard limit 500; aim for 30-line functions.
      complexity: ["error", 10],
      "max-lines": ["error", { max: 500, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["warn", { max: 30, skipBlankLines: true, skipComments: true }],
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
    },
  },
  {
    files: ["**/*.test.ts"],
    rules: { "max-lines-per-function": "off" },
  },
  {
    files: ["*.js", ".*.cjs"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: [".*.cjs"],
    languageOptions: { sourceType: "commonjs", globals: { module: "writable" } },
  },
);
