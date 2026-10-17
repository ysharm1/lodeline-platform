import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const oxc = { jsx: { runtime: "automatic", importSource: "react" } } as const;
const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

export default defineConfig({
  test: {
    projects: [
      { resolve: { alias }, oxc, test: { name: "unit", environment: "node", include: ["src/**/*.test.ts", "app/**/*.test.ts"], exclude: ["src/**/*.db.test.ts"] } },
      {
        resolve: { alias },
        oxc,
        test: {
          name: "db",
          environment: "node",
          include: ["src/**/*.db.test.ts"],
          globalSetup: ["./test/global-setup.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
