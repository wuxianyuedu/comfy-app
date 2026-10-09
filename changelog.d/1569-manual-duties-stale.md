## Fixed

- **「修改 `scripts/dev-launcher.ps1` 后必须手动同步」是一条早就作废的人为纪律**（ISSUE #1569）：主规范 §10.2 还写着 `src-tauri/static/scripts/dev-launcher.ps1` 为未跟踪副本、改动后必须手工拷贝，而 `scripts/build-desktop.mjs` 第 2.1 步**早就按 `RUNTIME_SCRIPTS` 白名单自动同步**（缺一份在装配时直接失败）。口径改为「它是构建产物、随装配生成，不需要手工拷贝」，并点明入口是 `build-desktop.mjs`（`tools/build/*.ps1` 与 `rebuild-static.ps1` 只是它的入口）。
  - 这类陈旧纪律的**失效形态是静默的**：照旧口径做的人以为自己**必须**记得同步，而真相是漏拷会让桌包里「双击没反应」——把「已经自动化」写成「靠人想起来」，与「把靠人想起来的东西自动化」是同一个洞的两面。

## Fixed

- **§13.5.3 欠账表里「E2E `@critical` 无自动执行者」是一句过期的话**（ISSUE #1569）：`--grep @critical` 走的是 `scripts/e2e-run.mjs`（与全量 e2e 同一入口），而那一档有「每天首次自证」判据（账在 `scripts/.e2e-freshness.json`）。它是全量 e2e 的**子集**，所以子集不另立一档。同时点明它**证明不了像素层**（视觉 spec 没有 `@critical` 标签，§11.8）。`db:push` 那一行也补上「启动链路本身由 `ensureSchemaCurrent` 自动建表（§9.1），所以它不是一条独立的人为纪律」。
