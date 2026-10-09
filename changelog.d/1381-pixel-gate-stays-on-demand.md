## Fixed

- 像素档「不进 `check:all`」这条口径此前只是 `quality-gate.mjs` / `.ps1` 两侧注释里的
  一句话：把那一档挪进默认档、同时新增任意一个按需档，全仓判据照样全绿
  （`ps1-consistency.test.ts` 只盯「按需档集合非空、且两侧一致」），代价是每次
  `pnpm check:all` 都起 webServer + 浏览器。现在由 `tests/pixel-run.test.ts`
  按**入口**（`pixel-run.mjs`，不按门禁名）钉住两侧，并附「解析器不是空转」；
  解析器与 `ps1-consistency` 共用 `tests/helpers/quality-gate-gates.ts`。
  （规范 11 §11.8；ISSUE #1381）
