## Removed

- **`scripts/dev_tools_launcher.py`（Python tkinter 开发工具箱）**：ISSUE #784 删掉
  Python 启动器那条链时（`start_tauri_launcher.py` / `tools/start-tauri.spec` /
  `build-launcher*.ps1`），这个**同族的第二件**只被顺手改了一句注释就留在原地，
  于是它连带三处锚点一起过期：
  - 文件头仍写着「打包为 `dev-tools.exe`」，而 `tools/README.md` 早已写明
    「Python 启动器与它的打包链已随 #784 整体删除」；
  - 界面文案（:113）写死 `localhost:3100` —— 实际端口是**按检出路径推导**的
    （3200~3999，见规范 §1.1），且主机该是 `127.0.0.1`；
  - 菜单里挂着已完成的 `restructure-studio.cjs`（见下条）。

  判据不是「没人 import 它」——它是个 GUI，本来就不该被 import。判据是
  **它声称自己是当前工具链的一部分，而那条工具链已不存在**：全仓没有文档 /
  入口 / 脚本指向它，`tools/README.md` 的入口表里也没有它。常用动作现在都有
  `.ps1` 双击入口与等价的 `pnpm` 脚本，不需要第二个 exe。

- **`scripts/restructure-studio.cjs`**：文件头自己写着「一次性迁移脚本
  （2026-08-29 文件组织审查）」，实测 dry-run **0 个文件待改** —— 迁移早已完成，
  它唯一的作用是被上面那个已删的 Python 工具箱当菜单项调用。对照同目录的
  `repair-imports.cjs` / `tw4-canonical-codemod.cjs`（都有文档与真实用途）可区分：
  判据是「**当前跑一遍什么都不做**且**没有活文档指向它**」。

## Fixed

- **连带清掉三处指向已删产物的锚点**（留着会让人以为那个 exe 还在）：
  - `tsconfig.json` 的 `exclude` 里 `"dev-tools"`（那是 PyInstaller 的 onedir 落点）；
  - `.gitignore` 的 `/dev-tools/` 与 `dev-tools*.spec` 两条（含那句「由
    `scripts/dev_tools_launcher.py` 重建」的注释）；
  - `docs/standards/launch-and-build.md` 的「开发者工具箱」行还指着 `dev-tools`，
    而**同一张表往上 1 行**就写着 Python 启动器已删除 —— 自相矛盾。
