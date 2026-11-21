## Fixed

- GA 每日档「API 文档生成与自检」红（#4676）：typedoc 对
  `core/repository-workflow-template.ts` 里 3 处指向模块私有函数 `listHasRaw`
  的 `{@link}` 报 warning（链接在模块内可解析，但私有符号永远收不进文档）。
  按 #2444 的修法把 `{@link listHasRaw}` 改为代码文本 `listHasRaw`
  （含 `LIST_ROW_COLUMNS` 注释里同形的第 4 处，文件内一致），
  门禁回到 0 errors / 0 warnings。
