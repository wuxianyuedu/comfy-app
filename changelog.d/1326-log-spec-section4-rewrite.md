## Changed

- **规范 §4 日志布局整章重写为「一次运行一包」**（ISSUE #1326 第 5 刀）：新目录树（`current/` `runs/` `exports/` `latest.txt`）、逐文件表全量改到 `log/current/<分区>/`，并新增 **§4.0「为什么是固定写点 + 一次一包」** —— 把七个决定与它们的理由摆在一处：`current/` 的路径为什么写死（进程只持一个句柄，搬目录 = 早期日志静默丢失）、目录名为什么不能带冒号（Windows 非法，带上就是归档静默失败而 `runs/` 空着）、崩溃为什么靠下次启动补做（`recoverStaleCurrent()` 必须在 `startRun()` **之前**）、每行为什么带 `[runId]` 前缀（跨运行分析不绑目录结构）、保留策略为什么是「20 次**或** 7 天」（两条通道各管一头）、`run.json` 为什么直接读 `.git/HEAD`（崩在 git 起不来时这条元信息最该有）、诊断包为什么落 `exports/` 而不落 `current/`（否则归档把它一趟趟搬进 `runs/`）。
- §4 的排障段新增**三条使用姿势**表：「看本次」直接读 `current/`、「复盘历史」进 `runs/`（字典序即时间序，`latest.txt` 是最近一次正常完成）并**先读 `run.json` 再读日志、「跨多次运行」`grep <runId>` 一把梭**；并写明崩溃包的判据（`run.json` 的 `crashed: true` / `exitCode: null` 由下次启动补做时写下）。
- 全仓文档里的日志路径字面量同步加 `current/`：`docs/standards/07-日志系统.md`、`docs/standards/12-代码组织与文件结构.md`、`docs/guide-executor-host.md`，以及 `docs/generated/**`（由 `pnpm doc:render` 重渲染）。
- 路径常量的**唯一事实来源**在 §4 里写清了是哪四份、各自管哪一侧，以及「由判据钉住彼此同形」—— 编排器刻意不引 `log-paths.ts`（纯 Node 宿主，见 §18.4 第三类），因此不是「一处定义」，而是「每侧一处、由判据对齐」。
