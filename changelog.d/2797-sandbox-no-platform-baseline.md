## Fixed

- **沙箱临时仓库多了一档「这份沙箱没有平台基座」的显式声明**（ISSUE #2797）：
  `withNoPlatformBaseline()` 把 `CNB_PULL_REQUEST_TARGET_SHA` 一族填成**空串**
  （在场且 falsy）而不是删键，`defineGateRepo` 的 `run()` 认 `local: true`。
  判据读的是 `env.X || 兜底链` —— 删键表达的是「这个键从没出现过」，而平台那一跑的
  环境会把它加回来；空串才说得清「这次运行确实没有平台基线」。
- 为什么需要显式声明：临时仓库是 `git init` 造的，平台给的 sha 在它里面根本不存在，
  而 `changed-scope.mjs` 的 `resolveBaseRef()` 优先认那个变量 ⇒ 三点 diff 跑不动 ⇒
  判据 fail-closed 退 2。名字里写着「本地那一档」的用例，不该靠「环境恰好干净」
  才验它自称的那件事 —— 那种形态本机看不见、平台上恒红。
- 判据一个字没动（`scripts/check-format.cjs` / `scripts/changed-scope.mjs` 原样保留）。
