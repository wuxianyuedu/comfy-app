## Fixed

- **启动日志里同一条行叠了两份「时刻 + 级别」**（ISSUE #1365）。编排器（`scripts/launcher-core/log.mjs`）的每条日志本来就写成 `[2026-10-02 11:50:31.384] [STEP ] 检查端口占用`，而壳转发时把它整行塞进正文、再让 `log_launch_line` 补一层自己的时刻与级别，用户就在面板上读到 `[orchestrator] [2026-10-02 11:50:31.384] [STEP ] 检查端口占用`（外面还套壳的一层）。
  - 修法 = 在**源头**摘掉编排器自己那层前缀：`shell_launch.rs` 新增 `strip_orchestrator_line_prefix`（认得出 `[定宽时刻] [级别] 正文` 才摘，认不出就整行原样返回，绝不猜裸输出），级别经 `orchestrator_level_to_shell` 归一（`WARN`→warn、`ERROR`→error，其余已认出的→info，只有认不出前缀时才按出口方向兜底）。
  - 两个出口收进 `log_orchestrator_line` 一处：`log::`（channel / release 的 `shell.log`）与壳侧编排链路日志（`shell-launch.log`）同一份正文、同一级别，永远都是 `[<壳时刻>] [<级别>] [orchestrator] <正文>`。
  - 面板侧不用改：`APP_RUNTIME_LOG_RE` 的 `[时刻] [级别] [ns] 正文` 恰好把 `[orchestrator]` 收进 `ns`，行首只显示一个时刻、徽标只显示一个级别。

## Tests

- `src-tauri/src/shell_launch.rs`：`strips_dev_launcher_line_prefix`（定宽补空格也吃掉）、`keeps_raw_output_untouched`（pnpm / next 裸输出原样保留）、`maps_orchestrator_level_to_shell_level`（已认出的级别不被出口方向覆盖）、`forwarded_line_has_single_timestamp_and_level`（回归用户截图：落盘行只能有一层时刻 + 级别）。
- `src/components/studio/logs/log-store.test.ts`：`parseFileLogs 文件日志解析` 新增两条，钉住壳转发行的面板形态（正文只剩 `[orchestrator] 正文`、时刻只来自行首、级别只出现一次）。

## Docs

- 规范 §1.5.3：壳转发编排器输出必须摘掉编排器自己那层前缀（形态表 + 两处回归判据）。
