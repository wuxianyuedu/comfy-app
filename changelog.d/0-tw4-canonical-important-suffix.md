## Fixed

- **编辑器里持续提示的 Tailwind v4 canonical 警告清零**（35 个文件的 className，等价改写、
  无渲染变化 —— `prettier --check src` 全绿、受影响快照同步后测试通过）：
  - important 修饰符从前缀改后缀（`!bg-subtle` → `bg-subtle!`、`!border-port-surface` →
    `border-port-surface!`、`!size-2.5` → `size-2.5!` …）——这是 `suggestCanonicalClasses`
    报得最多的一类；
  - 断词 `break-words` → `wrap-break-word`（v4 更名）；
  - 可写成 spacing scale 的任意值 `[22px]` → `5.5`（`h-` / `w-` / `min-h-`）。
- **`WorkflowSubgraphNode.tsx` 的 TS 2783**：输出端口 Handle 的 `style` 里 `right` 被后置的
  spread 覆盖（`right: 5` 紧接 `...(ioEditMode ? { …, right: 0 } : { … })`），TS 报
  「此扩张将始终覆盖此属性」。改为把默认值并入 else 分支
  （`{ width: 10, height: 10, right: 5 }`），语义不变、歧义消失。
- `TrainingStudio` 快照随 className 同步（4 处）。

## Verified

- IDE 诊断：`src/components/studio/canvas/WorkflowSubgraphNode.tsx` 由
  1 error + 24 warning → **0**。
- `src/components/studio/TrainingStudio.test.tsx` 通过（快照先按新 class 串同步，再跑绿）。
- `pnpm exec prettier --check src` 全绿（改写后 class 顺序仍合规）。

## Changed

- `docs/standards/03-样式与-tailwind.md` §3.1 由「四组」扩为「六组」，新增 important 后缀与
  `wrap-break-word`，并写明**后两组（important / spacing 换算）为什么不进 codemod**：
  `!x` 与 JS 前缀否定同形，文本替换必然误伤，只能靠编辑器快速修复 + review 兜住。
- `scripts/tw4-canonical-codemod.cjs` 增加 `break-words` → `wrap-break-word` 规则。
- `docs/guides/DEV-QUERIES.md` §5 补 `break-words` 迁移与 important 前缀的自查 grep
  （按 className 字符串限定，避免撞上 `!ok` 这类否定）。
