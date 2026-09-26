## Fixed

- P2「渲染期 setState」逐点复核（7 个 hook 共 22 处调用点）后的整改：
  - `use-settings-page`：快照写回 `sessionStorage` 由渲染体移入 `useEffect`——这是全库唯一真正的**渲染期副作用**（不是 setState），StrictMode 双渲染下会重复写。
  - `use-model-adapters`：适配器草稿的补种条件由 `draft.length === 0` 改为「本轮是否已播种过」的记账——原条件在用户把适配器**删空**后恒真，会被反复灌回（表现为删不掉）。
  - `use-llm-config`：`config` 与候选分组改为 `useMemo` 纯派生（去掉 `prevCfg` 记账 state 与 3 处渲染期 setState）。
  - `use-model-library`（studio）：`models` 改为 `useMemo` 派生（去掉 `prevListData` 与 2 处渲染期 setState）。
  - `use-content-asset-gallery`：图集与「所属上下文键」合并为一条 state，渲染时按上下文取值（去掉 2 处渲染期 setState），保留「新任务首帧不显示上一任务缩略图」的原语义。
  - 保留不动：`editable-label` 与 `model/use-model-library` 的渲染期播种属 React 官方「prev 引用对比调整派生 state」范式，改掉反而会闪旧值（后者 `loading` 由 fetch 驱动），本轮不改。
