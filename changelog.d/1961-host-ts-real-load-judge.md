## Added

- **跨宿主地基层模块「真 Node 加载一次」的判据**（ISSUE #1961 / #1959 第七跑）：
  `tests/esm-cross-host-imports.test.ts` 按源码形状判（叶子性 + 说明符形态）并在
  vitest 里 `import()` 一次，抓的是本次事故（无后缀）那一类；`lib-node-only-declarations.test.ts`
  管 §18.4 三分类的**登记**。两处都漏的是一格**形状正确、加载仍会崩**：
  实测给 `src/lib/process/python-candidates.ts` 加一行 `import "server-only"`
  （§18.4 第二类，入口就是一句 throw）—— 真 Node 抛
  `This module cannot be imported from a Client Component module`，
  而上面两份判据**双双照绿**，`node scripts/e2e-run.mjs` 仍退 1。
  新增 `tests/host-ts-loads-in-node.test.ts` 补这一格：从
  `esm-cross-host-imports.test.ts` 的 `CROSS_HOST_MODULES` **读**出边界清单（不重抄，
  避免孪生），对每一条 `spawnSync(process.execPath, ["-e", "import(…)"])` 起**真 Node**
  加载一次。为什么必须起子进程：本判据的立案前提就是「vitest 内的 `import()` 与真 Node
  不是同一条路」—— 用它自己那套机制去判它判不到的那一格等于把前提写反。
  反向自证一并落地（不存在的路径必须红、真模块必须绿，两个方向都钉）。
  边界清单住在 `src/lib/process/**` 上、判据住在 `tests/`，改动的 import 图追不到，
  故登记进 `scripts/fixed-structural-tests.mjs` 固定清单。
