## Fixed

- **设置页两条轮询用例改成「一个用例一把时钟」**（规范 11 §11.14 新增那条口径）：
  `src/app/(main)/settings/hooks/use-settings-page.test.ts` 里「Ollama 探测失败 → down；启动后
  轮询到就绪才恢复 up」与「启动轮询期间状态行停在 starting」从前是**同一只用例挂着两种时钟** ——
  先用真实时钟 `expect.poll` 等首探落定，再 `vi.useFakeTimers()` 推进轮询。现在改成挂载之前就换时钟，
  整条链在假时钟上跑到落定。
- 实测对照（16 核机器 + 24 个忙等进程，同一条命令各取 3 个样本，只记这两条的墙钟耗时）：
  旧形状 **1301 / 2419 / 3895ms**（同一形状自己就差 3 倍，说明它等的是墙钟），
  一把时钟之后 **568 / 768 / 769ms**。值得改的理由：`testTimeout: 30_000` 有上界，而负载塞给
  它的时间没有 —— 一旦越过，被抛下的 continuation 会落进**下一条**用例的假时钟窗口，症状成对出现：
  先 `Test timed out in 30000ms`，再 `Timer APIs are not mocked`。
- ⚠️ **这不是「修好了那条负载红」**：现树上用 8 份并发整文件、24 个忙等进程都复现不出红。
  当年的载体是设置页挂着的 `/api/comfy/state` **长轮询**（一轮 204 应答再排一轮请求 ⇒ 假时钟一推进
  就要抽干一条无界的定时器链），ISSUE #1900 把运行态整块搬去侧栏「ComfyUI」页之后，那条链已经不
  在这个 hook 的挂载路径上。这一改买的是**墙钟依赖归零**。
- **存量按量、再逐处对账**：含 `vi.useFakeTimers()` 的用例文件 21 份，粗数「同一 `it` 里先挂载
  后换时钟」得 5 处，人工读过之后 **2 处是量具跨 `describe` 边界的假阳性**
  （`use-throttled-progress.test.tsx` 那两处 —— 假时钟开在**下一个 `describe` 的 `beforeEach`**
  里，与前面那次挂载不在同一段代码路径上），真正的同用例混时钟是 **3 处**。本刀改掉设置页那 2 处；
  剩下 1 处（`use-workshop-pipeline-recovery.test.ts` 的 SSE 安全阀用例）**不动**，理由也是读出来的：
  它挂载之后用 `await act(async () => { await Promise.resolve(); })` 走 microtask 落定，
  没有任何墙钟等待，且注释写明了为什么在那里开假时钟。
