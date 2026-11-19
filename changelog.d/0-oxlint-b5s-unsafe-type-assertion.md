## Changed

- **B5 子批 19：20 份 / 58 处 `typescript/no-unsafe-type-assertion` 清零**（判决面删掉这 20 份路径行；
  清单原记 55 处，`shot-writeback.test.ts` 实扫 6 处，按实清记 58）。
  本批覆盖 `lib/production`（客户端 / 评审 rubric 与类型 / 运行态 / 写回 / 同步）、
  `lib/project-canvas`（API / helpers / store / 类型 / 同步提示）与 `query-string`、`server-cache` 及对应用例。
  修法仍是「运行时校验 + 类型守卫」：
  - 字符串联合：`Set<string>(词表)` / `ReadonlyArray<string>` + 本地 `isXxx(v): v is Xxx` 守卫
    （`isReviewMode` / `isReviewRubricKind` / `isRunStatus` / `isApprovalMode`）。
  - 数据读取：`asRecord` + 逐字段 `typeof` / `Array.isArray` / `Reflect.get`；
    `production-client` 的进度对象改 `normalizeProductionProgress` 构造。
  - `server-cache` 新增 `assertEntryValue<T>`（运行期核对对象且带 `value`，否则 throw）；
    `query-string` 新增 `isScalar` 守卫；`sync-notice` 用 `Object.hasOwn` 收窄码。
  - 用例：mock 回包按真实类型标注（`ProductionRun` / `RunAction`），脏值用 `Reflect.set` 注入，
    数组项用 `recordAt()`（`isRecord` + 非对象 throw）读取；不再靠双重断言。
- 语义未变：合法输入结果一致；非法输入维持各自既有的回落 / 跳过 / 抛错行为
  （`canvas-store` 非数组 `nodes/edges` 回落 `[]`、`canvas-helpers`/`canvas-types` 非法输入抛 `TypeError`）。
- 台账：B5 行改「清账中（子批1–19：380 份 / 961 处已清）」。

Refs #3181
