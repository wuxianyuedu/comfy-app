## Changed

- **oxlint `typescript/strict-boolean-expressions` 批 17：`tests` 清零
  （142 处 / 61 份）**（ISSUE #2776 / #2917）：ship.test 16、
  design-md-contract-sync 14、text-tiers / ratchet-update-guards /
  theme-token-single-source / base-check 合 28、九份中文件 30
  （app-event-pairing、radius-scale、storybook-tsc-input、ci-cache-slot-quota、
  no-platform-ci-config、conditional-skip-registry、cross-platform-launcher、
  trpc-surface-executors、renderWithProviders）、八份 2 处文件 16、
  1 处×38 份。
  - 口径与前几批一致，tests 两条专门边界：断言形态（`expect(x).toBeTruthy()`
    等）一律不动、宽松/严格程度不改，只把其后的 TS 收窄守卫显式化；mock 桩
    里的防御性判空按 `Boolean(x)` 口径（如 renderWithProviders 的
    `behavior.delayMs` 可空 number 裸真值）。夹具 opts 布尔 → `=== true`；
    regex 捕获组与 `noUncheckedIndexedAccess` 下标/Map.get/Array.pop 的
    `T | undefined` → `!== undefined && !== ""` 双判；可空布尔
    （`statSync(...)?.isDirectory()`、`opts.drop?.includes(rel)` 等）→
    `=== true`。
  - 验证：按 16 / 14 / 28 / 30 / 16 / 38 分六组改写，逐组重拉复核，
    整目录终扫 0 残留；全量 `tsc --noEmit` 绿、`vitest run tests` 绿。
  - 剩余总量见批 18 收尾后的 `log/tools/sbe-remaining-2026-11-02.md`
    （127 处 / 39 份）。
