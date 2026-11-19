## Changed

- **B5 子批 7：20 份 / 33 处 `typescript/no-unsafe-type-assertion` 清零**（判决面删掉这 20 份路径行）。
  本批是历史 / 首页 / hooks / 日志族：`src/components/studio/history/**`、`HomePage`、
  `src/components/studio/hooks/**`、`src/components/studio/logs/**`、`model-overview-derive`、
  `nav-items` 与 `project-canvas/CanvasContextMenu`。修法仍是「运行时校验 + 类型守卫」：
  - 日志面板的排序键 / 分类 / 来源过滤改本地谓词（`isSortKey`、`isKindKey` 用 `Object.hasOwn`、
    `isOriginFilter`、`isCategoryEnabled`），不再把字符串断言成联合类型。
  - 影视视图与节点身份改用 `isFilmView`、`isElementNode(node): node is Element`（`nodeType === 1`）收窄。
  - 工作流快照先落 `unknown`，经 `isPlainRecord` + `typeof` 逐字段取值；JSON 列同理。
  - 测试侧：`vi.fn<...>` 显式签名替代 `as Mock`；`Reflect.getPrototypeOf` 判空替代原型断言；
    `Reflect.deleteProperty` 构造缺字段行替代 `as never`；节点枚举用
    `Object.keys(NODE_META).filter((key): key is NodeKind => key in NODE_META)`。
- 语义未变：合法输入结果一致；对畸形载荷才按运行时校验回落。
- 台账：B5 行改「清账中（子批1–7：140 份 / 300 处已清）」。

Refs #3181
