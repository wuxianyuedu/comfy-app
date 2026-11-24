## Fixed
- 修复 GA 每日档「API 文档生成与自检」红（#4971）：`TaskProgressRow` 是公开函数 `taskProgressSnapshot` 的参数形状，但没导出，typedoc 报「referenced by … but not included in the documentation」warning，自检把任何 warning 判红。改为导出该类型后 warning 归零，本地 `check-docs-api.cjs` 生成 + 自检通过（3426 份产物 / 458 个模块页）。
