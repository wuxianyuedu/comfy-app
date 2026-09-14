## Fixed

- **进程树回收在「leader 不是组长」时静默留孤儿**（POSIX）：收口模块 `src/lib/kill-process-tree.ts` 原先按调用方传入的 `detached` 布尔值直接 `kill(-pid)`，隐含假设「spawn 出来的子进程就是组长」。经 `sh -c` / `pnpm exec` 两层中转后组长往往是更上层的 shell —— 实测 `pnpm dev` 真实进程树 `PID 2866 / PGID 2838`，`kill(-2866)` 抛 ESRCH 静默落回单杀，留下 5 个 PPID=1 的孤儿（继续占端口、锁日志），正是 AGENTS 硬规则 3 明令禁止的形态。改为**运行时读目标 PGID**（`ps -o pgid= -p <pid>`），组长归属由 OS 回答而非调用方猜。
- **进程树回收可能杀掉应用自己**（同源，防自杀判据）：bound 模式子进程是普通 `spawn`、**与调用者同进程组**，读到的 PGID 若不加判据就 `kill(-pgid)`，信号会打向调用者所在的整个进程组。现在目标 PGID 等于调用者自身 PGID 时禁止走组路径，只单杀 leader。实测该缺陷会让 vitest worker 被自己派发的信号 Killed。
- **POSIX 监听端口探测依赖 `lsof`，缺它时静默返回 null**：`src/lib/comfyui/proc-detect.ts` 的 `findPidListeningPort` 原先调用 `lsof -Pan -p <pid> -iTCP -sTCP:LISTEN`，而 `lsof` 在不少发行版（含 CI 精简镜像）默认不装，`execFile` 的 ENOENT 被吞成空串 → 返回 null，正是规范 §9.2 第 3 条禁止的「静默失败」；文档 §9.1 又声称「不依赖 lsof」，实现与文档互相打架。改为纯 Node 内建读 `/proc/net/tcp{,6}`（LISTEN 的 socket inode）∩ `/proc/<pid>/fd` 的 `socket:[…]`，零外部依赖。

## Added

- **进程树回收的真跑回归用例**：`src/lib/kill-process-tree.test.ts` 改为**真起多进程树、杀完数残留**，而不是断言 `via` 字符串（只查命令构造正是让「按 detached 猜组长」漏过去的原因）。覆盖 detached 组整树 0 残留、与调用者同组时禁走组路径（防自杀）、`detached` 标记与实际组不一致、单杀兜底、目标已退出的返回语义；后两类在旧实现下必然失败（反向验证锚点）。
- **端口探测的正反向用例**：新增 `src/lib/comfyui/proc-detect.test.ts`（`/proc/net/tcp` 解析含 IPv6 与脏输入、真起监听 socket 的 fd 交集、失败路径返回 null）。
- **四语言端口一致性共享校验向量**：新增 `tests/fixtures/app-port-vectors.json`，Node / PowerShell / Python / Rust 四侧读**同一份**并各自断言同一批 input→port。此前四侧各写各的固定断言，规范 §1.1 的「四侧一致」只是文档承诺、没有会失败的测试守着（实测 Rust 不做路径解析、Node/Python/PS 对相对路径拼 cwd，`rel/p` 四侧端口不同）。配套：Python 侧端口算法抽到可导入的 `scripts/app_port.py`（原先内联在只能 Windows 导入的 `start_tauri_launcher.py` 里，导致该约定无法在 Linux / CI 上验证）、新增三侧自检脚本 `scripts/check-app-port-vectors.{py,ps1,cjs}`，并接入 pre-commit（第 9 步）与 CI。
- **规范同步**：`docs/standards/launch-and-build.md` §3.1 补充「组长归属由 OS 回答」与防自杀判据、§9.1 的进程探测行改为如实描述 `/proc` 实现（去掉与代码不符的「配置端口试探」），并补两份回归测试的说明。

## Changed

- **`pnpm` dev 链路的文档口径**：`launch-and-build.md` §9.1 的进程探测行同步为 `/proc` 实现；其余不变。
