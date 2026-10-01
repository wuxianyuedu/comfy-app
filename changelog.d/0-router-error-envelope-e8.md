## Fixed

- **一处门槛按实测下调并写明原因**：`material.ts` 的 `lines` 100 → 95。原因是把两处
  `throw new Error("Invalid storage path")` 拆成多行 `TRPCError` 之后，那两行不再被「条件行」
  顺带盖住 —— 它们**本来就是不可达的防御分支**（`scope` 过 `sanitizeScope` 的字符白名单、
  `folder` 是枚举，`folderDir` 的包含断言因此不可能失败，留它是给「以后有人放宽校验」兜底）。
  没有去 mock `folderDir` 把数字凑回 100：那等于测一个今天不存在的输入形状。
  同文件的 `statements` 90 → 95、`branches` 75 → 80 是顺带的实测收紧（净：一降两升）。

- **router 层的 19 处裸 `throw new Error` 全部改成带码的 `TRPCError`**（台账 E8）。
  tRPC 对非 `TRPCError` 的抛出按内部错误归码，于是「分类不合法」「项目没生产数据」「slug 重复」
  这些**本来就该是 4xx** 的分支，到调用方手里全是 `INTERNAL_SERVER_ERROR`：
  ① 台账 A2 / A3 / A12 那句「越权与不存在同形」在**状态码层根本没成立**（别人的行与不存在的行
  都回 500，看着一样纯属巧合，改任意一侧就分叉）；② 界面拿不到能分支的码，只能显示「出错了」
  （硬规则 4 的「用户可见出口」缺半句）；③ 一次正常点击进 `trpc_error` 警告日志，把业务分支当故障报。
  **逐处判意图，没有机械替换**（7 个文件 19 处）：不存在 / 别人的行 → `NOT_FOUND`
  （`project` 3、`task` 2、`generate` 1、`workflow-model.rename` 1、`run` 写回 1）；
  输入形状不合法 → `BAD_REQUEST`（`material` 6：分类不在枚举、文件名清洗后为空、路径越界）；
  名字撞车 → `CONFLICT`（`skill` 的 slug、`workflow-model` 的重命名目标）；
  前置数据没准备好 → `PRECONDITION_FAILED`（`run.start` 无生产数据、`generate` 空 `rawJson`）——
  这一类的文案是**下一步该做什么**，归到 404 就把可行动的提示判没了。
- `task.ts` 两处「码对、文案是英文」（`"Task not found"`）统一成中文，与同文件另两处一个写法。

## Added

- **防线是 lint，不是又一份 `check-*.cjs`**：`eslint.config.js` 给
  `src/server/api/routers/**/*.ts` 上 `no-restricted-syntax`，selector
  `ThrowStatement > NewExpression[callee.name!="TRPCError"]` —— 自定义错误名（`TypeError` 等）
  一样在拦，不只 `Error` 这一个词。B 组每次提交都跑、报错直接指到行号。
- **这条判据自己的用例** `tests/router-error-envelope.test.ts`（已进固定守护清单，12 → 13 份）判三层：
  ① 真扫源码、先过 `stripComments`，**存量为零**；② **扫描面非空**（路径写错时「零命中」
  长得就像「全都修好了」，这一条专防清单自己静默失效）；③ 把 selector 从配置源码里**取出来**
  交给 eslint 自带的 `Linter` 现跑两段片段：裸 `throw new Error` 与 `throw new TypeError` 报、
  `throw new TRPCError` 不报 —— ②③ 合起来才是「配置在跑」，只看配置文件里有没有那行字是假的。
- **`errorEnvelope()` 进 `tests/helpers/trpc.ts`**：把错误信封的**码与文案一起**取出来比较。
  同形那条口径必须两维都比 —— 只比消息时 500 与 404 可以同文案，判据就落空了。
- **两个 router 第一次有执行者**：`skill.test.ts` 8 条 + `workflow-model.test.ts` 11 条
  （三个码各不相同、幂等早退**不该抛错**、越权改不动别人的行、
  「改成别人已有的名字」应当放行 —— 唯一约束是 `(userId, name)` 而不是全局唯一）。
  台账 E3 的服务端集成覆盖从 **11/16 → 13/16**，剩 `custom-nodes`（tRPC 侧）、`user`、`post`。
  三个入口按实测进门槛：`generate.ts` 与 `workflow-model.ts` 满档、`skill.ts` 90/100/90/90。
- 原有五处用例（`material` / `project` / `task` / `generate` / `run`）从「比消息」升级成「比信封」；
  规范 §11.2.1 第七条补上落点与「配置写在 ≠ 配置在跑」这一对；TESTING.md 的覆盖数同步。
- **反向验证**：把任一码改回裸 `throw new Error` → lint 与用例双红（lint 那条实测会指到行号）；
  把 `errorEnvelope` 退化成正则比消息 → 「别人的行与不存在的行同形」那条红。

## 已知没在本批做的

- `run.ts` 的覆盖率不进门槛：它的分支大头在别线的工坊编排里，本批只动到错误信封，
  拿 88/77 替别人立规矩不如留给那条线。
- `workflow-detail.ts` / `workflow-mutations.ts` 的 `message: "Workflow not found"` 是**英文文案**
  （码已经对）—— 属另一条口径，记进台账没在本批动。
