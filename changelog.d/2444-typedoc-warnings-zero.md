## Changed

- API 文档（typedoc）的 61 条 warning 清零并挂上硬闸（#2444）：修 8 条 @param
  与签名漂移（对象参数化后注释没跟）、8 条死链（模块级 `{@link ./x}` 转纯代码
  文本——typedoc 的模块名带中文后缀，链接形态天然脆）、35+7 条「被引用但收不进
  文档」的符号加 `export`（已在公开签名里，导出是事实口径）；typedoc 入口补
  `src/trpc/**/*.tsx` 与 `scripts/db-backup-core.mjs`，check-docs-api 输入面同批
  补 `.tsx`（#2223 对账纪律）；`@types/node` 的 `child_process.spawn` 自引链接经
  `externalSymbolLinkMappings` 收口。判据侧新增 `judgeTypedocTail`：总结行有账
  即红、0 warning 的「无总结行 + html generated」形态放行、两者都缺按红处理
  （typedoc 退出码不可信，按日志判，先剥 ANSI 色码）。
