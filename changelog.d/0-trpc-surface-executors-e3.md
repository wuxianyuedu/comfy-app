## Fixed

- **删除 3 个零执行者、零消费方的 tRPC 口**（`src/server/api/routers/{post,user,custom-nodes}.ts`
  与 `src/server/api/root.ts` 的三处挂载）。台账 E3 走到这里，最后一批「没有执行者的 router」
  不是被补成测试，而是**定性后删除** —— 给死口写用例等于把它焊死：
  · `customNode.list`：`nodes` 是写死的 `[]`。真正的 custom nodes manifest 读取在
  REST `/api/custom-nodes`（有实现、有判据），tRPC 这一个是假的；同一份数据两个门，
  而假的那个还顺手把 `getSettingsSync()` **整包**回给客户端（本机 ComfyUI 安装路径 +
  全部开关状态）。
  · `post.getLatest` / `post.create`：create-t3-app 的示例残留。源码注释写着
  「OWASP A01（越权访问）：列表与读取接口都要求已登录用户」，而 `loginRequired` 默认
  `false` ⇒ `authedProcedure` 回落演示用户 ⇒ 那句「要求登录」在默认配置下等于没写；
  `getLatest` 也没有 `createdById` 过滤，是跨用户读。仓库里没有任何调用方。
  · `user.me`：客户端取会话走的是 better-auth 的 `authClient`（`src/app/login/page.tsx`），
  这口从没有被调用过。
  `post` 表与 `postRepository` 留在原处：删表要迁移（动数据），不在本批擅自做。

## Added

- **「挂载即欠执行者」判据** `tests/trpc-surface-executors.test.ts`（已进
  `scripts/affected-tests.mjs` 的固定守护清单，13 → 14 份）：枚举 `appRouter` 的
  全部 procedure，要求**每一条**都出现在「import 了该 router 文件闭包」的测试里的调用形态。
  粒度必须是 procedure 而不是 router —— 本批复算时 `workflow.test.ts` 34 条用例在场，
  `workflow.detailFull` / `workflow.subgraph` 两条口仍然零执行者。三条配套：
  ① 沿 `routers/` 目录的 import 链算**文件闭包**（聚合 router 把 procedure 拆在兄弟文件里，
  只认挂载文件会把执行者判丢）；② 「文件提到过这个 router」不算，得出现调用形态；
  ③ 扫描面本身非空（空输入上「零违规」长得就像「都修好了」）+ 用合成的 `ghost.*`
  反证四种形态（没测试 / 只 import 不调用 / 调用但没 import / 齐备）。
  装机前做过一次真实反证：临时给 `skill.ts` 加一条 `gateProbe`，判据报出的正是
  `['skill.gateProbe']`。
- **`workflow.detailFull` / `workflow.subgraph` 的执行者**（5 条用例，台账 E3 的最后两个真空）：
  钉「他人的 id 与不存在的 id **逐字**同形」（不写「两次相等」—— 两次都成功时那句照样成立）、
  三种 `NOT_FOUND` 各有其形（没子图 / uid 对不上 / 工作流不存在，最后一种必须挡住跨用户探测）、
  以及 `bust` / `uid` / `hostId` 三个入参**真的转到了 lib**（`bust` 绕过服务端 30s 详情缓存、
  `hostId` 按宿主链还原子图里被拖动的坐标 —— 先钉住「缓存确实在」，否则「bust 生效」是空断言）。
  反向验证逐条做过：去掉 `findByIdForUserSelect` 的 userId 条件 → 两条归属用例红；
  `bust` 写成 `{}` → bust 用例红；`hostId` 写死 `""` → 子图坐标用例红。

## Changed

- 台账 E3 关闭，另立 **E3′**（13 条 procedure 有执行者、零消费方 —— 复算口径写在 E3 条里，
  判据等存量清零后再升）与 **E3″**（端到端仍只有 3 spec / 31 用例且无登录态）。
  F13 补一条同族新实例：`findByIdForUserSelect` 的第三参是 `_select`（**根本没被用**），
  实现走 `db.select()` 全列 —— 方法名承诺的投影是空气，后果是性能不是 500。
- `docs/standards/11-测试与可观测性.md` §11.2.1 的配套清单加到八条（挂载即欠执行者），
  `docs/guides/TESTING.md` 的 router 覆盖条目改成「已收口 + 判据落点」。
