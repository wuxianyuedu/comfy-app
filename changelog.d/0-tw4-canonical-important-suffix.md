## Fixed

- **编辑器里持续提示的 Tailwind v4 canonical 警告清零**（35 个文件的 className，等价改写、
  无渲染变化 —— `prettier --check src` 全绿、受影响快照同步后测试通过）：
  - important 修饰符从前缀改后缀（`!bg-subtle` → `bg-subtle!`、`!border-port-surface` →
    `border-port-surface!`、`!size-2.5` → `size-2.5!` …）——这是 `suggestCanonicalClasses`
    报得最多的一类；
  - 断词 `break-words` → `wrap-break-word`（v4 更名）；
  - 可写成 spacing scale 的任意值 `[22px]` → `5.5`（`h-` / `w-` / `min-h-`）。
- **续：`[Npx]` 里能写成 spacing 倍数的一并扫平**（259 处 / 97 个文件）——
  `min-h-[22px]` → `min-h-5.5`、`gap-[2px]` → `gap-0.5`、`max-w-[440px]` → `max-w-110` …
  改写器是新增的 `scripts/tw4-spacing-canonical.mjs`（幂等，dry-run 默认），判据**由
  Tailwind 引擎给出**：换算后的裸数值候选必须真能编出规则、且它的声明里带
  `var(--spacing)` 才改写 —— 所以 `text-[13px]` / `leading-*` / `rounded-*` 这些非
  spacing 家族一处不动（`text-[13px]` 与 `h-[22px]` 形态一样，按前缀猜就是把字号改成
  别的量纲）。换算前提（`--spacing` 仍是默认 0.25rem）由脚本自己断言，项目一旦重定义
  就直接报错退出。同时按 **P80** 把换算后才暴露的同值 `w-K` / `h-K` 合并成 `size-K`
  （`w-[10px] h-[10px]` 在方括号里时 P80 数不到，换成裸数值 `w-2.5 h-2.5` 就成了硬闸
  命中项）；只合并数字值，`w-full h-full` 这类关键字不在本次范围。
- **`WorkflowSubgraphNode.tsx` 的 TS 2783**：输出端口 Handle 的 `style` 里 `right` 被后置的
  spread 覆盖（`right: 5` 紧接 `...(ioEditMode ? { …, right: 0 } : { … })`），TS 报
  「此扩张将始终覆盖此属性」。改为把默认值并入 else 分支
  （`{ width: 10, height: 10, right: 5 }`），语义不变、歧义消失。
- 快照随类名同步：`TrainingStudio` / `FilmStudio` / `WorkflowEditorInner` 三个 `.snap`
  由 `vitest -u` 重生成（合并成 `size-*` 后排序位置会变，字符串替换同步不了）。

## Verified

- IDE 诊断：`src/components/studio/canvas/WorkflowSubgraphNode.tsx` 由
  1 error + 24 warning → **0**。
- `node scripts/check-ui-primitives.cjs` 0 处命中；三个受影响快照重生成后用例全过
  （7 passed）。
- `pnpm exec prettier --check src` 全绿（改写后 class 顺序仍合规）。
- 改写器幂等：连跑两次，第二次 0 处。

## Changed

- `docs/standards/03-样式与-tailwind.md` §3.1 由「四组」扩为「六组」，新增 important 后缀与
  `wrap-break-word`；并写清两类为什么**不进文本 codemod**：`!x` 与 JS 前缀否定同形（只能靠
  编辑器快速修复 + review 兜住），spacing 换算按前缀猜会改错量纲（改由
  `scripts/tw4-spacing-canonical.mjs` 用引擎判据扫平）。
- `scripts/tw4-canonical-codemod.cjs` 增加 `break-words` → `wrap-break-word` 规则。
- `docs/guides/DEV-QUERIES.md` §5 补 `break-words` 迁移、important 前缀自查 grep，以及
  `tw4-spacing-canonical.mjs` 的用法。
