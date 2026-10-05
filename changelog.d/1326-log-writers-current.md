## Changed

- **日志写方全部落到 `log/current/<分区>/`，`log/` 根目录不再有孤儿文件**（ISSUE #1326 第 2 刀）。第 1 刀只加了地基（`scripts/launcher-core/run.mjs`），这一刀把「谁往哪写」对齐过去：
  - `dev-launcher.mjs`：启动即 `startRun()` 写 `run.json`，`recoverStaleCurrent()` 先收上一次崩掉的残留（**顺序不能反** —— 反了本次的 `run.json` 会被当残留一起收走），`pruneRuns()` 异步跑保留策略；退出时 `archiveCurrent()` 把整个 `current/` 复制进 `runs/`。launcher / nextjs / services 三个分区、`tauri-shell.pid`、`dev-launcher-stderr.log` 一律经 `currentDirOf()` 取路径。
  - `executor-host.mjs` / `standalone-runtime.mjs`：宿主与 standalone 入口的输出目录同步搬进 `current/services` 与 `current/nextjs`。
  - `src/lib/log/log-paths.ts` 的 `LAUNCHER_LOG_DIR` / `NEXTJS_LOG_DIR` / `SERVICES_LOG_DIR` / `WORKSHOP_LOG_DIR` / `COMFYUI_TRACE_DIR` 全部挂到新的 `LOG_CURRENT_DIR` 下；Next 侧的写方（comfyui lifecycle、trace、workshop、capture-streams）因此一并落在 `current/`，无需各处改动。
  - **孤儿归位**：`schema-sync.json` / `schema-sync.log` 从 `log/` 根移进 `log/current/tools/`（它归工具链，写入方是 `db-sync.mjs`）。路径在 `log-paths.ts` 收口一次，`db-schema-state.mjs`（写）与 `GET /api/schema`、`POST /api/schema/push`（读）共用 —— 此前这几处各自手拼 `path.join(process.cwd(), "log", "schema-sync.json")`，漂开的表现是「同步跑了、页面一直说没同步」。
  - **Rust 壳侧路径收口**：`shell_launch.rs` 新增 `current_dir()` / `launcher_dir()` / `shell_log_dir()` / `shell_log_path()` 四个出口，`lib.rs` 与 `shell_launch.rs` 里散落的 `join("log").join("launcher")` 等字面量（原先 10 处）全部改走它们；`launch_paths_match_node_side` 用例同步钉住新的分段。
- **行前缀带 runId**：`createLogSink` 与 `linePrefix()` 统一输出 `[时刻] [级别] [runId][tag] 正文`。runId 由编排器经 `COMFYAPP_RUN_ID` 透传给被 spawn 的宿主——「grep runId 一把梭」要求**每个通道**都写这一列，靠各进程自己生成就散了。这一列是跨运行分析的地基，目录怎么分只影响翻文件的手感。
- `RUNTIME_SCRIPTS` 与 `ALLOWED_SCRIPTS` 两份白名单同批加入 `launcher-core/run.mjs`：它是 `dev-launcher.mjs` 的顶层静态 import，缺一份在桌包里就是编排器整体 `ERR_MODULE_NOT_FOUND`（用户只看到「双击没反应」）。

## Tests

- `tests/log-run-layout.test.ts` 增补 3 例：`scripts` 侧分区与 `log-paths.ts` 逐项同形、`schema-sync` 两个孤儿已归 `current/tools/`（且两侧相对路径同形）、**扫描四个写方源码断言不再出现绕过 `current/` 的 `"log", "<分区>"` 直连**（这条是形态判据：下一个人加写方时它会响）。
- 受路径变更影响的既有用例同步更新：`dev-launcher-downstream-exit`（标记文件的 tmpdir 落点）、`launch-diagnostics`（四份路径的分段）、`executor-host` / `standalone-runtime`（默认输出目录）、两个 schema 路由用例（状态文件落点）。

## Docs

- 规范 §4 的布局总表在**第 5 刀**整体重写；本刀只保证代码与用例一致。旧布局的 `archiveRunLog()` / `LOG_DIRS.archive` 仍留着（`dev-launcher.mjs` 收尾两份归档并行写），删除时机在第 4 刀。
