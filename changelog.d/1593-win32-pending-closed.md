## Fixed

- **win32 像素基线套齐，`PENDING_PLATFORMS.win32` 待录登记关闭**（ISSUE #1593 / 规范 §11.8）。
  首页那两张 `workspace-desktop-dark` / `workspace-desktop-light` 已在 Windows 开发机按登记口径
  （`CI` 置空 ⇒ `pnpm dev`）成套录出并入库，且 `e2e/visual/workspace.visual.spec.ts` 已把三桩
  机器相关数据源桩掉（`clearProjectIndex` 清「最近项目」hydration、`freezeComfyStats` 钉
  `/api/comfy/stats`、`settle` 等到 readiness 降级文案、dev chrome 由 `hideDevChrome` 遮住），
  录的是可复现像素而非机器指纹。据此同批：① 删掉 `scripts/visual-baselines.mjs` 的
  `PENDING_PLATFORMS.win32` 整条（配对判据 `tests/visual-baseline-pairing.test.ts` 的双向不变式
  要求「齐备却仍登记」会红）；② 在 Windows 机跑 `pnpm check:visual`，由 `pixel-run.mjs` 给
  `scripts/.visual-baseline-freshness.json` 写一条 `win32` 自证记录；③ `tests/visual-freshness-gate.test.ts`
  那条「pending 档不要求新鲜度记录」改成显式注入 `pending`，不再绑死 win32 正好在待录里。
  验收提醒：首页三桩改变了首页渲染，已入库的 `-linux.png` 是在「容器里恰好什么都没有」下录的，
  按登记时的清单**同批在 linux 上重录首页那两张**，否则 linux 档会带着旧渲染的基线。
