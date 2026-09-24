## Fixed

- **抽卡重生成此前会出「同一张图」——同提示词重跑命中工作流里固定的 seed**：Phase 8 的「不合格→抽卡」
  语义是「保留提示词、换随机种子重出一版」。但本机 ComfyUI 生成链路把存储的 `rawJson`（seed 是图里
  写死的值）原样提交，工坊对外只暴露 提示词/尺寸/参考图/时长/自定义 这些**业务口**、seed 不是口，
  于是「同提示词重出」每次都命中同一个 seed → 得到**完全相同**的图，抽卡形同虚设。
  - 新增 `src/lib/comfyui/raw.ts` 的 `findSeedWidgetNodeIds(rawJson)`（纯函数）：扫顶层 `nodes[]`，
    按 `SEED_WIDGET_NAMES`（seed / noise_seed，大小写不敏感、widget 名缺省回退 input.name）找出带 seed
    控件的采样器节点 id；子图 wrapper 提升出的 seed 也在顶层 inputs 里可见，命中即可（`applyRawOverrides`
    会把覆盖再折叠进内层）。
  - `createWorkflowRunTask` 加 `randomizeSeed?: boolean`：为真时给这些节点各注一条
    `{ name: "control_after_generate", value: "randomize" }` 覆盖，追加进 `workflowInputs`（同时进任务
    `params` 与 `enqueue` 的 overrides）。这条覆盖正是 `raw-overrides.ts` 已支持的形态 —— comfy-cli 提交前
    `applyRawOverrides` 据此铸新随机种子（无哨兵槽时也兜底 mint），于是同提示词能出不同图。默认 false，
    首刷等仍保持图内 seed，不改变既有确定性。
  - `synthesizeFirstFrame` 透传 `randomizeSeed`；`run-engine` 的 `execImages` 对每次自主出图置
    `randomizeSeed: true` —— 自主流水线每次出图都换种子，「抽卡重生成」（镜头退回后重出）真正重掷。

## Tests

- 新增 `raw.test.ts`（findSeedWidgetNodeIds：命中 seed/noise_seed、大小写、无 widget 不算、非对象兜底）；
  `workflow-run.server.test.ts` 补 randomizeSeed 注覆盖 / 未开不注 两例；`run-engine.test.ts` 断言
  自主出图带 `randomizeSeed: true`。
