## Fixed

- **库写失败的日志只有 drizzle 的 `Failed query`，看不出原因是锁、是没表、还是连接坏了**（ISSUE #1262 的第一步）：#1250 把「终态那一次写」的原因落地之后，执行链上**其余**库写捕获点仍然是瞎的 —— 领取（`领取队列任务失败：Failed query: update "task" set "status" = ? …`）、排队期的等待提示写入、两条回收器 sweeper、续跑 kick、以及 comfy-cli 那七处「收口异常」。这不是洁癖：#1262 想答的问题正是「那次窗口散掉之后还写不进去，是谁扣着写锁」，而**当时能拿到的全部证据就是那一句**，三种成因（别人持锁 / 没有这张表 / 自己连接坏了）的处置完全相反，从这句文案里一条都分不出来。
  - 新增出口 `sqliteAwareErrorText(error, action, fallback)`（`src/lib/sqlite-error.ts`）：是库失败就输出 `动作：原句（SQLite: CODE / cause 消息）`；是库失败但 cause 链上一个码都没有，额外**明写**「原因未取到 —— cause 链里没有错误码」—— 空白会被读成「没有原因」，而真实情况是「原因在链路里丢了」，这两件事必须分开写；不是库失败就原样交回 `errorText`（网络层报错的翻译本领一条不丢）。参数与 `errorText(e, action, fallback)` **逐位同形**，所以 15 处调用点只是换个函数名，动作前缀与语义一字不改。
  - **没换**的那几处是刻意的：comfy-cli 启动失败（子进程 spawn）、ComfyUI 自动启动失败（生命周期）、就绪探测失败（网络）、中断请求失败（ComfyUI HTTP）—— 它们不是库写，换过去只是让通用文案多绕一圈。
  - 顺带修掉同一族的顺序缺陷：`describeSqliteWriteError` 原先把 `LOG_DETAIL_MAX` 整份预算给 drizzle 的 head，而 head 连着 `params:` —— 一次工作流校验失败会把整段模型清单塞进参数，dev 复演实测 **655 字**那一行里 `（SQLite: SQLITE_BUSY…）` 被挤成了省略号，「原因看得见」在长 head 下又失效。现在预算**先给原因、再给现场细节**（被截的一定是参数清单，不是错误码）。

## Tests

- `src/lib/sqlite-error.test.ts` +6 条：带码时同句里同时有动作前缀 / drizzle 原文 / 驱动码；没码时明说「原因未取到」；非库失败原样走 `errorText`；「没表」也算库失败（照样带原因）**但仍然判不可重试**（可见性与重试判定是两条判据，别因为前者把后者放宽）；head 再长也不许挤掉原因；抛值是 `string` / `null` / `undefined` 都不炸。
- `src/lib/comfyui/executor-dispatch.test.ts` +1 条：**直接断言那句 `logger.warn` 本身**带着 `SQLITE_BUSY` 与 `database is locked` —— 旧实现下这条必红（它只打 `Failed query` 头部），这才叫把可见性钉住而不是写着玩。

## Docs

- 规范 §5 那条排障行的自查顺序补一句「所有库写捕获点现在都自带 `（SQLite: …）`」；`docs/guide-executor-host.md` 的崩溃恢复一节同步；ADR **§21** 记这一刀（为什么先做可见性、复现两轮的读数、以及 #1262 剩下的那道问题现在需要什么证据才能答）。
