## Fixed

- **`train.cancel` 从 Prisma→Drizzle 迁移起每次都 500（本刀照出并修）**。路由调用仓储时留的是
  Prisma 那套布尔投影 `{ id: true, status: true }`，而迁移后的签名写成 `select?: unknown`、
  交给 Drizzle 时是 `db.select(select as never)` —— 形状不匹配 **tsc 一声不响**，运行时生成的是
  空投影 → SQLite 语法错（`near "from": syntax error`）。于是「取消训练」这个按钮自那次迁移
  就没有成功过一次，而这条 router 没有执行者，所以没有任何一条红过。
  两处一起动：调用点去掉投影（这一支只需要「存在 + id」，`status` 根本没被读）；
  仓储签名收紧成 `Record<string, AnySQLiteColumn>`，把这一类形状错误交还给编译器。
  同类写法全仓已扫过：`select as never` / `select?: unknown` 现在为零，
  剩下的问句记进台账 F13（`unknown` + `as never` 咽掉形状错误这一族没有专门判据）。
- **`film` / `train` 的「查不到」从裸 Error 改成 `NOT_FOUND`**（6 处）。
  `throw new Error("Film not found")` 会被 tRPC 归成 `INTERNAL_SERVER_ERROR`，表现是三件事同时坏：
  客户端拿不到能分支的错误码（只能显示「出错了」）、服务端把一次正常点击报成故障
  （污染错误率与 Sentry）、而台账 A2 / A3 / A12 定的**「越权与不存在同形」**在状态码这一层
  根本没成立 —— 别人的资源回 500、不存在的回 500，看起来一样纯属巧合，改成任意一侧都会分叉。
  现在四处（`film.detail/cancel/start/compose`）与两处（`train.detail/cancel`）统一
  `TRPCError NOT_FOUND` + 中文文案。
  ⚠️ **同族没在这一刀里清完，也不该在这里机械清完**：`grep -rn "throw new Error(" src/server/api/routers/*.ts`
  还剩 **19 处**（`material` 7 / `project` 3 / `task` 2 / `run` 2 / `generate` 2 /
  `workflow-model` 2 / `skill` 1），而这些分支的意图各不相同 —— 「slug 已存在」该是 CONFLICT、
  「分类不在枚举里」该是 BAD_REQUEST、「那一行不存在」才是 NOT_FOUND。已开台账 **E8** 逐处判意图，
  并要求每改一处**同批**把错误码写进用例 —— ⑨ 第一刀的 `material` 用例对「库里没有这一行」判了
  `code: NOT_FOUND`，对「分类不在枚举里」却只写 `rejects.toThrow("Invalid folder")`：
  消息判到了、码没判，而那几处实现正是裸 Error。覆盖率满档不等于每个维度都被判过。

## Added

- **52 条 router 闸门判据，四个入口各一套**：`film.test.ts` 14 / `train.test.ts` 12 /
  `model.test.ts` 9 / `llm.test.ts` 17。按闸门组织，不按 procedure 顺序铺：
  - **归属** —— 别人的 id 与不存在同形（`film` 四口、`train` 两口、`model` 的写侧只动自己那行：
    禁用一个目录不会把别人的同名配置删掉）；
  - **拒绝发生在副作用之前** —— 被闸门挡下时编排层与写库一次都没被调用
    （`startFilm` / `composeFilm` / `markCancelled` / `enqueueTraining` / `upsertSingleton` /
    `replaceAll` 全都记账断言）；
  - **地址与枚举闸** —— `baseUrl` 只许 http/https（`javascript:` / `file:` / `http://` /
    非 URL 四种形状各挡一次，且大写协议与回环地址必须放行，别把合法值误拒成「保存不了」）；
    `provider` / `taskType` / `role` 越界即 400，不再静默按 local 误路由；
  - **数值闸** —— `train` 的 steps / resolution / learningRate 上下限；
  - **候选清单的三态** —— 没给 `extraModels` 时必须是 `undefined` 一路透传，路由层一旦折成
    空数组就等于替用户清空全部远端模型（与 A11 同族的数据丢失形态）。
- **四个 router 按实测满档进覆盖率门槛**（§18.6，均 100/100/100/100）。台账 E3 的服务端集成
  覆盖从 **7/16 → 11/16**，剩 5 个（`custom-nodes` tRPC 侧、`user`、`skill`、`post`、
  `workflowModel`）。
- **反向验证七处，每处只红该管的那几条**：`film` 的归属查询退回 `findById` → 恰好 2 条红；
  `film` 的错误退回裸 Error → 恰好 4 条红（这就是修前实测到的那一幕）；`train.cancel` 摘掉归属
  判定 → 2 条红；`resolution` 上限放开 → 1 条红；`model` 写侧把会话用户写死 → 1 条红；
  `llm.baseUrl` 退回旧的 `z.string().url()` → 1 条红；`extraModels` 折成空数组 → 1 条红。
- 规范 §11.13 那条「第三类红」（#1306 落的 8 进程抢锁量具）**补上基线复算与判红三步口径**：
  同一份量具代码（两侧 `git diff` 对它与其输入为空），在主检出上隔离跑 2/2 绿、
  在 `git worktree add` 出来的干净 master 基线上隔离跑 2/2 红 —— 失效的是**前提对调度/目录的敏感**，
  不是预算。所以撞到它时第一步是「worktree 里单跑那一份文件」（不必先跑全量），
  基线也红就是别线的红：不为它放宽判据，也不照旧句子把它归给满载。
