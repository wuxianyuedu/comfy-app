## Added

- **tsconfig 补齐三项严格开关（审计 §5.9 TS7 方向）**：`noImplicitReturns`（所有路径显式返回）、`noUnusedParameters`（死参数即报）、`erasableSyntaxOnly`（TS7：只允许可擦除语法，禁 enum / namespace / 构造参数属性）。全库开启后仅需 12 处小修，均已修，行为不变。

## Fixed

- 开这三项暴露并修掉的 12 处（全为类型/签名层，无运行时行为变化）：
  - `erasableSyntaxOnly`：`core/repository-base.ts` 的 `DrizzleRepository` 构造参数属性 → 显式 readonly 字段 + 构造函数赋值。
  - `noImplicitReturns`：`CustomNodesSettings/use-custom-nodes-settings` 三个 useEffect 与 `ui/confirm-dialog` 一个 useEffect——它们在分支里 `return onNextFrame(清理函数)` 但另一些路径隐式返回；补显式 `return undefined`（清理语义不变）。
  - `noUnusedParameters`：`ModelTagManager` 的 `commitEdit(id)` 形参 `id`、`WorkflowCanvasNodePreview` 的 `onOutput/onSettled(taskId)`、`prompt-builder.buildCharacterNegative(c)`、`test-db.parseRow(table)`、`tw4-canonical-codemod` 回调 `m` —— 均改 `_` 前缀标注「刻意不用」（与既有 `_req` 约定一致）。
