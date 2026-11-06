## Fixed

**GA 检出面收窄打到了按历史现算的判据：`fixed-structural-tests` / `daily` 回到全历史**（GA 侧适配清单 G-8）

`tests/audits-doc-references.test.ts` 在固定结构清单里，它用 `git log --all --diff-filter=D -- scripts/`
现算「已删的棘轮基线」，浅克隆下退化成空集 ⇒ 反向锚点「判据面非空」必红。

- `pr-gate.yml` `fixed-structural-tests`：`fetch-depth: 2` → `0`
- `daily.yml`：`fetch-depth: 1` → `0`（全量单测含同一份用例）
- `pr-gate.yml` `affected-tests` 保持 `2`：`COMFY_AFFECTED_SEGMENT=affected` 不含固定清单
- `pr-gate.yml` `typecheck-db-format` 保持 `2`：本格只跑 `tests/lib-node-only-declarations.test.ts`，不读历史
- `package-desktop.yml` 保持 `1`：只 `pnpm tauri build`，不跑测试

GA 读数（run 42177286869 › `fixed-structural-tests`，`git fetch --depth=2`）：

```
FAIL tests/audits-doc-references.test.ts > 判据面非空：仓库历史里确实有已删的棘轮基线
AssertionError: expected 0 to be greater than 0
Tests  1 failed | 265 passed (266)
```

CNB 侧完全不动（任务 3 并行期纪律，§13.5.34）。
