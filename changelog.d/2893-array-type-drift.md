## Fixed

- oxlint `typescript/array-type` 漂移 1 处（#2893）：`use-character-lora-options.ts`
  的返回类型 `string[]` 改为预设要求的 `Array<string>`（`{ default: "generic" }`），
  纯类型面、运行期形态不变。这份文件由角色↔LoRA 绑定（#2622）在 `array-type`
  全仓清零之后新增，属「新代码带入」那一类。全仓复算（2415 份、不传路径参数）：
  该规则 0 命中。
