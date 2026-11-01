## Fixed

- 已清零规则的 4 处漂移回到全仓 0（#2893）：`eslint/curly` 1 处
  （`src/lib/workshop/workflow-encapsulation.ts` 的 `lora-name` 赋值补花括号）、
  `perfectionist/sort-jsx-props` 2 处、`perfectionist/sort-object-types` 1 处
  （`CharacterDesigner.tsx` 与 `use-character-lora-options.ts` 的 props / 键顺序）。
  三处都来自角色↔LoRA 绑定（#2622）在对应规则清零之后新增的代码；只改顺序与花括号，
  无取值或渲染行为变化。全仓复算（2415 份、不传路径参数）：三条规则均 0 命中。
