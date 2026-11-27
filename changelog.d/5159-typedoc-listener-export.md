## Fixed

- 修复 GA 每日档「API 文档生成与自检」红（#5159）：`Listener` 是导出函数
  `observeElementResize` 的 `callback` 参数类型，自身却未导出，typedoc 报
  「referenced by … but not included in the documentation」warning，自检把任何
  warning 判红。现导出该类型，typedoc 收进文档、warning 归零；补源码契约用例防止退回未导出。
