import { configDefaults, defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    testTimeout: 20000,
    hookTimeout: 60000,
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/**/*.test.ts"],
          exclude: [...configDefaults.exclude, "tests/timing/**"],
          sequence: { groupOrder: 0 },
        },
      },
      {
        // Wall-clock budgets ("< 300 ms"): run after the unit project, one file at a time, so the
        // suite's parallel load can't stretch them.
        extends: true,
        test: {
          name: "timing",
          include: ["tests/timing/**/*.test.ts"],
          pool: "forks",
          poolOptions: { forks: { singleFork: true } },
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
