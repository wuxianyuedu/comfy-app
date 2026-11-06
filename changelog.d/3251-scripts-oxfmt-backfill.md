## Changed

- 全量档 oxfmt 扫描面纳入 `scripts/**`、`tools/**`、`e2e/**`：`check-format.cjs` 的 `SCAN_ROOTS` 从 2 个目录扩到 5 个，并从 `IGNORE_GLOBS` 删除对应三条；增量两档（`--changed` / `--staged`）与 CI 触发面不动。
- 同批把 `scripts/**` 56 份存量迁到 oxfmt 100 列（`run-affected-tests.mjs` 已由 #3254 拆分并迁移）。AST 结构 56/56、注释原文 56/56 一致；全库档 0 命中。
- 缺口说明（本次不修）：全量档没有任何自动执行者（`format:ratchet` 是人的动作、`check:all` 走 `--changed`、每日档无格式格）—— 新文件靠 `--changed` / `--staged` 拦，存量只在这一单里人跑一次。
