import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "~": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],
    globals: false,
    setupFiles: ["tests/setup.ts"],
    // 生产级质量门槛：核心逻辑测试覆盖率低于阈值即失败
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/server/api/middleware/**", "src/lib/**"],
      exclude: ["src/lib/**/*.test.ts"],
      thresholds: {
        lines: 70,
        functions: 70,
        statements: 70,
        branches: 60,
      },
    },
  },
});
