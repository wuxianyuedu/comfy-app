## Added

- **工坊生图表单加「高级 · 种子」输入（Phase 8 · P8-1c）**：种子作为高级输入收进生成工具栏的「高级」折叠区
  （`SeedAdvancedField`，用 `Disclosure` + `Input`）。**默认留空 = 每次生成自动取一个新的随机 seed**；
  填一个数字则 pin 住该 seed（复现同一张图），点「随机」清空回到自动随机。值经 `WorkshopExposedValues.seed`
  走「种子」对外参数落到工作流连线的那一行 —— 工作流没连「种子」口时落不下去、用图内 seed（实际是否可换
  由工作流决定，运行期不改 `control_after_generate`）。仅本地通道显示（API 通道不经此口）。
  - `ShotStudio`：新增 `seedInput` 态 + `resolveSeed`（空/非数字→随机，数字→pin），`generateShot` 把它
    带进 `buildLibraryWorkflowInput` 的 values.seed。

## Tests

- 新增 `SeedAdvancedField.test.tsx`：渲染「高级」触发器；展开后输入回抛值、点「随机」回抛空串。
