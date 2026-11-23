## Fixed

- 每日档「API 文档生成与自检」红（#4880）：`capture-streams.server.ts` 的 `serviceStartupBackfillText` JSDoc 用文档链接指向模块内未导出常量 `BACKFILL_MAX_BYTES`，typedoc 解析不出该链接记 1 条 warning、门禁对 warning 零容忍判红；改为纯文本引用（不导出死符号），typedoc 回到 0 errors / 0 warnings。
