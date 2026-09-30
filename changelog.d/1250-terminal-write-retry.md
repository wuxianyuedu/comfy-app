## Fixed

- **任务已经跑完，界面却永远停在「生成中」：终态那次库写失败此前只留一行 WARN**（ISSUE #1250，桌包 host 拓扑实测）。`fireAndForget(fail(…), e => cliWarn(…))` 把写失败咽掉后：既不重试，也没有任何一层接管 ⇒ 那一行永久停在 `RUNNING`，`pendingDispatch` 还占着槽位（并发上限 1）**把整条队列一起卡住**，回收器每 30s 数到它却只打一句 `checked`。用户在界面上只看到「一直在生成」，唯一出路是手动取消。
  - **原因先要看得见**：日志里此前只有 drizzle 的 `Failed query: update "task" set … params: …`，真正的原因（怀疑的 `SQLITE_BUSY`）挂在 `error.cause` 上被丢掉。新增纯叶子 `src/lib/sqlite-error.ts`：沿 cause 链取 `code` / `message` 拼回一句可读文本，并只把**锁族**（`SQLITE_BUSY` / `SQLITE_LOCKED` / `SQLITE_PROTOCOL`，以及只在消息里给 `database is locked` 的驱动版本）判成「等一等就有锁」。认不出原因就判不可重试 —— 宁可少试一次，也不把 `no such table` 这种真故障拖成四次同样的写入。
  - **重试预算与场景同形**（`retry-policy.ts` 里新增一条具名定义）：`TERMINAL_DB_WRITE` = 4 次写、指数退避基数 40ms / 封顶 300ms，累计只等 280ms。它不是 `WS_RECONNECT` 那一族：对手是**另一个进程的写锁**（桌包里内嵌 server 与执行宿主同开一份 WAL 库），锁通常几十毫秒就散；基数小、次数少，因为用户的界面正在等这个终态。
  - **穷尽之后不自杀也不新增状态：把本进程对这一行的足迹摘干净**。任何「往库里写一行让别的宿主接管」的信号在同一次故障里都不可靠（**写库正是失败的那件事**），而摘足迹是纯内存动作。回收器那句「本进程没有足迹 ⇒ 真孤儿」的判据读的是**四样**（`pendingDispatch` / comfy-cli 子进程 / `executedWorkflow` / `settled`），所以 `giveUp` 调 `forgetTaskClaimEntirely()` 一次清空，而不是只归还槽位：桌包实演先按「只归还槽位」落地过，结果那一行在 `RUNNING` 上停了 11 分钟、22 轮回收每轮只打一句 `checked` 空转 —— 因为 `fail()` 在终态写抛出后再没机会执行自己那几行 `delete`，`executedWorkflow` 还替它主张「本进程仍在执行」。顺序刻意是「先摘账 → 再留一行 error → 最后 kick 队列」：摘账放最前，保证即使那行日志也写不出去，接管条件已经成立。用例直接断言回收器那句判据本身（`isTaskClaimedInProcess(...)` 变 false），免得退化成「只断言槽位归还」那种看着绿、实则接管不了的旧错法。
  - 只把**状态那一次写**纳入预算（`finalizeSuccess` / `finalizeFailure`）：产物行与日志刷盘失败时行已经是 `SUCCEEDED`，属于另一种坏法（少几行产物），不在这条上。

## Changed

- **库级 PRAGMA 收成一份清单；等锁预算按它真正的形状给**（同条 #1250）。`journal_mode` / `foreign_keys` 此前在四处各写两行（`src/server/db.ts`、`src/server/workshop/db.ts`、`src/lib/comfyui/host-runtime.ts`、启动器侧 `scripts/launcher-core/standalone-runtime-env.mjs`），现在三处 TS 站点共用 `src/lib/sqlite-pragmas.ts` 那一份。
- **等锁预算不进那份清单，走 `createClient({ timeout })`**：清单里放一条 `PRAGMA busy_timeout` 看着像「四处都设了」，实测却只覆盖开机时借到的那**一条**连接 —— `@libsql/client` 的 `file:` 客户端是连接池，池上限 `Math.max(1, config.concurrency)` 在未配 `concurrency` 时是 `NaN`，也就是「永远没到上限」，池随时会新开一条没见过该 PRAGMA 的连接。量具（两个进程 + 真驱动，`tests/sqlite-pragma-sites.test.ts` 里钉成用例）：那种形状撞锁 **11ms** 就抛，而 `timeout` 选项**等到并写成功**。桌包实演读到的正是前者 —— 宿主的 4 次终态重试挤在 0.6 秒里跑完，每次都秒抛。
- **预算只给在执行宿主那一侧，250ms**：libsql 的语句执行是同步的，等锁多少毫秒、本进程事件循环就停摆多少毫秒（实测等锁 2.2 秒期间，10ms 心跳一次都没跳，本该 ~220 次）。宿主是为执行而生的进程，250ms 换「毫秒级瞬时锁不用重试」值得；Next 还要响应界面，那边保持秒抛 + 由 `TERMINAL_DB_WRITE` 的退避重试兜。启动器那侧（非 TS 宿主、`node:sqlite` 单连接）自己留了一条更长的 `busy_timeout = 2000`：首启建表撞上还在跑的宿主时「等一等」比「启动失败」好，而那一刻没有界面请求在等它。以上三条差异都由 `tests/sqlite-pragma-sites.test.ts` 逐处核对，不靠人记。

## Tests

- `src/lib/sqlite-error.test.ts`（8 条）：drizzle 包法的 cause 链取值、无 cause 与空消息的回落、自引用 cause 不成死循环、锁族 vs `no such table`。
- `src/lib/comfyui/executor-write-retry.test.ts`（4 条）：撞锁后重试成功（「重试中」只写一行、槽位仍归本进程）、穷尽时抛出带 `SQLITE_BUSY` 的错误 + 槽位归还 + 行日志一句 error、非锁族一次都不重试但仍归还槽位、一次就成不多写日志。
- `src/lib/retry-policy.test.ts` 加一条：`TERMINAL_DB_WRITE` 的 40/80/160 与累计 280ms、封顶不破。
- `tests/sqlite-pragma-sites.test.ts`（7 条）：清单只有两条库级 PRAGMA 且**不含** `busy_timeout`（防「四处都设了」重新变成假的）、三处 TS 站点只走清单（不再各写字面量）、预算只出现在宿主那一侧且走 `timeout` 选项、启动器那侧逐条同源 + 它自己那条 2000ms；另有两条**当场量出来**的行为用例 —— 同一个客户端开着读事务占住池里一条连接时，开机 PRAGMA 形状**秒抛**、`timeout` 形状**等到并写成功**，最后一条把「250ms < 一次真锁」钉住，说明穷尽路径是常备路径而不是纸面路径。

## Docs

- 规范 §5 排障表一行（症状 = 「桌包任务跑完了却一直显示生成中、队列也不再往前走」），§7.6 的宿主半边补一段「终态写失败不再被吞 + PRAGMA 同源」，`docs/guide-executor-host.md` 的崩溃恢复一节新增一条，ADR §20 记本刀的签字与落地。
