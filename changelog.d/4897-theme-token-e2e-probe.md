## Fixed
- 修复 GA 每日档全量 E2E 的 7 条稳定失败（#4897）：`e2e/theme-token-consumers.spec.ts` 的 `beforeEach` 仍断言首页重定向到 `/workspace`，但 #4881/#4885 已让 `/` 直接渲染创作台、URL 停在 `/`；探针断言改为停在 `/`（与 smoke 用例同口径），注释同步。首页与 /workspace 复用同一份页面实现，token 探针本身不受影响。验证：该 spec 7 条全绿（带参数跑，不记整档凭证）；全量 E2E 仍由 GA 每日档判定。另两处连续 flaky 的 @critical 用例已单独立案 #4946。
