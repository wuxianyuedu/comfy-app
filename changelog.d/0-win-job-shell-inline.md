## Fixed

- **Job Object 防孤儿安全网实际未生效 + 归属模型理顺**（Better Harness 第二轮评审 F1/F2）：#784 把启动器从 Python 移进壳自己后，`scripts/win_job.py`（Python/ctypes，把 job 句柄 `DuplicateHandle` 进**编排器**）成了架构错位的历史残留——① 它的 CLI 只认 `--selftest`，`python win_job.py <pid>` 空跑 `exit 0`；② 壳 `shell_launch.rs` 把它当 helper 调、见 exit-0 就 `return true` 短路掉了下面那份**本来正确**的内联 shell-held 实现 → 装了 python 的机器上 `KILL_ON_JOB_CLOSE` 根本没建，日志还谎报成功；③ 即便 CLI 修好，「句柄归编排器」模型在 #784「壳是顶」下也兜不住「壳被硬杀、node 还活着」（node 持句柄 → job 永不关闭）。
  - 修正：**删除 `scripts/win_job.py` 与 `attach_job_via_helper`**，让 `shell_launch::attach_kill_on_close_job` 的**内联 shell-held 实现**（用 `windows` crate，句柄存进 `JOB_HANDLE` 故意不关、壳死即 OS 关句柄触发整树回收）成为唯一出处——这才是 #784 架构下正确的归属模型。
  - 同步理顺注释与文档：`shell_launch.rs` 顶部/函数文档写明「句柄归壳」的理由与 win_job.py 已废弃；`launch-and-build.md` §3.2/§3.3 三处「经 win_job.py 唯一实现」改为「壳内联实现，唯一出处」；`README.md` 可选 Python 依赖去掉 Job Object（不再需要 python）。
  - 测试：`win-job.test.ts` 从守 win_job.py 改为静态守壳内联实现（CreateJobObjectW/AssignProcessToJobObject/JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE + 句柄归 JOB_HANDLE + win_job.py 已删）；`shell-self-launch.test.ts` 的 `join("scripts")` 计数 4→3（少一条脚本路径）。`cargo build --release --features custom-protocol` 通过。
