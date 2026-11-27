## Added
- `pnpm test:affected [--report|--json] [--base origin/master]`（#5170）：本地复现 CI 的「受影响用例」此前只能自己拼 `pnpm exec vitest run --no-file-parallelism …`，命令行长度上限、分块与超时指纹隔离复跑这些坑得再踩一遍。现在薄包装既有执行者 `run-affected-tests.mjs`：改动面走 stdin（不进 argv），读数摆出「改动面 → 命中清单 → 退码」，空改动面退 2 而不兜成全量，判决链一个字不改。补改动面并集 / 去重 / CRLF 用例。
