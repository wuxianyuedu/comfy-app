## Changed

- **「异步动作的进度」收成一个数值出口 + 一个形态出口**（规范 16 §16.2.4.19，**P16 硬闸**）：视图层与 `src/lib` 两侧此前有 **10 处**各写一遍「track + `width: X%` + 百分比文字」，写法四派 —— `Math.max(4, p)` 的可见下限、自算比例、不夹取、算好的 `pct`；且 **10 处里只有 2 处**声明了 `role="progressbar"`。

  - **数值侧** `~/lib/progress`（`DOMAIN_EXEMPT`，与 `format-bytes` / `display-value` / `list-filter` 同款）：`clampPct`（夹取 `[0,100]` 并取整）/ `toPct`（分母不可用 → `null` = **不确定态**，不是 0）/ `pctToWidth`（`minVisible` **只抬非零值**，0 恒为 0 —— 这正是旧 `Math.max(4, 0)` 把「没开始」画成 4% 的缺陷）。
  - **形态侧** `~/components/ui/progress-bar` 的 `ProgressBar`：`value: number | null`，`null` 渲染滑动条纹并给 `aria-valuetext="进行中"`（**不给 `aria-valuenow`**）；确定态给 `role="progressbar"` + `aria-valuenow` + 百分比文字。填充观感差异走 `fillClassName`。
  - 迁 10 处：`VideoStudio.parts` / `ShotStudio` / `WorkshopEncapsulationPanel`（`minVisible={4}` 保留原可见下限）、`StoryboardPlanner.parts`（`?? 0` → **不确定态** —— 报进度前不再画成「卡住」）、`HistoryTaskCard`、`FilmStudio`、`TrainingStudio` ×2、`WorkflowCanvasNodePreview`、`WorkshopHeader`、`CustomNodesSettings/SettingsParts`（手写 CSS 条纹 → `value={null}`）。
  - `src/lib` 四处比例换算接入出口口径：`comfyui/executor-ws`（`toPct`）、`core/repository-lora` / `project-canvas/canvas-api` / `workshop/generation-client`（`clampPct`）、`ui/water-fill-progress`、`studio/hooks/use-comfy-readiness`。

- **「把对象渲染成键值行」收成一个出口**（规范 16 §16.2.4.20，**P17 硬闸**）：全库 **5 处**各写一遍「标签 + 值 + 空值占位」的行，**布局语言有四种** —— `ProjectOutputs` 的隔行参数表、`HistoryDetailModal` 的生成参数卡与 `<table>` 参数表、`TrainingStudio` 的 Metrics 网格、`BrowserStatusBar` 的显存/内存内联项。

  - 出口 `~/components/ui/key-value-rows` 的 `KeyValueRows`：`rows`（标签左值右 + `bordered` / `striped`）/ `stacked`（标签在上，多列 + `hint`）/ `table`（真 `<table>` + `<th scope="row">`，补上原手写表的空语义）/ `inline`（状态栏）。`value`（已渲染节点）与 `raw`（交给 `displayValue` 处理缺值）二选一；`key` 也可为节点（带徽标的行）。
  - 顺带收掉 `HistoryDetailModal` 两处**逐字相同**的「值 → 文本」三元，收进 `history-detail-derive` 的 `kvValueText`。
  - `BrowserStatusBar` 三份逐字同形的资源项收进一个 `UsageItem`（行布局走 `KeyValueRows`，缺值走 `displayValue`）。

- **「空值显示什么」仍由 `~/lib/display-value` 独占**（P8，§16.2.4.11）：P17 只管**布局**那一层，`KeyValueRows` 的 `raw` 一律经 `displayValue`。

## Docs

- `docs/standards/16` §16.2.3（判据表补 P16/P17，硬闸清单由十二件事扩到十四件）、§16.2.4 台账新增「异步动作的进度」「键值行」两行、**新增 §16.2.4.19 / §16.2.4.20**（十份写法 / 五份写法、出口口径、判据锚点与反面用例）。
- `tests/ui-primitives-coverage.test.ts` 补出两个新出口的存在 + 导出 + 业务引用门槛；`tests/check-ui-primitives.test.ts` 补 7 条契约（两条判据各自阻断、各自的反面用例、合规者不误伤、不进基线、`--update` 拒绝放宽）。
