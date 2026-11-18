## Fixed

- `pnpm ship` 复用 PR 的幂等防线（ISSUE #4318）：`list-pulls` 抖动没读到开放清单时，建 PR 幂等那一格会误判「无 PR」、真去建，平台以 409（errcode 2009003「该分支已有开放 PR」）拒绝；号明明在响应里，旧版却只认成功响应的 `data.number`，于是落 `CODE.NOT_RUN`（exit 2）—— 一次接口抖动被升级成流程断点，而 PR 与 CI 都健康。现在从 409 响应的 `data.errparam.number` 取号、视同复用续跑（打标签 / 冲突一眼 / 等 CI 照旧），并念清「复用，不重建」、不误报「已建」。严格只认 errcode=2009003（数字或数字字符串）+ 正整数号，别的拒绝即使带 errparam 也不放宽；取不到号仍照旧退 2。判定抽进独立模块 `scripts/ship/ship-pull-reuse.mjs`（`ship-platform.mjs` 贴着 900 行硬闸，不往里加行）。
- 测试（`tests/ship.test.ts`）：补纯函数三态用例（成功 / 409 duplicate / 别的 errcode 与缺号不猜）与一条复现用例（开放清单抖动 + 409 响应 ⇒ 复用 #4316 继续走、不落 exit 2、不念「已建」），并钉住别的错误响应仍退 2 的负控。
