## Fixed

- comfy-cli 的临时工作流文件 `temp/comfy-cli/wf-*.json` 只写不删，长期运行磁盘无界增长（#4225）：生命周期收口到任务收口——executor-cli 的 `settle`（complete/fail/看门狗/进程退出的唯一汇聚点）删除本任务的临时文件（best-effort，Windows 句柄未放时残留交给兜底）；reaper 的 sweepOnce 每拍跑 `pruneTempWorkflowFiles` 按 mtime（1 小时余量）清崩溃孤儿。用例：prune 两态（超龄删/新文件与异名保留/目录不存在静默跳过）。
