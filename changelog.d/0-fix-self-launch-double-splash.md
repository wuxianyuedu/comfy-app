## Fixed

- **一次双击出现两个「正在启动桌面应用」窗口**：PR #1712（ISSUE #1687）给「编排器起的壳」短路了单实例判定，而启动页是 `tauri.conf.json` 的声明式窗口——每个 `{{shell.app.exe}}` 进程各建一份。双击链路（壳 → 编排器 → 壳）里的第二只壳因此带着一模一样的启动页活了下来；两个窗口读同一份 `run/launch-status.json`，进度完全同步。
  - 修法回到链路的本义（规范 §1.5 开头那句「自编排那次双击不会再起第二个壳」）：自编排那次**只编排、不起壳**——拉起编排器的那只壳就是本次启动唯一的应用宿主（启动页与主窗都在它身上），编排器带 `COMFYAPP_SHELL_SELF_LAUNCH=1` 时直接跳过 `spawnShell`。
  - `spawnShell` 不再注入自编排标记，`spawnDevServer` 同步去掉；壳侧删除 `is_shell_child()` 短路，单实例判定回归无条件——任何 `app.exe` 都必须自己过「同一检出已有壳在跑吗」，不存在可以跳过的壳。
  - 编排器侧 #1687 的本义保留：自编排链路里端口族判定仍只跑壳那一次（`launchedByShell` = 标记 + prebuilt 双条件放行）。

## Tests

- `tests/dev-launcher-toolchain-gate.test.ts`：自编排分支不许再 spawn 壳；自编排标记不再注入给壳 / dev server；壳侧单实例判定无短路。
- `src-tauri/src/shell_launch.rs`：删除 `is_shell_child` 及其用例（「被编排器起的壳」形态已随第二个壳一起移除）。

## Docs

- 规范 §1.5 / §1.7：判据表删去「第二段的双实例判定可以跳过」，改写为「自编排链路不再起第二个壳；单实例判定没有例外分支」。
