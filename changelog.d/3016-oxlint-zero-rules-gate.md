## Fixed

- `unicorn/no-negated-condition` 回潮 14 处清零（#3016）：`src/lib/comfyui` 9 份 10 处、
  `scripts/reformat-preview-range.mjs` 3 处、`src/lib/comfyui/firstframe.test.ts` 1 处，
  形态全是 `x !== undefined ? A : B`，按拍板口径改写为 `x === undefined ? B : A`
  （判空三元**肯定侧在前**：条件取等号判空、只交换真/假分支、条件本身不动，
  与 #2977 清零形态逐字一致，交换分支不改求值语义）。这条与
  `typescript/strict-boolean-expressions` 在判空三元上互斥（满足一条就触犯另一条，
  #2917 一族的清污批每批带回 12 处量级漂移），写法口径落在规范 §13.5.32。

## Added

- 「已清零 oxlint 规则集」防回潮硬闸（#3016，台账属 #2777）：
  `scripts/check-oxlint-zero-rules.mjs` 持 `ZERO_RULES` 在册清单
  （41 条 = #2775 批 39 条 + #2776 的 `eqeqeq` / `no-void`），探针形态
  （每次运行现生成临时配置：extends 同一 awesomeness 预设、categories 全关、
  只抬清单内规则为 error）全仓 `--type-aware` 扫一遍、判 0 命中、
  命中逐条列 `文件:行:列` 退 1。挂载在 `.githooks/pre-commit` D 组尾部与
  `quality-gate` 的 `oxlintZeroRules`（实测约 155s，只在重档付），
  契约测试 `tests/check-oxlint-zero-rules.test.ts`（正控全仓 0 命中退 0、
  负控临时夹具判红退 1、肯定侧在前对照退 0）。
  **清单是唯一登记面：每清零一条新规则就往 ZERO_RULES 加一行。**
