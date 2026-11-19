## Fixed

- 画布挂载水合中途抛错被 `.catch(() => {})` 吞掉：`setHydrating(false)` 永不执行，画布永久卡「加载中」且无任何出口；IIFE 亦无卸载守卫（#4235）：水合编排抽成 `use-canvas-hydration`，全部落地收进 `beginStaleRun` 守卫（卸载后不写），失败路径复位 loading + toast 可行动文案（「画布加载失败，请刷新重试」）+ console 留痕。用例：对账失败/取 production 失败两形复位并报错、成功路径灌画布、卸载后不落地。
