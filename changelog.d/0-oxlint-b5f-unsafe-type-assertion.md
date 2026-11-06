## Changed

- **B5 子批 6：20 份 / 32 处 `typescript/no-unsafe-type-assertion` 清零**（判决面删掉这 20 份路径行）。
  本批是画布/设置/历史族：`src/components/studio/canvas/**`、`src/components/settings/**`、
  `src/components/studio/history/**`、`AppShell` 与 `FilmStudioPropertyPanel`。修法仍是
  「运行时校验 + 类型守卫」：
  - `JSON.parse` 结果先落 `unknown`，经 `isPlainRecord` 后逐字段用 `numberOr` / `booleanOr`
    等本地谓词取值；`Object.keys(...)` 改用 `isCanvasSettingsKey` 谓词，不再断言。
  - 端口表 / 节点数据读取改用 `isRecord` + `typeof` 逐层收窄；`WorkflowNodeData` 自带索引签名
    的地方直接按真实类型读写，删掉多余断言。
  - `filter` 改类型谓词（`widget is PowerLoraWidget`）；`"comboOptions" in inp` 做属性收窄。
  - 事件对象用 `instanceof HTMLElement` 收窄；`use-section-scroll-spy` 的集合按真实
    `Element` 身份进出，不再断言。
  - 测试侧：假观察器补齐 `scrollMargin`；`Position` 用库枚举 `Position.Right` / `Position.Left`；
    RGB 提取改为显式 `undefined` 早抛，不再用 `!`。
- 语义未变：设置项 / 节点数据 / 端口表的合法输入结果一致；对畸形载荷才按运行时校验回落。
- 台账：B5 行改「清账中（子批1–6：120 份 / 268 处已清）」。

Refs #3181
