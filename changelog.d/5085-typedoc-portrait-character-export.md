## Fixed

- GA 每日档「API 文档生成与自检」红在 typedoc 的 1 条 warning（#5085）：
  `PortraitCharacter` 被导出函数 `buildPortraitPrompt` / `buildPortraitPrompts` 的签名引用，
  自身却未导出，触发「referenced but not included in the documentation」。现导出该类型，
  typedoc 收进文档、warning 归零；补源码契约用例防止退回未导出。
