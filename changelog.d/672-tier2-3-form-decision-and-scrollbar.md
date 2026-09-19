## Changed

- **`ui/form`（RHF 族）的选型决定：不进业务表单**（ISSUE #672，规范 16 §16.2.4.8）。
  两条判据：① `ui/form` 是 RHF 的 `FormProvider`，用上它就等于同一个草稿有两个
  持有者（feature hook 的 state 与 RHF 的 store），与 §16.2.1「controller 是唯一
  数据出入口」直接冲突；② 本项目要校验的东西一半不是字段级的 ——「模型名是否与
  列表重名」「编辑态条目是否还存在」要看**列表**，zod schema 表达不了。
  **替代口径**：字段级规则住 `src/lib/<domain>/*-schema.ts` 的纯函数，
  集合级规则留 controller；失败错位到具体字段，没有对应字段的才走横幅。
  首个落点 `src/lib/llm/remote-model-schema.ts` + `useRemoteModelDialogs`。
  结论钉进 `tests/ui-primitives-coverage.test.ts`（schema 不 import React、
  弹窗视图不 import `zod`），免得下一轮又从「须先决策」开始推。
- **自绘滚动条外观收成一处**（规范 16 §16.2.4.9）：`.custom-scrollbar` 与视图文件
  里的 `SCROLLBAR_VISIBLE_CLASSES` 是同一件事的两份实现，取值已经漂移
  （8px vs 10px、hover `ink-icon` vs `ink-muted`）。视图那份**取值逐条照搬**搬进
  `globals.css` 成为 `.soft-scrollbar`，`SCROLLBAR_VISIBLE_CLASSES` 退化成
  `"soft-scrollbar overflow-y-auto"` —— 调用处零改动、渲染结果不变。
  `globals.css` 顶部写清三档（全局兜底 / 密集日志区 / 文字编辑区）各自的出处与谁在用。

## Added

- **P4 判据：视图里不得自写 `::-webkit-scrollbar` 外观**（`scripts/check-ui-primitives.cjs`）。
  与 P1~P3 的计数棘轮不同，P4 一上来就是**硬闸**，且**不进基线** ——
  `--update` 也不接受带 P4 违规的基线（否则「把违规一起写进基线」就是唯一的绕过方式）。
  治理路径是 `globals.css` 的三个具名类。

## Fixed

- **`RemoteModelDialog` 的提交按钮不再因名称为空而禁用**：原先
  `disabled={!addForm.model.trim()}` 让空名称时**按钮点不动**，字段级提示于是
  永远出不来（用户只看到灰按钮，不知道该填哪）。现在逐字段标红，重名等
  集合级失败也错位到名称字段上。
- **R10 判据补上 `.css` 盲区**（`scripts/check-file-structure.cjs`）：注释里禁止
  「历史流水」此前只扫 `.ts` / `.tsx`，而样式注释恰恰最容易被整段搬运。
  纳入后 `globals.css` 立刻报出三处（`T11` / `T10` ×2），另有 `R-ardot18` /
  `R-ardot106` / `R-ardot103` 已在同批清掉。
