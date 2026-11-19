## Changed

- pre-commit 与 premerge（合并前复算）的耗时账统一迁到 `<检出根>/.tmp/timing/`（原 `.git/` 下；迁移不搬历史）。（#4520）
- premerge 耗时账每条记录新增 `totalMs`（本次复算总墙钟）与 `trigger`（`pre-push` 自动触发 / `manual` 手工跑，由 `premerge-proof.mjs` 注入 `COMFY_PREMERGE_TRIGGER`）；新增只读入口 `node scripts/gates/premerge-timing.mjs`（`--last N` / `--json`）翻看账本。（#4520）
- `scripts/lib/git-dir.mjs` 新增 `resolveRepoRoot()`（`git rev-parse --show-toplevel`，与 `resolveGitDir` 同一 null 契约），`.tmp/` 下落点由它定根。
