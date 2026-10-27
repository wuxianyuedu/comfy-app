## Changed

- **工坊 `Character` / `Shot` 类型改为由写侧 schema 派生**（ISSUE #2499）：
  `src/lib/workshop/types.ts` 里原先 interface（`Character` / `CharacterPortrait` / `Shot`）
  与 `characterInputSchema` / `shotInputSchema` 是**两份互不引用的声明**，加一个字段改哪一边
  都不会让另一边红，而它们喂的是同一条草稿（MCP 写入 / 画布 / 仓储 / 草稿镜像）。

  - **先把可选性对齐到 schema**：`characterPortraitInputSchema.createdAt` 的默认值从外层
    `.transform` 下沉进 schema 本身（`.default(() => Date.now())`）；外层只补
    `positivePrompt` / `negativePrompt`。`optionalEnum` 的 `.optional()` 移到 `.transform`
    **外面** —— 输出侧才是「键可选」，而不是「必带这个键、值可为 undefined」。
  - **再换派生**：`Character` / `CharacterPortrait` / `Shot` 由 `z.output<typeof …>` 派生，
    schema 成为唯一事实（字段语义的注释也随之下沉到 schema）。
  - `tests/workshop-input-schema-derivation.test.ts` 判两件事：① 同一枚最小合法输入过
    schema 后，「缺省补值」与「键不出现」的语义逐条不变；② 可选键在派生类型里必须可选
    （`expectTypeOf`，借 `tsc` 执行），并守住 MCP 入参面 `createdAt` 仍是可选字段。
  - 修前干跑把三份 interface 换成派生时报 **25 处 tsc 错、散在 17 份文件**；对齐后
    `tsc --noEmit` 归零 —— 没有用「改 17 份文件的签名」去换一条本来就该改的默认值语义。
  - `parseDraftDto`（`draft-sync-shared.ts`）不动：元素原样保留 + 整份草稿标成不完整是既定口径。
