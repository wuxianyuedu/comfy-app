## Fixed

- 并入 `master`（`56f57c2` 画布视口与日志默认选中、`82b8233` 浮层与空态收敛、
  P2 棘轮清零）并解决 3 处冲突：
  - `scripts/.ui-primitives-baseline.json`：不手工拼接两侧 JSON，改按**合并后的
    实际源码**用 `check-ui-primitives.cjs --update` 重算 —— master 侧 P2 已清零、
    本 PR 侧 `studio/logs` 与 `studio/workflow-library` 两目录 P1 已清零，两侧的
    中间态都不代表合并结果。实测 **393 处 / 102 文件**。
  - `src/components/studio/workflow-library/sections/MetaEditor.tsx`：取 master 侧
    用 `ui/dialog` 重塑后的实现（本 PR 侧仍是自搓 `createPortal`），并把「保存」
    按钮改用本 PR 新增的语义变体 `primary-solid`，去掉写死的 `fuchsia` 手写色
    与 `bg-white` 文字色。
  - `docs/standards/16-shadcn-ui与表单校验.md`：两侧是**同一节的重写**而非同行
    编辑 —— master 侧重写了 §16.2.3 的豁免归还说明并新增 §16.2.5（两条层级刻度）
    与 §16.2.4 的 P2 完成样板表；本 PR 侧新增 §16.2.4.1（按钮语义变体）。
    合并取「两边都要」：保留本 PR 的 §16.2.4.1，其余各节统一取 master 侧。

  验证：`tsc --noEmit` ✅、全量 `eslint --max-warnings 0` ✅、
  `workflow-library` + `ui` 域 vitest 263 条 ✅、`ui:primitives` / `doc:check` /
  `format:ratchet` / 结构与重复门禁 ✅。
  注：`check-file-structure --strict` 的 R5 报错在 master 上即已存在
  （`src/lib/workflow/workflow-param-mapping.ts` 1049 行），非本次合并引入。
