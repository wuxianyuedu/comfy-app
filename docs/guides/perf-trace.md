# 性能取证：按需录一段页面 / 操作的 trace

> 来源：ISSUE #3843（#3771 评论 2 的诉求）。冻结 / 卡顿类问题要定位到行，
> 需要出问题时刻的**主线程 trace**；人工附加 DevTools 成本高、时机难（冻结发生
> 后才想抓已经晚了）。本指南说明用仓库自带的入口按需录一段、以及拿到 trace 后怎么读。

## 一句话

```bash
pnpm perf:trace /settings          # 录「加载 /settings + 静置 5s」一段 trace
```

> ⚠️ 动词是 **`perf:trace`**，不是 `profile`：`pnpm profile` 是 pnpm 的内建命令
> （与 `pnpm docs` 同款的坑——内建命令会抢在仓库脚本前面，实测报
> `The "profile" command is not yet implemented in pnpm`）。

Windows 双击：`tools\start\perf-trace.ps1`（与 `pnpm perf:trace` 同一实现，选项相同）。

> ⚠️ **Git Bash 用户**：以 `/` 开头的路由会被 MSYS 改写成 Windows 路径（`/` →
> Git 安装根，实测 `/` 变成 `D:/Program Files/Git/`）。加 `MSYS_NO_PATHCONV=1`
> 前缀再跑，或改走双击入口 / PowerShell。

## 它做什么

1. 应用没在跑就自己起（`scripts/dev.mjs`，与 `pnpm dev` 同一条入口；已在跑则复用）；
2. 开无头 chromium，打开指定路由；
3. 用 Chrome DevTools 的 Tracing 域录一段（类别含主线程任务 `devtools.timeline`
   与 CPU 采样 `disabled-by-default-v8.cpu_profiler`）；
4. 按次命名落 `log/profiles/trace-<路由>-<时间戳>.json`（`/log/` 不进库）；
5. 打印一份页面计时摘要（DOMContentLoaded / 首绘 / LCP / 资源数 / 长任务数）与「怎么读」。

## 选项

| 选项 | 作用 |
| --- | --- |
| `[路由]` | 应用内路由（缺省 `/`） |
| `--settle <ms>` | 加载完成后额外录制的毫秒数（缺省 5000） |
| `--click <选择器>` | 加载稳定后先点击该元素再继续录（把一次**操作**录进 trace） |
| `--out <path>` | trace 输出路径（缺省按次命名） |
| `--timeout <ms>` | 起应用时等它监端口的上限 |
| `--no-server` | 不自己起应用（应用必须已经在跑） |

## 拿到 trace 之后怎么读

1. 打开 <https://ui.perfetto.dev>（或 Chrome 的 `chrome://tracing`），把 trace 文件拖进去；
2. 看主线程泳道：`RunTask` / `v8.run` / `FunctionCall` 的长条 —— 单个任务超过 50ms
   就会掉帧（用户可感知的卡）；
3. 展开长任务看 CPU 采样栈（已录 `cpu_profiler`），定位到具体函数；
4. 网络与渲染事件在同一份时间轴上，能对出「是脚本在算、还是在等资源」；
5. 冻结类问题（主线程完全不动）：看冻结时间窗里主线程是「有任务在跑」还是
   「整段空白」——空白 + 0 CPU 多半是同步等待（如未处置的对话框、同步 IPC），
   此时改抓该时间窗的渲染进程堆栈（见 #3771 的排查记录）。

## 边界（为什么不是常驻能力）

- **trace 有开销**：录制本身会拖慢被测页面、污染测量结果 —— 只按需取证，
  不挂在常驻轮询里，也不进 CI 档；
- **产物不进库**：`log/profiles/` 在 `.gitignore` 的 `/log/` 下，trace 是排查读数，
  不是仓库产物；要贴进诉求单走 `cnb issues upload-file`；
- **只录不判**：工具给 trace 与计时摘要，「哪段代码慢」的归因由人对着 trace 读。

## 与既有工具的分工

| 想做的事 | 用什么 |
| --- | --- |
| 改完 UI 交一张真实运行截图 | `pnpm screenshot [路由]`（见 `ui-screenshot.md`） |
| 定位卡顿 / 冻结 / 掉帧 | `pnpm perf:trace [路由]`（本指南） |
| 看 CI / 用例日志 | `pnpm ship --stage-log` / `--diagnose` |
