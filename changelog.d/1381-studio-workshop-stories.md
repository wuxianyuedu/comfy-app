## Added

- **`studio/` 与 `workshop/` 的业务组件补 18 份 story（5 份 → 23 份，全仓 88 → 108 份）**（ISSUE #1381）。`ui/` 满覆盖之后，那两棵树按「数据从哪来」分档铺：纯 props（`WorkshopStageItem` / `StageHint` / `SeedAdvancedField` / `ShotSizePicker` / `MegapixelStepper` / `FullScreenLayer` / `ViewContainer` / `CanvasRecenterButton` / `CanvasSettingsButton` / `ParamOwnerTag` / `EmptyCanvasHint`）、结构化入参（`CanvasProgressIndicator` / `DraftIntegrityHint` / `WorkflowNodeParts` / `CanvasNodePrimitives` / `DimensionControlParts`）、运行期环境（`WorkflowPreviewRunFeedback` 的两档视图 × 三档 phase、`WorkflowPickChip` 的加载态与空态对照）。
  - **派生量一律现算、不手抄**：百分比调 `stageProgressPct()`、尺寸摘要调 `shotSizeSummary()`、脏数据结论调 `auditDraftElements()`、阶段进度调 `computeStageRatios()` —— 手抄的数字在常量改了之后**仍然看着正常**。
  - 刻意不写的那几档（写 store 的件 / 真渲染 React Flow 上下文的件 / 整屏容器）与理由写在规范 16 §16.2.3.9，**不是漏了**。

## Fixed

- **空画布引导卡的毛玻璃被一次类名规范化拼坏了**：`src/components/studio/project-canvas/EmptyCanvasHint.tsx` 的类名串里躺着 `backdrop-bl dark:shadow-black/40ur-md` —— `backdrop-blur-md` 与 `dark:shadow-black/40` 撞在一起，于是那张卡片既丢了 `backdrop-blur-md`、又挂了一条不存在的工具类。Tailwind 对未知类名**不报错**（只是不生成 CSS），所以构建 / tsc / eslint / 既有门禁全绿；是把它摆到新加的 story 画布上才看出来的。已按原意改回两个类。**「类名字符串被拼坏」全仓仍无判据**（`tw4-canonical-report.mjs` 只回答「有没有另一种写法生成相同的 CSS」），本批只修实例并记账，立判据是独立的一刀。

## Docs

- 规范 16 新增 **§16.2.3.9**（业务目录的三档铺法、派生量不手抄、刻意不写的那几档、上面那处类名缺陷与它暴露的判据盲区）；`docs/guide-storybook.md` 补「业务目录不在覆盖率棘轮里」与分档口径；`PRODUCTION-GAPS` 的 F6 同批更新。
