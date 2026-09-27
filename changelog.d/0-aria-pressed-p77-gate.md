## Added

- **UI 基元棘轮新增 P77「视图层手写 `aria-pressed`」（棘轮，`scripts/check-ui-primitives.cjs`）**：
  shadcn `forms.md`：`Option sets (2–7 choices) use ToggleGroup. Don't loop
  Button with manual active state.` 项目里 `~/components/ui/toggle-group`
  装了（shadcn base-nova 版，内部走 Base UI `ToggleGroup` / `ToggleGroupItem`），
  但视图层里出现 `aria-pressed={cond}` = 这个文件在**手写一份"哪一个是选中"
  的状态契约**。`aria-pressed` 是 toggle 语义的 ARIA 硬要求，Base UI 的
  `ToggleGroupItem` 会自己打这一份、并给键盘 / 读屏器 / `data-state="on|off"`
  一致的样式；手写 `<Button aria-pressed>` 循环少了这一层：读屏器只能听到
  "按下"但拿不到组内互斥关系（`role="group"` 与 `aria-labelledby` 都得手写）、
  视觉的 active 态也得每处 `className={\`${cond ? A : B}\`}` 重抄。
  锚点按形态取（`aria-pressed\s*=` 字面量）。`ui/toggle-group.tsx` 是这条账
  要收口的唯一实现、`ui/` 走 `EXEMPT_DIRS` 天然豁免；`ui/image-viewer.tsx`
  里的两处 `aria-pressed` 是**项目自定义基元**内部的形态（视图模式切换器），
  也在豁免范围内、视图层不该学它。

  走棘轮（非硬闸）：本批评据上线时视图层实测 **6 文件 7 处** 存量（
  `RgthreeBodies.tsx`、`FilmStudio.tsx` ×2、`LogFilterBar.tsx`、
  `SizePresetTableModal.tsx`、`LlmLocalSection.tsx`、`UsageTestDialog.tsx`），
  `--update` 冻结起点、只许降。下一批按域分片把每个循环 `<Button
  aria-pressed>` 迁到 `<ToggleGroup>` + `<ToggleGroupItem>`，与 P71 / P76 /
  P78 引入节奏一致（先冻结、后治理）。

  差分回归 3 例见 `tests/check-ui-primitives.test.ts`：视图手写 aria-pressed
  阻断 / `ui/toggle-group.tsx` 豁免 / 无 aria-pressed 的普通 `<Button>` 不误伤。

  **P77 号回填**：这条填 P76（原生 `<select>`）与 P78（裸 `<label>`）之间
  的跳空位。P73 / P74 / P75 三条（Separator / Alert / EmptyState）判据的
  锚点还需要打磨（`border-dashed` / `border-t` 混合体，合法与手写的形态需要
  再分辨一层），留下一批。
