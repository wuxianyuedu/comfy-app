## Fixed

- **PR #1654（`fix/1648-a11y-warmup`）与 `master` 的冲突已解，两侧都在治「首价占着别人的预算」这件事、合并取两者之和。** 冲突只有 `tests/check-a11y-rules.test.ts` 一处，两侧动的是同一段代码的两半：
  - **PR 侧（#1648）** 从**计时**下手：加了一条收集期暖机（`await loadJudgeModule().loadEslintConfig()`），把「每进程只付一次」的那回真加载搬到用例计时之外，并删掉 `expect(firstMs).toBeGreaterThan(0)` —— 那条读的是「这台机器此刻什么状态」而不是判据的性质（暖机之后它恰好是 0ms，当场红）。
  - **`master` 侧（746a3892 / #1655）** 从**预算**下手：四条真读配置的用例登记 `CONFIG_BUDGET`（120s，实测首值 36.4s、`--report` 子进程 57.1s 顶穿默认 30s 档），并把「只求值一次」的判据从墙钟改成**实例比对**（`expect(await loadEslintConfig()).toBe(flat)`，第三次仍取同一实例）。
  - **合并取法**：PR 侧的**暖机**（首价落在用例之外）+ `master` 侧的**断言形状**（实例比对那一格留下、`firstMs` 只作话术读数不当断言）。两侧互补而非互斥：暖机把进程内的 36.4s 挪出计时，`CONFIG_BUDGET` 仍管得住那条真起子进程的用例 —— **子进程有它自己的模块缓存，借不到本进程的暖机**，所以它单独挂 `CLI_BUDGET`（120s，与 `a11y-rules-gate` 同源）。`CONFIG_BUDGET` / `CLI_BUDGET` 两个名字都留下，注释写明各自管谁。
  - **反向验证**（合并后的形状仍承重）：把 `loadEslintConfig` 的记忆化摘掉、改成每次 `mod.default.map((c) => ({ ...c }))` 重建数组 → 本文件**只有**「只求值一次」那一条红在实例比对上（`expected [ … ] to be [ … ] // Object.is equality`），其余 5 条照绿；恢复后 6/6 绿。
  - **验收**：`tests/check-a11y-rules.test.ts` **6 passed**、`a11y-rules-gate` + 覆盖度账本 **15 passed**；`tsc --noEmit` / `eslint` / `prettier` / `check-file-structure --strict` / `check-function-length` / `check-changelog-fragments` / `check-comment-language` 全绿。
