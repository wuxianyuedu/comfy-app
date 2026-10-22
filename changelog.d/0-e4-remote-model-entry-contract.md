## Added

- **台账 E4 的第五格配上判据：远端模型条目的键名分叉与两份 `kind` 枚举**
  （`tests/remote-model-entry-wire-contract.test.ts`，5 条）。它走的是真端到端而不是对照表：
  **未判过的**弹窗表单状态 → 真桥 `remoteModelEntryFromDraft` → 真 `llmRouter.configSave`
  → 真仓储落库 → 真 `getConfigForClient` 脱敏回读，逐字段比。四格读数：条目原样回读得到
  （含三个收空）/ `REMOTE_MODEL_KINDS` 里每一个用途都存得进去 / 键名漂移那一形
  （写 `model`、不写 `name`）被拒**且库里零行** / `hasApiKey` 带着回写不会凭空长出密钥。
  变异两刀打在不同的半边：桥不再收 `model` 两侧的空 → 只有第一格红
  （`expected ' gpt-x ' to be 'gpt-x'`）；把服务端那份词表抄窄成 `chat|image` → 第二格红
  并带着 zod 那句 `Invalid option`，其余三格照绿。
- **「两份枚举」订正成「五份同词表」，本批收掉这条通路上的两份**：`configSave` 的入参
  不再自己写 `z.enum(["chat","image","video"])`，改吃 `~/lib/llm/remote-model-schema` 导出的
  `remoteModelEntrySchema`（`kind` 由 `z.enum(REMOTE_MODEL_KINDS)` 派生）；工坊下拉里那条
  内联白名单（它同时是 `normalizeExtraModels` 内层的重抄）改吃同一个常量。
  另外三份**刻意没动** —— `UsageTestKind`、`usage-field-editor` 的状态类型与 lib 里那份常量
  答的是「实际使用测试能调哪几种」，与「一条远端模型可以标成哪几种」是两个概念，
  合并要先对概念，不是消重（已登进台账 E4 的「还留着」）。
- **`model` ↔ `name` 那一跳从两遍收成一座桥**：过去 `submitDialog()` 的新增与编辑两支各写
  一遍 `name: addForm.model`，而 `ModelDialogForm` 是一份与字段级 schema 同形却互不引用的
  interface，controller 的入参形状又是第三次抄。现在 `RemoteModelDraftEntry` 是桥的唯一输出
  形状，弹窗状态与 controller 签名都从它派生；空白接口在两支上折成同一档
  （`null` —— 写入侧本来就都落「跟随已保存的全局配置」，过去一边 `undefined` 一边 `null` 只是写法不同），
  空白密钥仍是「不给意见」（`undefined`，不能折成 `null`，台账 A11 那套三态口径一字未改）。
  编辑侧的 `clearApiKey` 留在调用点：那是勾选框的意图，不是草稿字段能算出来的事。
