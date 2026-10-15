## Added

- **出图进程的 CPU 占用档位（设置 → 创作后端 →「出图 CPU 占用」）**（ISSUE #1959）：
  出图是可长跑的后台负载，占满机器时用户在同一个窗口里干活（编辑器 / 浏览器 /
  画布拖拽）都在抢同一批核。三档：
  - `不限制` 出图全速；
  - `出图让路`（桌面壳内默认）把进程优先级降到 BelowNormal / nice+10 —— **只在有人
    抢时才让路**，机器闲着时照样全速；
  - `限核` 再叠加处理器亲和性，最多用本机一半的核。

  手段是**优先级 + 亲和性**，刻意不做「硬限速」：那在 POSIX 上要 `cpulimit`、Windows
  上无对应物，等于引入一处平台分叉加一个可选依赖（AGENTS 硬规则 3 只许两处平台判据）。
  施加时机是**起进程之后**，且 fire-and-forget —— 一个可选的性能开关不该有把启动
  拖慢或弄挂的权力；失败逐条如实记进运行日志（`renice` / `taskset` / PowerShell
  可能不存在或权限不足），绝不静默。档位在下次启动 ComfyUI 时生效。

  判据（档位 → 命令）在纯模块 `src/lib/comfyui/cpu-limit.ts`（13 条用例），施加层
  在 `cpu-limit-apply.ts`（7 条，注入执行器，不碰跑用例那台机器的优先级），接线由
  `tests/comfyui-cpu-limit-wiring.test.ts` 按源码形状钉住两条拉起路径（bound 拿
  `child.pid`、keepAlive 按 `main.py` 有界反查）—— 少一处调用是静默失效，只有任务
  管理器知道。

## Fixed

- **启动日志面板里的中文乱码**（ISSUE #1959 的第二个问题）：保活模式的重定向输出
  （`comfyui-keepalive-*.out/err.log`）被 1s 一拍地增量跟进到 `comfyui-runtime.log`，
  而增量读取按**字节游标**切开、对每段各自 `toString("utf-8")` —— 一个中文字符占
  3 字节，ComfyUI 的刷屏频率远高于 1s 节拍，于是每次切在字符中间时两端各解出一串
  U+FFFD（面板上就是乱码）。

  修法是加一层**字符级残余**：新增纯模块 `src/lib/log/utf8-incremental.ts`，
  `decodeIncremental(carry, next)` 把上一轮没凑齐的字节拼回来再解、把本轮末尾的
  残缺尾巴留到下一轮。它的用例穷举了「两刀三段的全部切点」并断言逐字复原 ——
  这条判据在旧的 `buf.toString("utf-8")` 形态下会红。同一函数也钉住「真正的非法
  字节照旧如实报坏」：本模块只负责**不自己制造**乱码。

## Fixed（续）

- **覆盖率报告的 `text` reporter 会把构建日志顶穿 100KB 上限**（ISSUE #1959 的截图里那句
  `The log length exceeds the limit(102400)`）：`text` 把报告里**每一个文件**打一行，
  而本仓有 450+ 个文件落在覆盖率面上，那张表本身就有 ~90KB。现场实测
  `pnpm test:coverage` 只跑三个目录（`src/lib/{comfyui,log,workshop}`）就已经
  **107456 字节**，全量数倍 —— 于是 CI 里看不到任何失败原因，只剩那句「日志超长」。

  出路是给输出量分档而不是删掉明细：`vitest.config.ts` 的 reporter 由
  `COMFYAPP_QUIET_COVERAGE` 切换 —— 默认 `["text", "json-summary", "lcov"]`（本地
  人手动跑时要看那张表），置位则 `["text-summary", "json-summary", "lcov"]`（只打
  总计）。**逐文件明细一份没少**：它本来就在 `json-summary` / `lcov` 里，那两份是
  落盘文件、不吃日志预算。实测同一子集：94.6KB → 58.8KB / 107.4KB → 71.6KB。
  判据 `tests/coverage-reporter-budget.test.ts`（三条：默认档不变、安静档明细不缺、
  安静档不是靠收窄用例面换来的）。
