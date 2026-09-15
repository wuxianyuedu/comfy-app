## Changed

- **启动编排全平台合并为一份实现，Windows 不再独立一条链（ISSUE #489）**：
  `scripts/dev-launcher.mjs` 现在是**唯一**的编排者（预检 / 端口 / `.next` 缓存指纹 /
  拉起 / 就绪等待 / 进度快照 / 收尾定性），Windows 也走它。`scripts/dev-launcher.ps1`
  只保留「定位项目根 → 调用它 → 透传退出码」，不再自己拼任何平台命令；平台机制收在
  `scripts/launcher-core/**`（进程与端口探测、进程组拉起、可执行名解析）与
  `src/lib/kill-process-tree.ts`。旧实现保留为 `scripts/dev-launcher.legacy.ps1` 作对照。
  这么改的动因是实测出的平台间不一致：两条链各自演进，Windows 侧落到 Next 的端口探测、
  端口占用回收、就绪等待与收尾命名的口径都与 POSIX 侧不同，而「记得同步另一侧」全靠自觉。

## Added

- **「杀整棵树」的可验证性（ISSUE #489）**：`killProcessTreeWith()` 把平台变成可注入
  参数，于是 Windows 分支在 Linux CI 上也能**真跑** —— 测试注入一个同名的假
  `taskkill`，断言 `/PID <pid> /T /F`、`/IM <name> /T /F` 真的被调起（此前只断言
  「命令字符串长什么样」，连命令有没有发出去都答不了）。新增
  `src/lib/kill-process-tree.windows.test.ts`。
- **统一的进程树回收入口 `scripts/reap-process.mjs`**：供非 TS 宿主调用（Rust 壳退出、
  Python 启动器的兜底补刀、构建脚本的残留壳清理）。Rust 里再写一套 `taskkill` 分支就是
  「各写各的、POSIX 上退化成单杀」那条老路的翻版，因此 `kill_sidecar` 除插件的
  `kill()` 之外再经它补一刀 —— Node 之下的 next-server / turbopack worker 才是真正会
  残留成孤儿的那几层。
- **端口占用的归属判据**（多检出并行保护）：只回收**工作目录落在本检出内**的残留实例，
  其余一律只给「改 `.env` 的 COMFYAPP_PORT」这类可行动提示，绝不猜着杀。

## Fixed

- **Windows 侧 dev server 端口口径与文档/壳不一致**：`.ps1` 就绪探测打的是
  `http://127.0.0.1:<port>` 根路径，存在返回非 200 的合法就绪状态（如数据库表未建时
  `/` 之外的实时健康检查与壳的探测口径不同）；现统一为编排器的
  `waitForReady()`（探测 `/api/health`，有界重试），Windows 与 Linux / macOS 同一条路径。
- **`.ps1` 入口与项目根判据绑在 Windows 入口文件上**：`entry-common.ps1` /
  `start_tauri_launcher.py` / Rust 的 `looks_like_project_root()` 此前都认
  `scripts/dev-launcher.ps1`。判据绑在**入口形态**上，换入口就会再静默失效一次（本仓库
  已栽过一回：POSIX 上 `resolve_project_root()` 恒返回空串、启动页一直转圈）；现统一认
  编排器的唯一实现 `scripts/dev-launcher.mjs`。
- **Python 启动器与壳的回收动作各写一套平台分支**：`_kill_shell_from_pid_file` 的
  `taskkill /PID /T /F` 与 `app_window_process_name()` 里写死的 `app.exe` 都改为共用
  同一判据（前者转交 `scripts/reap-process.mjs`，后者按平台给名字），避免「同一件
  事在不同宿主里各写一遍后静默漂移」。
