## Changed

standalone 桌包的运行期日志与导出落点，从「载荷根 / 安装目录」迁到 OS app-data 目录（ISSUE #3498）。

- 新增 `scripts/launcher-core/app-data-dir.mjs` 的 `resolveAppDataDir`：按 OS 取 app-data 根（Windows `%LOCALAPPDATA%`、macOS `Library/Application Support`、Linux `$XDG_DATA_HOME` / `~/.local/share`），显式 `COMFY_APP_DATA_DIR` 可覆盖，依赖全部可注入以便跨平台单测。
- `src/lib/log/log-paths.ts` 的 `LOG_ROOT` 改为优先读 `COMFY_APP_DATA_DIR`，否则回退 `process.cwd()/log`（开发态不设该变量 ⇒ 行为不变）。其下 `LOG_CURRENT_DIR` / `LOG_EXPORT_DIR` 等全部派生，改一处即整体随动。
- 启动器 `scripts/standalone-runtime.mjs` 经 `buildStandaloneRuntimeEnv` 把数据根注入 `COMFY_APP_DATA_DIR`，并自己写 server / host 日志到同一处，保证「启动器写日志」与「Next 读 log 根」两侧对齐。

`db.sqlite` 与运行期密钥仍锚载荷根（`data/`），迁移需首启拷贝旧库、风险另计，留待单独跟进。
