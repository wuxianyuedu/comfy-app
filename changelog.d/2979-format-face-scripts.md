## Fixed

- 格式判据的两个判决面收进 `scripts/**`（ISSUE #2979）：改动面两档（`--staged` / `--changed`）的扫描面 = **改动面 ∩ `GLOBS`**（`GLOBS` 扩到含 `mjs`/`cjs`），`IGNORE_GLOBS` 只对全量档（默认 / `--report`）生效——它是「存量迁移」的白名单，不是「这些文件不用管格式」的白名单。旧口径下 `scripts/**` 的格式没有任何判决面拦得到（本地说「跳过」、平台 `ifModify` 不含 ⇒ 不执行）。平台「oxfmt 格式」格的 `ifModify` 同批扩面（逐字对账在 `ci-incremental-gates.mjs` 登记条目）。存量读数（2026-11-04）：新面内 136 份未过，按 #2710 增量口径「谁碰谁迁」。
