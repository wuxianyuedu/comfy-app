## Changed

- **已知基线失败登记表的粒度从「文件」收到「用例」**（ISSUE #1282）：
  排除手段由 `vitest run --exclude <文件>` 改为 `-t '<负前瞻正则>'`（锚定用例全名，
  祖先标题与用例标题按 vitest 的 `" > "` 连接）。动机是实测到的静默丢覆盖 ——
  一条断言红会把同文件其余已绿的断言一起从增量面摘走（现场 1 + 17）。
- `KNOWN_FAILED_CASES` 取代 `KNOWN_FAILED_FILES` 成为权威登记表（后者降为派生的
  文件视图）；排除参数的拼装（含正则转义）收口在 `vitestExcludeArgs`，消费方与
  两侧 `.ps1` 都调它。
- 新增 `scripts/known-failed-args.mjs`：把拼好的参数打给 PowerShell 侧（每行一个，
  模式含空格），两侧不再拿正则解析共享模块源码。
- `scripts/check-known-failed-stale.mjs` 增判两条腿：全名必须在该文件里存在（用
  `vitest list --json --no-staticParse` 取运行时全名）、且全库唯一；「还红着」也
  收窄到**登记的那一条**（同文件里别的用例红不算）。
