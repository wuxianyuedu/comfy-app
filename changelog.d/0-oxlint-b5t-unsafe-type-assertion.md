## Changed

- **B5 子批 20：20 份 / 37 处 `typescript/no-unsafe-type-assertion` 清零**（判决面删掉这 20 份路径行；
  `workflow-exposed-params.ts` 实扫 2 处，清单原记 3 处，按实清记 37）。
  本批覆盖 `lib/shell`（退出 / 更新 / 代码热更 / 窗口桥接 / 打开链接 / 定位路径 / 陈旧提示）、
  `lib/workflow`（暴露参数 / 参数分类 / 参数映射 / IO 类型 / 输出绑定 / 运行态 / 调试源）、
  `sqlite-error`、`task-state`、`update-check-client`、`workshop/api-channel-client` 及对应用例。
  修法仍是「运行时校验 + 类型守卫」：
  - 字符串联合 / 键集：`Object.hasOwn` + 本地 `isExposedParamClass` / `isParamClass` /
    `isKnownTaskStatus` 守卫；`TASK_STATUS_LABELS` 不再靠 `as keyof`。
  - 数据读取：`isRecord` / `asRecord` / `isPlainRecord` 逐层收窄；`Reflect.get` / `Reflect.set` /
    `Reflect.deleteProperty` 处理 `globalThis` / `window` 桥接。
  - 结构校验：`isWorkflowRunMeta` / `isModeOverrideMap` / `isChannelsView` 形状守卫；
    `debug-source-client` 加 `asserts value is` 断言函数（非法负载抛可读错）。
  - 用例：`vi.fn<SpawnCall>` 显式签名、`seen` 显式形状 + 可选链，不再靠箭头内断言。
- 语义未变：合法输入结果一致；非法输入维持各自既有的回落 / 跳过 / 抛错行为
  （`sizeGroupIds` 非参数类卡片回落 `[]`、`io-types` 非法 `modes` 跳过、`update-check-client`
  非对象响应回落 EMPTY）。
- 台账：B5 行改「清账中（子批1–20：400 份 / 998 处已清）」。

Refs #3181
