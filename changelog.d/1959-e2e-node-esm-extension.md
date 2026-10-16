## Fixed

- **`E2E 关键流程` 在加载期就崩：`.mjs` 入口经 Node ESM 静态加载的 `.ts`，其相对
  import 缺了 `.ts` 后缀**（ISSUE #1959 第七跑，平台侧实测 **897ms** 退 1）。

  ```
  Error [ERR_MODULE_NOT_FOUND]: Cannot find module
    '…/workspace/src/lib/process/executable-resolve'
    imported from …/workspace/src/lib/process/python-resolve.ts
  ```

  这一跑其实已经把前面所有账都收干净了 —— ESLint 196s ✅ / `单元测试` 13.2m ✅ /
  27 条结构判据 ✅ / `生产构建` 2.1m ✅（`bundle-budget` 已在预算内、产物 2576 文件
  干净、`executor-host-smoke` OK），红的是**唯一一个从没跑过的 stage**。

  **根因**：`src/lib/process/python-candidates.ts` 与 `python-resolve.ts` 里的三条
  相对说明符写成了无后缀（`"./executable-resolve"` / `"./python-candidates"`），而
  这两个模块正是被 `e2e/support/preflight-python.mjs` 与
  `fake-comfyui-executor-env.mjs` **直接静态 import** 的（Node 24 类型擦除）——
  Node 的 ESM 解析器对相对说明符**不做扩展名猜测**，找不到就是找不到。

  **为什么三条既有判据全都放过它**：`tsc`（`moduleResolution: Bundler`）、
  `eslint`、**vitest**（Vite 解析）认无后缀形态，于是
  `tests/e2e-python-preflight.test.ts` 直接 import 那个 `.mjs` **一直是绿的**，
  而 `node scripts/e2e-run.mjs` 一跑就退 1 —— **判据与被判的对象不是同一条解析链**。

  **两处同批修**：

  1. 三条说明符补上 `.ts`（并就地写明「必须带后缀」的理由，这两个文件属于 §18.4
     第三类「纯 Node 宿主」，往后新增消费方不会再问一遍）。
  2. 新增 `tests/mjs-node-esm-resolution.test.ts`：从 `scripts/**` / `e2e/**` /
     `tools/**` 下的 `.mjs` / `.cjs` 入口出发做静态闭包，凡「由 `.mjs` 这条链加载到的」
     模块，其相对说明符都必须显式带 `.ts` —— 按 **Node 的口径**复算，不引 `import()`
     （那会执行入口的主流程）。已登记进 `scripts/fixed-structural-tests.mjs` 的固定清单
     （它守的是别的判据看不见的那条路）。

  **反向复算过（两个方向都做了）**：把三条后缀 `sed` 摘掉回原样 ⇒ 判据当场点名
  `python-candidates.ts: "./executable-resolve"` / `python-resolve.ts: "./executable-resolve"`
  / `python-resolve.ts: "./python-candidates"`；补回后缀 ⇒ 绿。第一版判据对 `.mjs`
  直接 `continue`（「只扫 `.ts`」），**入口那一跳根本没走出去**、把 bug 放回去也不红 ——
  那次空转已就地订正，并写进了判据的注释里。
