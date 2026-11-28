## Fixed

- **`pnpm ship --no-commit` 现在把 HEAD 之外的改动逐条念出来**（ISSUE #5255）：解冲突后工作区留着修正时，此前提交段跳过让这些修正既不进 HEAD 也不进 PR，平台跑旧测试、白跑一轮 CI。阶段 0 现在逐条点名未暂存 / 未跟踪路径，明示「这些改动不在 HEAD 里、平台不会看到」。只念不拦，`--no-commit` 跳过提交段的语义不变；判据本体是纯函数 `noCommitOutsideHeadReading`，用例在 `tests/ship.test.ts`。
