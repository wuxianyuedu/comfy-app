## Fixed

- e2e 的「应用 server 复用」探测不再是一条必然自击的机关（ISSUE #1766）：
  判据此前挂在 `e2e/global-setup.ts`，而 Playwright 的顺序是「**起 webServer 并等它
  可访问** → 跑 `globalSetup`」（webServer 是 plugin，`setup()` 排在 `globalSetup`
  之前且 plugin 之间串行）。于是本地（`CI` 未设）全量跑**必然探到 Playwright 自己
  刚起的那一个**：一条用例都没跑就红在 `global-setup.ts:120`，可用出口只剩
  `CI=1 pnpm test:e2e`（把本地开发档一并锁死）。
  - 判据前移到 `scripts/e2e-run.mjs` 的 pre-flight（`e2e/support/preflight-ports.mjs`），
    它跑在 `spawn` Playwright **之前** —— 那时端口状态就是真实世界状态；结论编成一行
    JSON 经 `E2E_PREFLIGHT` 带进 `globalSetup`，用它把**「起之前就在」与「本轮自己起的」**
    分开（只有前者叫复用，也才需要提醒「替身的 history 带着上一轮的产物」）；
  - 替身端口那一半同样修掉：此前每次都说「已在运行（复用）」，而那是它自己刚起的；
  - `globalSetup` 侧拿不到 pre-flight 结论时按「不知道」处理（不阻断、也不误报复用），
    所以有人手工 `pnpm exec playwright test` 那条路照旧能跑；
  - 根因与回潮都有判据：`tests/e2e-fake-comfyui-endpoint.test.ts` 从**上游源码**复算
    「plugin setup 排在 global setup 之前、且串行」，并拦住「把即时探测写回
    `globalSetup`」「把 pre-flight 挪到 `spawn` 之后」两种回潮；
  - 口径补进 `docs/standards/11-测试与可观测性.md` §11.3.1。
