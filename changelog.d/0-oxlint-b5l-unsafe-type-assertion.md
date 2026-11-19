## Changed

- **B5 子批 12：20 份 / 31 处 `typescript/no-unsafe-type-assertion` 清零**（判决面删掉这 20 份路径行）。
  本批横跨三块：workshop 生产与用例、`config/custom-nodes`、`lib/agent`，以及
  `ui/use-overlay-boundary` 用例。
  修法仍是「运行时校验 + 类型守卫」：
  - workshop 生产：选项 / 转场 / 运动 / 镜头尺寸等字面量联合改白名单 `find` 收窄
    （`TRANSITIONS` / `MOTIONS` / `PROJECT_TYPES` / `SHOT_TYPES` / `OUTPUT_OPTIONS`）；
    `use-llm-config` 新增 `isRemoteModelKind`（`REMOTE_MODEL_KINDS.some`）；
    `use-model-adapters` 的原始配置对象改 `isRecord` 逐层收窄。
  - `config/custom-nodes`：响应体新增 `isManifestPayload` / `isRawManifest`，非对象正文
    走既有「解析失败」档。
  - `lib/agent`：`agentic` 新增 `readAgentContent`（`isRecord` / `Array.isArray` / `typeof`
    逐层读 `choices[0].message.content`），`JSON.parse` 结果先收窄再交给 `normalizeSpec`；
    `client` 的响应条目改 `filter(isRecord) + typeof` 早退。
  - 测试侧：mock 改 `vi.fn<签名>()` 让 `calls` 自带类型；`JSON.parse` 结果 `isPlainRecord`
    + 字段 `typeof` 校验；DOM 元素 `instanceof HTMLElement`；舞台 id 用 `STAGE_IDS` 白名单
    + `Object.hasOwn` 谓词；全局删除改 `Reflect.deleteProperty`。
- 语义未变：合法输入结果一致；非法输入维持各自既有的回落 / 抛错行为。
- 台账：B5 行改「清账中（子批1–12：240 份 / 483 处已清）」。

Refs #3181
