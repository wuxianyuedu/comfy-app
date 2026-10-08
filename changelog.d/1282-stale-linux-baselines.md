## Fixed

- **linux 档视觉基线自 `#1327` 起就是过期的，`pnpm test:e2e` 与 `pnpm check:visual` 都在干净 master 上红**（ISSUE #1282）。本轮按「跑全量入口」复跑时抓到：`@critical` 60 条全绿，但全量 e2e **72 passed / 5 failed**，五条全是像素基线 diff（`canvas-filled` / `canvas-empty` / `overlay-log-default` / `workspace-desktop-dark` / `workspace-desktop-light`）。
  - **定性：界面真的变了，不是子像素噪声。** 五条红的差异区**逐像素相同**（2032 个点，bbox 恒为 `x16-95 / y177-255`），落在主页侧栏第二项那一格上 —— 即 `#1327`（`007dbf3e`）把「控制台」从 `OVERLAY_NAV_ITEMS` 挪进全局 `NAV_ITEMS` 后，侧栏顺序由「流程 / 模型适配 / 模式契约 / 控制台」变成「流程 / 控制台 / 模型适配 / 模式契约」。这是**正确的产品改动**，过期的是基线。
  - **时间线**：`ae0c1d3d`（10-05 18:16）录出 workspace 基线 → `007dbf3e`（10-05 21:12，+3h）改导航顺序、基线未同批重录 → `663ba492`（10-08 20:08）动过 canvas / overlay 的 PNG 但没跑过像素档核对。所以「录过一次」与「一直绿」在这里断开了两天。
  - **新鲜度账当时是假绿**：`scripts/.visual-baseline-freshness.json` 写着 `linux` 于 `2026-10-05T16:29:24Z` 由 `CI=true pnpm check:visual` 复核通过，而那条命令在今天的机器上必红 —— 这条账记的是「谁在什么时候跑过」，它**不能**替代「现在这一跑到底绿不绿」，两者缺一就还是「有主但没人验」。
  - **修法按 §11.8 既定口径 `--update` 重录，业务代码一个字没动**（导航顺序是产品意图，不许为了迁就过期基线去改）：`CI=true pnpm check:visual:update` 只重写了那 5 张 linux PNG，`pnpm check:visual` 连跑两次均 10 passed + 配对判据 6 passed，`CI=true pnpm test:e2e` 全量 **77 passed / 0 failed**。
  - 新鲜度账按 `pixel-run.mjs` 的既定语义在检查档跑绿时自动重记（`--update` 不记 —— 写成功不是自证）。
