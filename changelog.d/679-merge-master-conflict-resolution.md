## Fixed

- 并入 `master`（`6abf2d5` UI 基元复用棘轮 + 语义 token、`e830098` pre-commit
  并行 tsc/eslint、`67d0546` 删除形态映射线）并解决 6 处冲突：
  - `.githooks/pre-commit`：采用 master 的「tsc + eslint 并行」形态（原 PR 侧是
    两步串行），步骤号合并为 `6&7/25`，其余步骤号顺延不变。
  - `scripts/check-ui-primitives.cjs`：取本 PR 侧（含 §16.2.4 分批计划的措辞），
    顺手删掉了一句指向不存在常量 `INCLUDE_AT_LEVEL` 的悬空引用。
  - `scripts/.ui-primitives-baseline.json`：按**合并后的实际源码**重算 —— 取本
    PR 侧计数（P2 清零、P1/P3 已迁移），丢弃 master 侧 458 的中间态；
    已全量迁移的 `WorkflowModePickChip.tsx` 不再出现在基线里。
    合并后实测 **435 处 / 114 文件**（P1 397 / P2 0 / P3 38）。
  - `src/components/studio/ui/ModalDialog.tsx`：取本 PR 的 `ui/dialog` 实现
    （master 侧只有文档注释差异），并保留 master 新增的 spacing/buttons 两行说明。
  - `docs/standards/16-shadcn-ui与表单校验.md`：取本 PR 侧（已是迁移后现状 +
    §16.2.5 两条层级刻度）。
  - `docs/standards/03-样式与-tailwind.md`：取 master 侧（表格对齐格式 +
    §3.6.3 主题 token 层叠）；§3.6.2 两侧内容一致，编号无需再调整。

  验证：pre-commit 25 步全绿；`check-ui-primitives` 435 ≤ 基线；主题色棘轮
  142 ≤ 160。
