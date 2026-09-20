## Fixed

- **桌面应用启动器崩溃 / 被硬杀后，dev server 进程树残留成孤儿、锁住 `start-tauri\_internal\*.dll`，导致 `build-all` / 打包启动器前置检查报「产物目录被占用」**：此前「Windows Job Object」在本仓库是**幽灵功能**——`docs/standards/launch-and-build.md` §3.3 把不存在的 `launcher-core/job-object.mjs` 列为平台机制模块、启动进度条有「创建 Windows Job Object」一步，但全仓库 `CreateJobObject` / `AssignProcessToJobObject` / `KILL_ON_JOB_CLOSE` 零命中，实现为空。启动器（`start_tauri_launcher.py`）只用 `DETACHED_PROCESS` 保证「交班退出后 app 继续存活」，却没有覆盖「编排器 node 自己死了」这条路——它拉起的 `node → pnpm → next → 桌面壳` 因此残留，而 `build-launcher.ps1` 的前置检查（`Build-Guard.ps1`）只检测、打印占用者让用户手动 `taskkill`，不自动回收。
  - 新增 `scripts/win_job.py`：用 ctypes 建一个 `KILL_ON_JOB_CLOSE` 的 Job Object，**先 `DuplicateHandle` 把 job 句柄复制进编排器进程、后 `AssignProcessToJobObject`**（顺序保证：assign 成功而复制失败时不会让 job 只剩启动器一个句柄持有者、进而在启动器退出时误杀刚起来的 app）。启动器交班退出 → 自己那份句柄关闭，但编排器持有的那份让 job 续命；编排器一死 → 最后一个句柄关闭 → OS 当场终止整棵 job（连带 pnpm/next/壳），杜绝孤儿。纯 Node 无原生 job API，故实现在启动器（Python）侧。
  - `start_tauri_launcher.py` 在拉起编排器后 best-effort 挂载该 job：任何失败（非 Windows / API 不可用 / 权限不足）只记日志、退回现有回收路径，不拖垮启动。
  - 修 `launch-and-build.md` §3.3 幽灵引用：平台机制层不再列 `job-object.mjs`，改为说明 Windows Job Object 归启动器侧 `scripts/win_job.py`、POSIX 靠 session + 心跳 + 杀进程组兜底。
  - 回归护栏 `tests/win-job.test.ts`：钉死 Win32 常量、DuplicateHandle-before-Assign 的安全顺序、启动器 best-effort 挂载，并在 Windows 上真跑一次 ctypes 接线自检。**需真机验证**：双击 `start-tauri.exe` 起应用后强杀编排器进程，确认 `node/pnpm/next` 整树被 OS 回收、`start-tauri\` 目录可删。
