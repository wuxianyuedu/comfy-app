## Fixed

- **CI 上 `tests/check-format.test.ts` 偶发超时把整条流水线打红**。该文件的用例都要在临时仓库里真起子进程（`git init` + add/commit，再 spawn 门禁脚本，门禁自己还要 spawn prettier），而用例超时沿用 vitest 默认的 5s：CI 上与其余 261 个测试文件并行时偶发被击穿（`Test timed out in 5000ms`，单跑只要 0.2~0.3s），失败信息看起来像门禁坏了，实际只是超时口径不够。现在按 `tests/check-branch-guard.test.ts` / `tests/check-reformat-only.test.ts` 的既有口径整文件放宽到 30s（`vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })`），只影响本文件，不掩盖其它文件的真实挂起。
