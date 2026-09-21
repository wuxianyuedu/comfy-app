## Fixed

- **`src/lib/workshop/model-mode-contract.ts` 的 `adapterInputsFromContract`
  无 default 的 switch，静默漏新预制口**：原实现按 `id` switch 出 7 个字面量
  分支（`prompt` / `negative` / `size` / `reference-image` / `first-frame` /
  `last-frame` / `duration`），**没有 default**。给 `MODE_CONTRACT_INPUT_TYPES`
  新增一个预制契约口（`type: "..."`）后，`ModeContractInputId` 会带上它但
  switch 完全不认，运行时会被**静默跳过**（表现为「工作流入参配置里看不到
  这个字段」），`tsc` / eslint 都不报。改成 `Record<ModeContractInputType, ...>`
  的固定映射表 + `isModeContractInputType` 判据过滤 —— 新增 type 忘了登记
  适配器行，`pnpm exec tsc --noEmit` 直接报「缺属性」。带序号的参考图口
  （`reference-image-${n}`）与自定义口（`custom-${kind}-${n}`）两族模板字面量
  不进这张表（由本地工作流侧连线声明落点），与旧代码跳过路径一致；
  `model-mode-contract.test.ts` 与 `tests/model-mode-contract.test.ts` 全绿
  确认输出行为不变。
