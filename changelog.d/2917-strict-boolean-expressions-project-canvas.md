## Changed

- **oxlint `typescript/strict-boolean-expressions` 批 5：`src/lib` 回潮清零 +
  `src/components` 首批（studio/project-canvas）清零**（ISSUE #2776 / #2917）：
  两段均逐处判空值语义手工改写（无 fixer），分列如下。
  - **`src/lib` 回潮 10 份 15 处**：appearance、comfy-embed、comfy-stats-store、
    console-run、dom-rect、drizzle-studio/lifecycle、render-film-client、
    history-detail-actions、markdown/styles、production/sync —— 批 1/2 清零后
    新合入代码带回来的回潮，按同一口径补齐，`src/lib` 全域归零的结论保住。
  - **`src/components/studio/project-canvas` 28 份 104 处**：画布主链全域 ——
    activeTask / stepLogCache / helpers / canvas-render-chain / generate-payload
    等纯函数层，hooks（use-task-step-log-stream / use-workflow-io /
    use-cancel-task / use-material-library / use-canvas-connections /
    use-content-asset-gallery / use-history-panel / use-project-persistence /
    use-shot-generation-writeback / use-workflow-modes / use-generate）与视图
    （CanvasNode / WorkflowNode / ContentAssetNode / ErrorPanel / ResultCard /
    StepLogRow / StepLogTaskPicker / MaterialLibraryPanel /
    ImageGenerationPanel / WorkflowPickChip / HistoryPanel / GlobalStepLogPanel）。
  - 口径：可空布尔 → `=== true`；可空字符串按声明域显式比较
    （`string | undefined` → `=== undefined || === ""`、`string | null` →
    `=== null || === ""`、三态 `string | null | undefined` → 三重判）；
    `unknown` / `any` 真值语义（SSE 帧字段）→ `Boolean(...)`；
    trpc 返回的**恒真对象**防御性判空（`tagRes.value`、`tpl`）→ `Boolean(...)`
    保留运行期防御（类型域内非空，`=== undefined` 会被 TS2367 拒）；
    ErrorPanel 的 `Boolean(errorContext?.request)` 不重拿收窄，重排为
    `errorContext !== undefined && Boolean(errorContext.request)` 让 TS 在
    真分支收窄。全部逐值等价；eqeqeq 台账 0 新增、oxlint 禁用台账 0 处。
  - 验证：`src/lib` 与 `src/components/studio/project-canvas` 该规则复测
    0 残留；`tsc --noEmit` 通过；project-canvas 17 份测试 109 用例全绿。
  - 剩余总量 1000 处 / 338 份（components 629 / tests 142 / app 115 /
    server 98 / config 9 / trpc 2 / tools 1），分布见
    `log/tools/sbe-remaining-2026-11-02.md`。
