## Changed

- **三档「每天首次自证」的执行与判决各多一个平台侧执行者**（ISSUE #1979）：
  `vitest` 那一档（以及 e2e / 产物两档）此前只有「本地钩子判、本地脚本跑」这一条链，
  平台侧即使在跑**同样内容**的步骤，也不经过跑法脚本 —— 于是「这一步绿了」只落在日志里、
  账面上一个字不变，本地「改了就当天跑」照旧拦人。

  **判据一个字没改，多的是执行者**（同 §13.5.17 的口径）：

  | 位置 | 改动 |
  | --- | --- |
  | `.cnb.yml` 的「生产构建」 | 入口从裸 `pnpm run build` 换成 `node scripts/artifact-run.mjs`（它内部就是那条命令，外面多出来的一跳是**记账**） |
  | `.cnb.yml` 的「单元测试」 | **停用中**，但注释块里的恢复形态已改成 `node scripts/full-suite-run.mjs`（恢复时入口写它，不是裸 vitest）—— 裸跑等于「跑了不记账」 |
  | `.cnb.yml` 的新 stage「新鲜度账」 | 跑 `scripts/freshness-gate.mjs`（与钩子 D 组**同一份**脚本、同一个档）；**必须排在「生产构建」之前** —— 跑法脚本跑绿会刷新账，同一分支的 stage 共享工作区，排在后面时它读到的是「刚被本次构建证过的账」，恒放行 |
  | `scripts/freshness-ledger.mjs` | `gitUser()` 现在按 `GIT_AUTHOR_NAME` → **`CNB_BUILD_USER_NICKNAME` / `CNB_BUILD_USER` / `CNB_COMMITTER`** → `git config user.name` → 兜底的顺序取第一个非空者。平台侧是只读检出，`git config user.name` 要么空、要么是检出器的占位，而 `who` 是这条账存在的意义 |

  ## 边界：这一步**不**替本地那笔账作证

  CI 的工作区是只读检出，`writeFreshness` 写下的账留在这个一次性检出里、**不落回任何分支**。
  把它落回去要动「CI 能不能回写分支」这条平台能力（`repo-code:new`… 实为
  `repo-code:rw` 在 push / PR 这类**可信事件**上有，但 `master` 走分支保护、PR 源分支可能
  来自 fork ⇒ 那时只有 `repo-code:r`），而且回写会产生新提交、再触发一轮流水线。
  **本档不动它**：平台侧这一步的价值是「**源分支上账是旧的**会在合并之前被机器说出来」，
  而不是「本地那笔账可以不管了」—— 两处判的是同一个事实，账只有一个作者（本地的提交）。

  三半都由 `tests/doc-check-hook-wiring.test.ts` 的「新鲜度账：平台侧的第二个执行者」
  一组钉住（平台侧那一步在、入口是跑法脚本、**本地那一半不许撤**），顺序约束另有专条。
