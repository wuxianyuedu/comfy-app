## Fixed

**`invocationFor()` 的平台改成入参、用例不再拿宿主平台当判据**（ISSUE #2551 第三跑读数）。
PR 那跑的 `受影响用例` 红在 `expected 'powershell' to be 'cnb'`：用例在 POSIX 上写着「POSIX 上怎么起 cnb」的断言，判据却是 `process.platform` —— 同一条用例在 Windows 节点上必然反过来。

- `scripts/ci-token-scopes.mjs`：`invocationFor(cmd, args, { platform })`，缺省仍是 `process.platform`，
  所以线上行为一字未改；改的是这一格之后能被两种形态分别判一遍。
- `tests/ci-token-scopes.test.ts`：断言显式给 `platform`，另加一格「Windows 形态的参数不被改写」。
