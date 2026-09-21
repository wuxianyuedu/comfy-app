## Fixed

- **`src/lib/workshop/generation-client.ts` 的 `postRelay` lazy typing**：
  原来返回 `Promise<unknown>`，三个 caller（`apiGenerateImage` /
  `apiSubmitVideo` / `apiPollVideo`）每个都自己写 `isRecord(data)` 前奏。
  中继服务协议本来就约定「`res.ok` 时 body 一定是 JSON 对象」，把这条判据
  收进 `postRelay` 一处，返回类型收成 `RelayResponse = Record<string, unknown> | null`
  （`null` = 非对象响应）；三个 caller 各自决定「拿到 null 时是抛错还是降级」
  （生图 / 提交视频抛、轮询返回 `{ pending: true }`），行为**完全不变**。

  报告里 M-1 列的另外三处 `Promise<unknown>`（`comfyui/client.getComfyQueue`、
  `comfyui/workflow-detail-combo.specForClassField`、
  `media/materials-client.postMaterial`）**保留原样**并说明为什么：
  · `getComfyQueue`：文件头注释已明确「`/queue` 条目形态随版本变、解析只
  写一处 `~/lib/comfyui/trace.queueTraceSummary`」——这里 `unknown` 是
  **故意**的 raw snapshot，把它类型化就会把内部解析形状泄漏到模块边界外，
  反而催生两处各解一遍。改成 `ComfyQueueSnapshot = unknown` 之类的别名
  只是把 `unknown` 换个名字，收益不抵成本。
  · `specForClassField`：私有 helper，返回 `[COMBO, { options: ... }, ...]`
  形态的 spec 元组，ComfyUI object_info 侧的形状本来就松散，唯一 caller
  `comboOptionsFromSpec` 自己 narrow。收成 typed tuple 需要引入 object_info
  全量类型，超出「网络出口类型收口」这一 PR 的范围。
  · `postMaterial`：私有 helper，只有一个 caller `uploadMaterialItem`；且
  服务端字段 `item.url` / `item.id` / `item.name` 都是**可选**（历史行里
  可能缺字段），caller 逐字段 narrow 与「类型化 postMaterial 但 caller
  仍要 narrow」等价，加类型只是把 `unknown` 变成 `Record<string, unknown>`
  而不带额外检查。留原状。

  本 PR 只对**真的**在 lazy 的 postRelay 动手术；把「lazy 与故意」的判据写清楚，
  下次同类问题不至于把设计意图一并抹掉。类型安全审查 src/lib 报告的 M-1 条目。
