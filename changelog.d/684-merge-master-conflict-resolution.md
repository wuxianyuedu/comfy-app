## Fixed

- 并入 `master`（`82b8233` UI 基元复用棘轮 + 品牌/状态色 token、`56f57c2`
  画布 fitView / 日志默认选中 / 输出自连）并解决 **2 处冲突**：
  - `src/components/studio/canvas/WorkflowCanvasSettings.tsx`：取 master 侧的
    `ui/sheet` 抽屉实现（规范 16 §16.2.3 P2 复用，Esc / 遮罩 / 标题行同
    `ProjectSettingsDrawer`），保留本分支的注释中文化；master 侧遗留的两处英文
    注释一并译中 —— 齿轮按钮紫点说明，以及把 `T5 模型（t5Model）` 改写成
    `WAN 文本编码器（t5Model）`（R10 会把模型名 `T5` 误判成任务批次号）。
  - `src/components/studio/workflow-library/WorkflowCanvasNodePreview.wiring.test.tsx`：
    两侧都是「让 `defaultEdges` 派生断言容忍 prettier 折行」的同一处注释，
    取本分支更完整的那版（含规范 §12.11 的由来）。
  - 注释语言棘轮基线按合并后实测收紧（`--update` 后 `--strict` 通过）。
