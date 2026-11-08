import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts", "pi-extension/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/domain/**/*.ts", "src/application/**/*.ts"],
      exclude: ["**/*.test.ts"],
      // Guide T9: a floor of 80% of lines in domain and application.
      thresholds: { lines: 80 },
    },
  },
});
