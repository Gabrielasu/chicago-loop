import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["mock/test/**/*.test.ts", "web/src/**/*.test.ts"],
    environment: "node",
  },
});
