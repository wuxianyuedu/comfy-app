## Fixed

- 五条「批次改了结构、断言没跟着重算」的预存红，逐条只换**读法**、不动它们锁的口径：
  - `CanvasNodePrimitives.test.tsx` 的 `StatusDot` 4 条：`toHaveClass("rounded-full", "h-2.5", "w-2.5")` → `("rounded-full", "size-2.5")`。漂移来自 **P80**（`w-N` 与 `h-N` 同值必须换 `size-N`，现为硬闸），迁移时这份断言没重算。
  - `RuntimeLogBox.test.tsx` 的「多次启动时下拉按「时刻 · 标题」列出，切换回传会话 id」1 条：漂移来自 **P76**（视图层裸 `<select>` → `ui/select-menu` 的 combobox）。原来按原生 `<select>` 读 `value` + `<option>`，现在改成读触发器的可见文字 + 点开后的 `role="option"`；选项点击也要换成完整指针序列（`userEvent`）—— Base UI 的值提交挂在指针抬起上，裸 `fireEvent.click` 只发 `click`、提交不了（这条是本次踩出来的，写进注释免得下一个人再试一遍）。
- 两条用例在 `master` 上已红了一段时间：`pnpm test` 不在 pre-commit 里（钩子跑 tsc / eslint / 门禁脚本），所以这类红不会被提交拦住，只会由下一个跑全量的人重新查一遍「是不是我的改动弄坏的」。
