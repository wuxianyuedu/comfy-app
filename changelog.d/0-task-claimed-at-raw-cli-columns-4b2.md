## Added

- **`task` 表两列 + `progressNode` 一个键**（P3 §5 第 2 期 · Phase 4-B2，ADR §14 D1；配套 `pnpm db:push`）：
  - `claimedAt`：「这一行什么时候开始跑」。`claimNextQueued` 无条件覆写（一次领取就是新一轮的起点，崩溃后重领不该带上一轮的时刻）；`markRunning` 与首条进度帧走 `COALESCE` 定格（进度帧每几秒一发，跟着刷等于「已运行」永远接近零）。读侧对旧行（本列上线前的 RUNNING 行）退回 `createdAt` 近似。
  - `rawCli`：comfy-cli 的完整原始输出，由执行侧在成功 / 失败 / 取消三条收口各整包写一次。刻意不跟着日志的 200ms 防抖走——原文可以到几千行，跟着防抖重写等于白写几十遍。守卫形态与 `replaceLogs` 同族（只带归属、不带终态：被 kill 之后吐出的那几行正是「取消后发生了什么」的现场）。
  - `progressNode.classType`：与中文 `label` 并存（画布读 label、状态栏读类名），所以两处的可见形态都不变；comfy-cli 那条事件源拿不到 `class_type` 时两者都不带，退化成 null，与内存版旧行为一致。
- **`tests/test-db-schema-drift.test.ts`**：钉住「`src/server/db/schema.ts` 每张表的每一列都在 `tests/helpers/test-db.ts` 的手写 DDL 里」。动这一刀时漏改那份镜像，报错是 `SqliteError: table task has no column named rawCli`、栈指向 drizzle 的 insert，完全看不出真正要改的是测试基建——这条判据把那次定位时间买回来。它同时自证有效（一张表都没比对到就自己红）。`jsonColumns` 那一半本判据**盖不住**（缺失表现是读回来是字符串而不是对象），不硬造替代断言。
