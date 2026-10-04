## Added

- **日志「一次运行一包」的地基：`scripts/launcher-core/run.mjs`**（ISSUE #1326 第 1 刀）。此前日志按子系统平铺在 `log/` 下、历史归档按年月堆进 `log/archive/<yyyy-MM>/`，「本次运行的日志在哪」要靠猜、「上一次为什么崩」要翻文件尾部去推断。现在有了 runId 与一次一包的落点：
  - `log/current/` 是**路径固定**的写点（进程只持有一个句柄，路径写死在布局常量里，不在代码里拼时间戳目录——否则日志库要重配、早期日志静默丢失）。
  - 退出时 `archiveCurrent()` 把 `current/` 整个**复制**到 `log/runs/<日期>_<时分秒>-<runId>/` 再清空内容（**目录本身保留**）。目录名不含冒号（Windows 非法字符，带上就是归档静默失败且 runs/ 空着）。
  - 正常结束的 `run.json` 补 `endedAt` / `durationMs` / `exitCode` / `crashed: false`；进程崩了来不及归档时由**下次启动**的 `recoverStaleCurrent()` 收走残留并标 `crashed: true` / `exitCode: null`，且**不覆盖** `latest.txt`（那一栏的语义是「最近一次正常完成的是哪一包」）。
  - `run.json` 记 runId / 启动时刻 / 应用版本 / 分支 / commit（直接读 `.git/HEAD`，**不 spawn git** —— 崩在 git 起不来时这条元信息最该有）/ 启动参数 / 各进程 pid / 退出码 / 耗时。
  - 保留策略写死：`runs/` 留最近 20 次**或** 7 天内（两条通道各管一头，只留一条时高频调试会挤掉一周前的现场、低频用户会一直攒）；超 32MB 的单包先压 zip 再删。清理异步、失败静默。
  - 一键诊断：`exportDiagnostics()` 把 `current/` + 最近 3 次 `runs/` 打成 `log/exports/diagnostics-<时间>-<runId>.zip`。落点在 `exports/` 而**不在** `current/` 下，否则下一次归档会把它一趟趟搬进 `runs/`，包越滚越大。
- `scripts/launcher-core/zip.mjs` 的能力**先留在 `run.mjs` 内**（`zipDirectory()`）：自己写 zip 写入器，deflate 走 `node:zlib`，零新依赖。不用系统 `zip` 是因为本机与 CI 容器都没有它，Windows 上只有 `tar.exe` —— 保留策略「压不了就整包删」恰恰在最需要它的机器上不生效，用户点「导出诊断包」那一下直接不可用。踩过的坑记在注释里：local/central 头的 `compress_size` 与 `uncompressed_size` 是**两个**字段，store 模式下恰好相等，只写一个会让带压缩的路径露馅（解压端报 Bad CRC-32）。

## Tests

- `tests/log-run-layout.test.ts`：16 例，钉死目录名无冒号且排序即时间序、归档后 `current/` 目录仍在、正常结束不留空包、崩溃标记与现场完整、崩溃补做不覆盖 `latest.txt`、保留策略两条通道各自的边界（用 `utimesSync` 把目录 mtime 对齐名字日期，否则 mtime 恒为「今天」、7 天窗口那条判据永远不会被判到）、zip 包能被系统解压工具读通（`python3 zipfile.testzip()`）、诊断包只带最近 3 次且暂存目录不留痕、`log/` 根目录跑完一轮恰好是 `current/ runs/ exports/ latest.txt`。

## Docs

- 规范 §4 的布局总表与迁移说明在**第 5 刀**重写；本刀只落地代码与用例，旧布局（`log/launcher/`、`log/archive/<yyyy-MM>/`）一字未动，两套并行。
