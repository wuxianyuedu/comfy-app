## Fixed

- `tests/check-doc-references.test.ts` 的 `doc:render --autofix` 组改为**临时目录
  夹具仓库**：`render-doc-placeholders.cjs` 支持 `DOC_RENDER_ROOT` /
  `DOC_RENDER_SCOPED` 注入输入输出根（不设环境变量时行为逐字不变），用例一次
  也不写真仓库的 `DEV-QUERIES.md` 与镜像（#2415）。
- 本文件其余真文件探针组补最后一道网：`afterEach` 核对探针目标的 git 干净度，
  还原失败时未跟踪新文件直接删、被改文件从索引拉回（自愈），仍不净则点名路径
  判红 —— 脏工作区不再悄悄留给下一次批量暂存。
- 事发两条断言（「绿的时候不多写」「描述这条口径本身 → 放行」）带上现场证据，
  分得清「判据真拦了」与「夹具没恢复」。
