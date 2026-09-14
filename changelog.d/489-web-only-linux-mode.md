## Fixed

- **`pnpm dev` 在 Linux 上跑在 3000 端口，与端口契约不一致（Linux 上「服务起来了但连不上」的直接来源）**：`package.json` 的 `dev` 是裸 `next dev --turbo`，绕开了 `scripts/dev.mjs` 的端口解析（文档 §1.1 一直写着「统一经 dev.mjs」，实际只有 tauri 的 `beforeDevCommand` 走那条路）。而 `.env` / 路径推导 / Playwright / 启动器全都按解析出的端口（缺省 3200~3999 区间）找服务，两边不一致就是连不上。现改为 `node scripts/dev.mjs`，与 `pnpm start` 对称；`dev.mjs` 同时支持 `-p` / `-H` 透传，Windows 启动器 `pnpm dev -p <port> -H 127.0.0.1` 的行为不变。

- **端口推导的路径规范化在 POSIX 上失真，同一检出会推出不同端口**：`normalizeRootForPort` 用 `path.resolve()`，而它的语义是「相对当前工作目录解析」——Linux 上 `path.resolve("F:\AI\Other\x")` 得到 `/workspace/f:/ai/other/x`，于是 `tests/app-port.test.ts` 两个用例在 Linux 直接失败（3305 → 3962），更要紧的是「同一检出恒定同端口」这条多检出并行的前提在 POSIX 上不成立。现改为**只对相对路径做 resolve**（绝对路径原样处理，含 Windows 盘符与 UNC 的显式判据），并去尾斜杠；Node / PowerShell / Python 三侧实现同步，Rust 侧补尾斜杠归一与回归用例。

- **ComfyUI 解释器发现在 Linux 上完全失效（标准 venv 安装被判「找不到可用的 python.exe」）**：`launch-path.ts` 只认 `python.exe` / `Scripts/`，一个 `bin/python` 候选都没有；`envHasTorch` 也只看 `Lib/site-packages`，不认 `lib/python3.x/site-packages`。实测：造一个标准 Linux venv 安装（`.venv/bin/python` + `lib/python3.12/site-packages/torch`）会直接落到错误分支。现已支持 `bin/python3` / `bin/python` + `lib/python3.x/site-packages`（版本目录用有限候选探测，不做目录枚举——避免破坏本模块「注入 exists 的纯函数」可测性，也避免 Turbopack 退化成全项目追踪），Windows 与 Desktop 布局的既有优先级不变。

- **POSIX 关闭服务只单杀 leader，子进程残留成孤儿（AGENTS 硬规则 3 明令禁止）**：`comfyui/lifecycle.ts`、`drizzle-studio/lifecycle.ts` 的 POSIX 分支只 `child.kill("SIGTERM")`，实测给一个含 3 个子进程的 shell 发 SIGTERM 后 3 个子进程全部残留（PPID=1，锁端口锁日志）。新增 `src/lib/kill-process-tree.ts` 作为进程树回收的唯一入口：Windows 仍 `taskkill /PID <pid> /T /F`，POSIX 向**进程组**发信号（`kill(-pid)`，拿不到组时单杀兜底），平台判据收在一处，调用方不再各自摸 `process.platform`。
