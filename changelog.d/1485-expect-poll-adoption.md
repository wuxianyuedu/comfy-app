## Changed

- **「等异步落定」全面改用 vitest 5 的 `expect.poll`（ISSUE #1485，第一件）**：以 `expect.poll` 取代手搓 `while + setTimeout` 轮询、`vi.waitFor` 与「赌时间」的裸 `sleep` —— 差别不在能不能等到，而在**等不到时给出什么**：`expect.poll` 打出每次轮询的**实际值**与最后一次 diff，而手搓版本只留一句「超时」。
  - `src/lib/process/kill-process-tree.test.ts`：`waitFor()` 换成 `expect.poll`（失败时直接列出**还活着的 PID 清单**，这正是「孤儿没被收走」的现场）；11 处 400~700ms 裸 `sleep` 换成条件轮询（等它成为组长 / 等两个 `sleep` 挂上树 / 等目标退出），文件耗时从 ~3.5s 降到 0.5s —— **条件轮询通常比赌时间更快**，成立即返回。三处 detached 子进程的收尾改挂 `onTestFinished`，断言失败提前抛出时也照样回收，不在机器上留下跑一小时的 `sleep 300`。
  - `src/lib/console/console-run.test.ts`：`busy()` 那条从「睡 200ms 再赌它起来了」换成等 `busy()?.runId`；孙进程那条把两个手搓 `for` 轮询换成 `expect.poll`；三处 `await new Promise(r => setTimeout(r, N))` 清零。
  - `src/lib/async-pool.test.ts`、`src/lib/comfy/comfy-stats-store.test.ts`、`src/app/api/comfy/liveness/route.test.ts`、`src/components/workshop/CharacterDesigner.extract.test.tsx`：`vi.waitFor` 与裸 `sleep` 换成 `expect.poll`（回调计数、订阅者数量这类「等不到就说不清差在哪」的断言尤其受益）。
  - `vitest.config.ts` 新增 `expect: { poll: { timeout: 4000, interval: 50 } }` —— vitest 出厂的 1000ms 是给「内存里的状态翻转」定的，本仓库一大批轮询等的是**真进程动作**（`spawn` 落地、孙进程被 `taskkill` 收走），实测单次已越过 1s。口径与 `testTimeout` 一致：**是给真进程留的余量，不是给慢用例兜底** —— 走到超时说明被等的事根本没发生。
  - 规范 [11 §11.14](docs/standards/11-测试与可观测性.md#1114-等异步落定expectpoll-取代手搓轮询与裸-sleep) 落地口径（三写法对照表、默认预算的唯一落点、`onTestFinished` 收尾、纯延时仍然合法的那一类），并补齐 §11.9 快照形态的选择（大块人工 review 产物的落点是 `toMatchFileSnapshot`）。
