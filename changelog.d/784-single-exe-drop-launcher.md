## Removed

- **`start-tauri.exe` 去掉，统一用 `app.exe`**（ISSUE #784 第二轮）：Python 启动器
  （`scripts/start_tauri_launcher.py`）、它的 PyInstaller spec（`tools/start-tauri.spec`）
  与三条打包脚本（`tools/build/build-launcher*.ps1`、`tools/scripts/build-launcher*.ps1`）
  全部删除。从此**只有一个 exe**：`src-tauri\target\release\app.exe`，双击它就是完整的
  启动形态（编排由壳自己承担，见下）。删掉这一层的原因不是「少一个文件」，而是它带来
  的一整类问题：任务栏两个图标、「关掉它的窗口并不让它退出」、产物目录（onedir）被它
  自己锁住导致构建报一句指不出占用者的错。

## Changed

- **壳接住原先由启动器承担的三件事**（`src-tauri/src/shell_launch.rs`）：
  ① **运行模式** `COMFYAPP_LAUNCH_MODE` 由壳按「检出里有没有 `scripts/dev-launcher.mjs`」
  自己决定（有 → prebuilt 走 dev server；没有 → standalone 走内嵌 server），判据放在
  **内容**上而不是 exe 名字上 —— 用户手里只有一个 `app.exe`，按名字猜会把两种形态都判错；
  ② **失败出口**：起不来时写 `run/launch-status.json`（`phase=error` + 可行动作），启动页
  显示原因，编排器的输出原样转发成 `[orchestrator] …` 进壳日志 —— 不再依赖第二个进程弹系统对话框；
  ③ **上一次的残留编排器**：起新编排之前先按环境块标记把它认出来并回收（壳被硬杀时 job 与
  进程组都可能落空，它会原地留着占端口，表现是「双击没反应」）。
- **认亲判据从此只服务「回收残留」**：`COMFYAPP_SHELL_OWNED=1` 保留（历史残留仍带着它），
  但「同行者/让位」那一半随启动器一起消失；两个 `app.exe` 的竞态由壳自己的单实例判定兜住。
- **自编排的触发判据换成 `COMFYAPP_PROJECT_ROOT` 缺席**：`COMFYAPP_LAUNCH_MODE` 现在由壳
  自己写，拿它当判据会随写入顺序漂；`COMFYAPP_PROJECT_ROOT` 只在「壳自己从 exe 位置推导出
  项目根」时缺席，那正是双击。
- **双击启动仍然不抢前台**：`decide_front_when_self_launched` 改为 `false`（原先为 true）。
  启动要几十秒，用户常已切去别处，几十秒后把前台抢走就是当场打断。「再双击一次 =
  唤起已运行实例」是另一条通道（单实例焦点事件，明确给前台），不受影响。
- **纯 Win32 启动画面那份重复实现消失**：启动期画面现在只有壳内嵌的启动页一处
  （原先启动器还自绘了一个置顶弹窗）。
- **`tools/build/build-all.ps1` 只剩一步**：构建 release 壳 —— 它**就是**可双击的入口，
  原先的「第二步：打包 start-tauri.exe」不复存在。
- **`tests/win-job.test.ts` 改为真断言「壳经 `scripts/win_job.py` 挂 Job Object」**：
  Job Object 的实现仍只有一处（Python/ctypes），但调用方从启动器换成壳，且通过可执行的
  调用点验证（原先断言的 `start_tauri_launcher.py` 已不存在）。
