## Changed

- **B5 子批 10：20 份 / 29 处 `typescript/no-unsafe-type-assertion` 清零**（判决面删掉这 20 份路径行）。
  本批是工作流库收尾 + `ui/` 基元：`workflow-library/**`（筛选 / 详情页签 / IO 配置 /
  参数映射）、`workspace-tabs`、`workflow-utils`、`WorkflowImportPanel`，以及
  `ui/aspect-ratio`、`ui/code-block`、`ui/form-rhf` 与 6 份 UI 用例。
  修法仍是「运行时校验 + 类型守卫」：
  - 筛选 / 页签 / 参数档位：白名单 + `Object.hasOwn` 本地谓词（`isSourceFilter` /
    `isTypeFilter` / `isDetailTab` / `isParamClass`）。
  - `normalizeWorkflowIO`：`isPlainRecord` + `isWorkflowIOMap` 逐值判定。
  - `ui/aspect-ratio`：样式改为带 `--ratio` 自定义属性的 `CSSProperties` 变量赋值；
    `ui/code-block` 动态 import 经 `isShikiBundle` 收窄；`ui/form-rhf` 的 Context 默认值
    改 `null` 并在缺失时显式抛错，children 用 `React.isValidElement` 收窄。
  - 测试侧：`vi.fn<签名>()` 替代 mock 断言；`instanceof HTMLElement` + 空值早抛；
    全局替换用 `Reflect.set`；两处断言改为等价语义（`toHaveProperty` / `toBeDisabled`）。
- 语义未变：合法输入结果一致；`form-rhf` 无 Provider 的误用从静默变成显式报错。
- 台账：B5 行改「清账中（子批1–10：200 份 / 410 处已清）」。

Refs #3181
