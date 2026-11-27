## Added
- `pnpm doc:stale-scan [docs/**] [--kind path|symbol|command|anchor|count] [--json]`（#5181）：文档陈旧候选只读探针，替代 14 批临时探针；只出候选 + 行号 + 上下文 + 命中数，不自动改、不判缺陷（零命中可能是框架名或历史自注），退 0 出完读数 / 2 输入面取不到。
