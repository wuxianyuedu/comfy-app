## Added

- **运行期「陈旧路由表」症状驱动自愈**：启动器就绪后常驻探测——只看「页面 `/` 仍 200 且 `/api/health` 连续 3 拍（约 15s）返回 404」这个**症状**，命中才轻量重启 dev 子进程（保住桌面壳）、清 `.next`、带重启原因重新拉起。**与 HMR 零重叠**：HMR 已吸收的 `git pull` 下 `/api/health` 仍是 200，探测毫不知情、零动作。有界（60s 冷却 + 单会话上限 3 次），超限只记日志不再动手。

- **自愈重启的懒归因**：判据是症状、归因只产文案，因此只在**已经决定自愈**那一刻才跑一次 `git diff --name-status -M <启动时 HEAD> HEAD`，把改动翻成一句人话（「本次代码更新改了路由结构（新增 2，如 api/foo/route.ts）」等）；git 拿不到就退化为「（无法归因）」，绝不影响自愈。全生命周期仅两次 git 调用（启动记 HEAD + 自愈时比一次）。

- **依赖面陈旧的前端通知**：`/api/dev/build-id` 新增 `restartDetail`（懒归因的人话）/ `depsStale` / `depsState`（`drift` / `no-install` / `unresolved` / `fresh`）。`CodeUpdateWatcher` 据此提示「依赖与代码不一致，需重装依赖：关掉应用窗口后 1. `pnpm deps:guard` 2. `pnpm install`」——这条要的是一个应用内做不到的动作（停服务 + 装依赖），只能提示。按 `depsState` 跨刷新去重；判定为新鲜时清掉记录，下次拉到新改动还能再提示。

## Changed

- **一次自愈只给一条可行动消息**：自愈重启会同时产生「应用服务断开→恢复」一对、启动器重启原因、以及「Ctrl+R 重载」提示。`CodeUpdateWatcher` 在记重启消息时先移除同窗口内（120s）由探活链路产出的 `offline` / `restart` 两条伴生消息，合并成一条带归因的「应用服务已重启」，避免同一次重启弹三条。重启原因（`route-404-heal` / `stale-route-table`）只有构建标识这条链路拿得到，故这一条仍由 `CodeUpdateWatcher` 负责。

- **storybook 消息中心源**：`message-center-sources` 新增 `runtimeSelfHeal` 场景，文案由生产方的导出函数（`describeDevServerRestart()` / `describeDepsStale()`）现算，不手抄第二份。
