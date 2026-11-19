## Fixed

**收窄 `spawn` 参数数组的注入面**（code-scanning `js/shell-command-injection-from-environment`，ISSUE #3327 / 告警 #13、#14）：

- 新增判据（`scripts/launcher-core/shell.mjs`，唯一实现）：
  - `assertAbsoluteRoot(root, label)`：项目根 / 载荷根必须是**已规范化的绝对路径**；相对路径、空值、
    两端空白、未归一化的串一律显式抛错，不静默归一化。
  - `resolveSpawnTarget(root, relEntry, label)`：入口必须是根下、非绝对（含 Windows 盘符 / UNC）、
    无 `.` / `..` / 空段的写死相对路径；拼出的落点再用 `path.relative` 复核不越界。
- `scripts/launcher-core/executor-host-spawn.mjs`：`hostScript` 先过 `resolveSpawnTarget`（非法则打
  `✗` 并返回 null，不退回 inline）；`spawn` 的 `args` 只放常量 `EXECUTOR_HOST_SCRIPT`，变量根留在 `cwd`。
- `scripts/standalone-runtime.mjs`：`APP_ROOT` 过 `assertAbsoluteRoot`；`SERVER` / `HOST_ENTRY` 的落点
  过 `resolveSpawnTarget`；`spawn` 与回收器的 `spawnSync` 参数数组分别只放常量 `"server.js"`、
  `"scripts/executor-host.mjs"`、`"scripts/reap-process.mjs"`，`cwd` 显式钉在 `APP_ROOT`。

**改动前后的注入面**：

- 前：`args[0]` 是「根 + 路径」拼出来的**任意绝对路径**。根一旦被打歪（env / argv / 配置 / 未归一化串），
  任意文件路径都可能进命令行。
- 后：`args` 里只能是源码里写死的三个相对入口；变量只剩 `cwd`，且必须是规范化绝对路径。非法根 / 入口
  显式失败，不再有「按原值继续跑」的路径。
- `shell-ops.mjs` 的 `shellExe` 是另一条**独立**面（来自 env / `--shell-exe`）：它进的是 `command` 而不是
  本单的 `args`，且本单的两条 CodeQL 数据流不含它，故不在本单改动。

**运行时行为**：

- 合法根与合法入口的落点与 `path.join` 逐字同值；`spawn` 仍是 `shell: false` + 参数数组，可执行文件仍是
  `process.execPath`。
- 编排日志里的命令行从「绝对入口」变成「相对入口」（`>>> node server.js`），进程、cwd、落点均不变。
- 回收器的 `spawnSync` 从「依赖当前 cwd」改成显式 `cwd: APP_ROOT`：与既有绝对入口同值，把语义钉死而不是改变它。

**读数**：

- `tests/executor-host-spawn.test.ts` + `tests/cross-platform-launcher.test.ts`：61 通过 / 1 跳过。
- 新增 14 条判据用例：合法 2 形态、10 类非法入口（`..`、中间跳转、反斜杠跳转、POSIX / 盘符绝对路径、
  空值、两端空白、`.` 段、空段、只有父级）、根形态 1 条、根非法时入口不放行 1 条、宿主入口非法时显式报错 1 条。
