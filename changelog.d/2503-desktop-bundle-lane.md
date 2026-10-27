## Added

- **桌包成品档：独立一条流水线真打安装包，并发布到常驻目录（ISSUE #2503）**。
  每日那 12 格之外的第三条流水线（`.cnb.yml` 的 `.package-gates` / `.lock-package`，
  事件键 `"crontab: 0 2 * * *"` 与 `web_trigger_package` 按钮），清单是
  「装依赖 → 壳工具链自证 → `pnpm tauri build` → 发布」，判据一个字都不在这里重写
  （产物级两道防线仍在 `pnpm build` 那条链上，发布只能排在它绿之后）。

  新增 `scripts/publish-desktop-bundle.mjs` —— 打桌包只补**发布**那一格，不抄第二份打包脚本：
  常驻根由 `resolveArtifactRoot` 推导（问 `pnpm store path` 拿卷，拼 `ci-artifacts/<包名>`，
  **不写盘符**，且刻意是两份缓存槽的**第三个兄弟目录** —— 槽根的淘汰器把每个目录都当成一个键），
  一份一个目录 + `manifest.json`（sha / 构建号 / 事件键 / 时刻 / 体积 / 文件清单），
  `latest.txt` **只是指针文件**（不原地覆盖同名目录），轮转留最近 2 份；
  退出码三态 0 / 1 / 2，其中 2 = **没有结论**（问不出根、或目标卷不够）——
  「今天没有新包」与「没能把包放出去」在日志里逐字不同。

  本地那条链同批改齐：`tools\build\build-all.ps1` 过去只 `cargo build`（**产不出安装包**），
  现在走 `pnpm tauri build` + 同一个发布入口。规范新增 launch-and-build.md **§7.7**，
  那里记的是实测读数而不是预估：产物装配 225.9s ／ Rust 编译 暖 3m12s·冷 5m01s ／
  msi 打包段 151.4s ⇒ 成品 84.86 MiB ／ 总墙钟 579.2s ／ 发布段 1.5s。
  **nsis 那一格到今天没有读数**（要现下两件 GitHub release 资产，本机两跑都
  `timeout: global`），这条也写在 §7.7 里，没有被写成「以后一定绿」。
