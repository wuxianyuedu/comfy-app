## Fixed

- **构建文档里「本地产得出安装包」那句话此前是假的（ISSUE #2503）**：
  `docs/standards/launch-and-build.md` §7.0 那张表一直写「生产构建（standalone + 安装包）：
  `build-standalone.ps1` → `build-tauri-release.ps1`（或 `build-all.ps1`）」，而当场读数是
  `build-standalone.ps1` 跑的是 `pnpm tauri build **--no-bundle**`（不打安装包）、
  `build-tauri-release.ps1` 只 `cargo build`（连 `build-desktop.mjs` 都不跑）——
  **那条链上没有任何一步产出 nsis/msi**。`tools/README.md` 与 `README.md` 的入口表同一处漂移。

  这一批把正文改到与代码一致，并各拆成两行：「standalone，**不出安装包**」与
  「桌包成品（**含安装包**）+ 发布到常驻目录」。§7.6 那句「`build-tauri-release.ps1` /
  `build-all.ps1` 刻意不跑 `build-desktop.mjs`」同步收窄成只指前者（`build-all.ps1` 从今天起
  走 `pnpm tauri build`，装配就在它那一格里）。

  顺带删掉 `tools/README.md` 里「`build-tauri-release.ps1` 在 static 缺失时会跑完整
  `build-desktop.mjs`」那半句 —— 那段代码自己写着为什么**不**这么做（整树装配实测把
  8 GB+ 的项目副本嵌进 exe），正文一直留在旧事实上。
