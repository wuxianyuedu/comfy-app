## Fixed

- **next 16.4.3 → 16.4.6**（ISSUE #4311）：Dependabot 两条 medium 告警（#21/#23）patched
  `>=16.4.5`（`use cache` 函数经 `unstable_cache()` 调用时的跨 root params 信息泄露；
  嵌套 `use cache` 经延迟 inner stream metadata 的缓存泄漏）。直接依赖，manifest
  `^16.4.3` → `^16.4.6` 与 lockfile 同批更新。
