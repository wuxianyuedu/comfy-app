## Fixed

- **修正 §11.14 那张三写法对照表里的一条错结论（ISSUE #1485）**：原表把 `vi.waitFor(() => expect(x).toBe(y))` 的报错写成「断言一直不成立，超时了（拿不到最后一次的实际值）」—— **这条是错的**。vitest 5.0.3 实测两者同档：`vi.waitFor` 同样会打出最后一次尝试的实际值与 `toEqual` 的逐项 diff，差别只在 `expect.poll` 多一个 `message` 标签。凭这条错结论去改用例，等于为一个不存在的收益铺开改动面。
  - `docs/standards/11-测试与可观测性.md` §11.14 重写对照表：三层差别分开 —— ①`sleep` 是真正的反模式（不判条件、条件成立也等满）；②本仓库选 `expect.poll` 的理由是**预算的落点**（吃 `vitest.config.ts` 一处默认，`vi.waitFor` 只认自己写死的 1000ms），不是报错；③`message` 标签与回调的 `AbortSignal`。
  - 同节补「什么时候仍然该用 `vi.waitFor`」：需要在重试里**做事**（多步准备、回调 `return`、依赖它自动 `advanceTimersByTime` 的假定时器集成）时，它仍是对的工具。
  - 同节末尾附**实测手法**（两段可直接粘的对照代码 + vitest 5.0.3 的输出原文）：改这类「谁报错更好」的口径前先复现，别照抄结论。

## Changed

- **收掉 §11.14 口径下漏掉的最后 8 处 `vi.waitFor`（ISSUE #1485）**：`src/server/film/orchestrator.test.ts`（4 处等 mock 调用）、`src/lib/comfy/comfy-stats-store.test.ts`（3 处）、`src/lib/process/kill-process-tree.windows.test.ts`（1 处）。理由按修正后的口径写 —— 让这批轮询也吃到 `vitest.config.ts` 的 4s 真进程预算（原来是 `vi.waitFor` 写死的 1000ms），并给每条补 `message` 标签，红的时候先读得到「什么没落定」。全仓 `vi.waitFor` 调用点清零（仅剩一处解释性注释）。
