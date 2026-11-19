## Added

- **桌包档加一格「打包·NSIS 工具现场读数」（ISSUE #3297）**：只加读数、不改判据、不猜修法，恒退 0。
  桌包档每一次死在 `Running makensis … / Unable to start child process, error 0x2`，而前一格
  `打包·桌包工具预置` 逐字报「必需件齐全」——两格对同一棵树给出互相矛盾的结论：预置判
  `resolveTauriCacheRoot()` 读 `%LOCALAPPDATA%` 拼出的 `tauri\NSIS`，bundler 走
  `SHGetKnownFolderPath`（规范 §7.7 记着「不读环境变量」），LocalSystem 会话里两者未必同值。
  新格夹在「工具预置」与 `pnpm tauri build` 之间，由 `scripts/ci-nsis-tool-probe.mjs` 一次打出：
  `ensure` 侧 `%LOCALAPPDATA%` 原值与落点、bundler 侧 known folder
  （`[Environment]::GetFolderPath('LocalApplicationData')`）与落点、两处 `makensis.exe` 的
  `Test-Path` / `Length` / **真跑一次** `/VERSION` 的退出码与输出 / 整树文件数 / 进程账号 /
  两处是否同值。按本单评论的两条判据，`0x2` 不等于「文件不在」（依赖 DLL 缺件同码），
  且 `NSIS_PLAN.required` 六件不是「完整」判据，所以整树文件数独立数、不复用
  `missingRequired()` 的结论。`ensure` 侧落点复用 `tauri-tools-cache.mjs` 的
  `resolveTauriCacheRoot` + `NSIS_PLAN.cacheRel`，不另抄路径推导。
  顺序与「点在盘上的入口」由 `tests/no-platform-ci-config.test.ts` 钉住，行为由
  `tests/ci-nsis-tool-probe.test.ts` 钉住；规范 §7.7 同批补落地说明（含生成态镜像）。
  下一次桌包档红时照读数分叉：两处不同值 ⇒ 改 `resolveTauriCacheRoot` 口径并订正 §7.7
  那句处置；两处相同且 exe 能跑 ⇒ 查 spawn 层（ACL / 杀软）。
