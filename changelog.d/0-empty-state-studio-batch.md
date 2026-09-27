## Fixed

- studio / model 视图层手搓空态卡治理 6 处 → 0：`studio/ModelLibrary.tsx`（两处：总空 & 目录空）、`studio/history/HistoryList.tsx`、`studio/ProjectOutputs.tsx`、`studio/TrainingStudio.tsx`、`studio/WorksGallery.tsx`（保留作品类别装饰色常量 `WORKS_CATEGORY_ICON_BG`）、`model/ModelLibrary.tsx`。全部迁至 `~/components/ui/empty-state` 的 `<EmptyState>`，`page` 档 `minHeightClass` 与原 `min-h-[N]` 对齐、`action` 用 `<EmptyContent>` 横排；`P75` 基线由 `scripts/check-ui-primitives.cjs --update` 收紧至 0。视觉漂到 Base UI 派 Empty 骨架（`rounded-2xl` / `text-xs` 说明），按项目「允许视觉漂移」策略后续统一处理。
