## Fixed

- **工坊封装：seed / lora-name / lora-strength 契约口的控件形态不再被兜成「图片选择」**（#4494）：
  `contractControlFor` 的 default 分支过宽，这三个口在流程测试表单里全出了图片选择器
  （种子 / LoRA 名 / 强度都不是图片）。现在预制口逐个登记控件形态（seed / lora-strength
  → 数值框，lora-name → 文本，图片族口 → 图片选择，未知 id 兜文本），并把
  `workshop-encapsulation-status` 的同名判定收口到这一份实现（不再两处各写一套）。
  同批补齐 lora 口的表单值读写（`exposedValueOf` / `withExposedValue` / 剪枝）——
  此前对 lora 口是空操作，文本框也存不了值。
