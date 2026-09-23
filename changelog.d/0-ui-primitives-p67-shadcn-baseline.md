## Added

- **`check-ui-primitives.cjs` 新增 P67「ui/ 层自造组件绕开已装 shadcn 基元」棘轮**
  （填 §16.2.3 与 §12.18 在 `ui/` 层的机器判据空档）：现有 P1~P66 全部守的是
  「**视图层**不自造原语」（`<button>` / `createPortal` / spinner / 剪贴板 / 手拼
  表单行 / …），`EXEMPT_DIRS` 里的 `/^src\/components\/ui\//` 恰恰把 `ui/` 整体
  豁免——于是 `ui/status-badge.tsx` 手写 `<span>` 徽章、`ui/progress-bar.tsx`
  手搓 `role="progressbar"`、`ui/range-slider.tsx` 用原生 `<input type="range">`
  这类**「明明装了 Badge / Progress / Slider 却绕开、各写一份」**完全没门禁
  能拦。2026-09-23 的一次审计（`outputs/comfy-app-t3-ui-wheel-reinvention-audit`）
  实测到 8 处真轮子，全部漏过。本条 P67 按**语义形态**取锚点、按**是否已
  import 相应基元**自动清零：

  - **Badge**：`export function X(Badge|Chip|Tag)` 且没 import `~/components/ui/badge`；
    以 `export function` 为形态锚点即可精准避开 shadcn 基元（`avatar.tsx` 的
    `function AvatarBadge`、`combobox.tsx` 的 `function ComboboxChip`、
    `sidebar.tsx` 的 `function SidebarMenuBadge` 都在文件末尾 `export { ..., X }`
    聚合导出、不写 `export function`）——**不用逐个基元走 EXEMPT_FILES**。
  - **Progress**：手写 `role="progressbar"` 且没用 shadcn Progress 也没直接引
    base-ui Progress；`ui/progress.tsx` 自身走 `ProgressPrimitive.Root`（base-ui
    自己挂 role）、源码不含字面 `role="progressbar"`，因此也不需 EXEMPT。
  - **Slider**：原生 `<input type="range">` 且没用 shadcn Slider 也没用 base-ui
    Slider；`ui/slider.tsx` 是 base-ui 复合控件，源码不含字面 `type="range"`。
  - **Empty**：`export function Empty\w*` 且没 import `~/components/ui/empty`。
    Empty 基元当前未装（`components.json` 里没有），此判据起点会先冻结
    `ui/empty-state.tsx` 一处；`pnpm dlx shadcn@latest add empty` + 二次封装后
    自动降为 0。
  - **Field**：手拼 `<label htmlFor=` 与 `aria-describedby` 的表单行且没 import
    `~/components/ui/field`。**aria-describedby 锚点同时吃两种写法**：JSX 属性
    （`aria-describedby="…"`）与 JS 对象键（`"aria-describedby": …`）——
    `ui/form-field.tsx` 通过 `{ "aria-describedby": errorId }` 透传，只吃前者会
    漏检真轮子；`ui/form.tsx`（shadcn 已装、react-hook-form 集成版）用大写
    `<Label htmlFor>` 组件而非小写 `<label>` 原生标签，判据 `<label[\s\S]{0,60}?htmlFor=`
    天然不命中、不需 EXEMPT_FILES 兜底。

  范围收窄走**新增的 `UI_ONLY_RULES` 集合**：与现有 `UI_ALSO_SCANNED`
  （「主战场在视图、`ui/` 顺带扫」）对偶，命中的判据**只在 `ui/` 里跑**。少了
  这层短路，视图层的 `WorkflowPickChip` / `ShotStatusBadge` / `EmptyStateHint`
  这类**消费 ui/ 基元的业务包装**会被大面积误伤（`export function X(Badge|Chip|Tag)`
  命名形态本来就在业务里普遍存在）。`collect()` 的分支必须**短路在下面三条
  skip 之前**：否则 `inUi && !UI_ALSO_SCANNED.has(id)` 会先把 `ui/` 文件
  continue 掉，`UI_ONLY_RULES` 反而永远扫不到自己该扫的那一层——这条顺序坑
  踩过一次（第一版把新判据加进 `UI_ALSO_SCANNED` 之外导致 `--report` 显示
  0 命中）。回归测试 `P67 范围收窄` 用例即锁这一形状。

  棘轮基线 `scripts/.ui-primitives-baseline.json` 起点写入 8 处真轮子
  （`status-badge` / `list-badge` / `source-tag` / `task-type-chip` /
  `progress-bar` / `range-slider` / `empty-state` / `form-field`），只许降；
  治理时逐条改基元二次封装 → `--update` 收紧。回归测试见
  `tests/check-ui-primitives.test.ts` 尾部 P67 段（10 例覆盖五条子判据的
  正向命中 / 合规者不误伤 / shadcn 内部函数不误伤 / UI_ONLY 范围收窄 /
  基线冻结后新增即阻断）。
