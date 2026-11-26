## Fixed

- 历史详情「工作流参数」改为读 `workflow.detailFull` 的富化 IO（#5118）：此前走轻量
  `workflow.detail` 只拿落库原始勾选列，label 为空 → 退回 `replace` / `aspect_ratio`
  等 pin 名，且没提交值的端口整行缺失。现在展示名与 IO 预览逐字一致、全量输入端口
  都在并带默认值标记；工作流已删时如实回落 pin 名，不编。
  同批补 IO 源派生与全量端口 / 默认值用例，产品文档 FR-GN-06 同步口径。
