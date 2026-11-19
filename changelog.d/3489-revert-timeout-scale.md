## Changed

- **收回 vitest 判据预算的 ×2 临时放宽（ISSUE #3489，放宽出处 ISSUE #2959）**：删掉
  `.cnb.yml` 流水线级 env `COMFY_TEST_TIMEOUT_SCALE: "2"` 与两份 GA workflow 的同名键，
  CI 侧 `testTimeout` / `hookTimeout` 回到 30s / 45s 基数（stage 墙钟与 Playwright 60s
  护栏本来就没动）。`vitest.config.ts` 的乘数机制保留：缺省 1 = 与放宽前逐字等价，
  「收回」仍是纯配置动作。钉子测试（`tests/test-config-inheritance.test.ts`）改成
  两档合法形态：键 0 行 = 已收回；1 行 = 再放宽时只许在 `.common` env 且值 ≤3。
