import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "~": path.resolve(import.meta.dirname, "src"),
      // server-only 包在 vitest node 环境会抛错（它就是干这个的）；
      // 数据访问层的硬约束在 Next 构建期仍然生效，测试里换空实现。
      "server-only": path.resolve(import.meta.dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],
    globals: false,
    setupFiles: ["tests/setup.ts"],
    // 覆盖率棘轮策略(2026-08-29):已覆盖目录按真实水平设硬门槛,随测试增长上调;
    // 新目录覆盖后加入下表。全库 3% 的整体数字仅作信息参考,不设全局门槛。
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/server/api/middleware/**", "src/lib/**"],
      exclude: ["src/lib/**/*.test.ts"],
      thresholds: {
        "src/server/api/middleware/**": {
          lines: 75,
          functions: 75,
          statements: 75,
          branches: 70,
        },
        // comfyui 执行链路的地基（ISSUE #314）：lifecycle 的探测/拉起/停止
        // 判决表抽到 lifecycle-derive 后可直接断言，目录整体随测试增长上调，
        // 只升不降（规范 11.7 的覆盖率棘轮口径）。
        "src/lib/comfyui/lifecycle-derive.ts": {
          lines: 90,
          functions: 90,
          statements: 90,
          branches: 90,
        },
        "src/lib/comfyui/lifecycle.ts": {
          lines: 45,
          functions: 60,
          statements: 45,
          branches: 30,
        },
        // reaper 与队列调度的判决矩阵（ISSUE #315）：sweeper 的「跳过/回收/不动」
        // 与调度器的排队提示/槽位释放规则按实测值设门槛，只升不降。
        "src/lib/comfyui/reaper.ts": {
          lines: 70,
          functions: 70,
          statements: 70,
          branches: 60,
        },
        "src/lib/comfyui/executor-scheduler.ts": {
          lines: 70,
          functions: 70,
          statements: 70,
          branches: 50,
        },
      },
    },
  },
});
