## Fixed

- **PR #619 与 `master` 的合并冲突按「`master` 的新形态为底座、把本分支的语义改动重新落到对应位置」解决**：
  三处冲突（`WorkflowEditorCanvas.tsx` / `WorkflowEditorTopbar.tsx` / `workflow-editor-build-nodes.ts`）
  的实质是 `master` 的 ISSUE #565 全库 prettier 格式化与本分支的小幅语义改动相撞。冲突解决取
  `master` 的格式化后版本为底座，再把本分支的三类语义改动重新落上去：画布侧 `DEFAULT_EDGE_OPTIONS`
  模块级常量 + MiniMap 兜底色 `#333` → `var(--color-ink-faint)`；顶栏面包屑 `max-w-[280px]` →
  规范类名 `max-w-70`、`bg-*/7.000000000000001` → `bg-*/10`；三处「Extracted from …
  (P4/P2/late/final)」历史搬运注记改写为解释 Why 的中文注释。合并结果另把
  `WorkflowParamCard.tsx` 的 Tailwind 类名重排（`shadow-card` 归位）一并格式化到过 prettier。
- **`check-reformat-only.cjs` 增加合并提交豁免（`MERGE_HEAD` 存在即跳过）**：一次 `merge` 会把上游
  整批（含它在别处做的格式化）一次性带进来，「格式化与行为改动拆成两次提交」在合并现场物理上不可能 ——
  上游形态已定死在历史里。此前该门禁在 pre-commit 判暂存区，合并时会把上游带来的全部格式化文件误判成
  「本次顺手全库格式化」而阻断每一次合并提交。CI 的 `--range` 盘点口径不受影响（按范围判，与现场无关），
  回归测试见 `tests/check-reformat-only.test.ts`。
