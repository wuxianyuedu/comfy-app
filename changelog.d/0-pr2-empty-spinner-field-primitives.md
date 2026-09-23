## Added

- **补齐三件 shadcn 官方基元**（`pnpm dlx shadcn@latest add empty spinner field`）
  —— 落 `src/components/ui/{empty,spinner,field}.tsx`：`Empty` 提供
  `Empty / EmptyHeader / EmptyMedia / EmptyTitle / EmptyDescription /
EmptyContent` 六件套（居中虚线卡片骨架）；`Spinner` 是 lucide
  `Loader2Icon` + `animate-spin` + `role="status"` + `aria-label="Loading"`；
  `Field` 系提供 `Field / FieldLabel / FieldDescription / FieldError /
FieldGroup / FieldLegend / FieldSeparator / FieldSet / FieldContent /
FieldTitle` 十件套（`role="group"` + `has-[data-slot]` 精细样式）。
  CLI 生成的 import 走 `from "cn"`（shadcn v4 直连包名），三件都改回
  `from "~/lib/utils"` 与项目 20 个既有 shadcn 基元（`avatar.tsx` /
  `combobox.tsx` / `sidebar.tsx` / `badge.tsx` 等）一致——运行时完全等价
  （`~/lib/utils` 本身 `export { cn } from "cn"`），只是保持别名层约定。
  `add field` 命令默认询问是否覆盖 `label.tsx` / `separator.tsx`——**拒绝
  覆盖**（项目现有两份是历史定制版），CLI 自动跳过并只写入 `field.tsx`；
  `field.tsx` 内部 `import { Label } from "~/components/ui/label"` 与
  `import { Separator } from "~/components/ui/separator"` 直接复用项目
  已有版本。三件基元**自身不命中 P67 判据**：`empty.tsx` 用 `function
Empty(` + 末尾聚合 `export { ... }`，判据锚点要求 `export function
Empty\w*(` 才计；`field.tsx` 内部是 `<Label>` 大写组件（不是 `<label>`
  原生标签），判据 `<label[\s\S]{0,60}?htmlFor=` 不命中。

## Changed

- **`ui/page-loading.tsx` 的 `Spinner` 从自绘 `<span class="border-2
animate-spin rounded-full">` 改为 `~/components/ui/spinner` 的薄 re-export**
  （§16.2.3 P3 判据的合规方向、§12.18 复用优先）：a11y（`role="status"` /
  `aria-label="Loading"`）与 `animate-spin` 都下沉到基元，调用处 `className
="size-*"` 控尺寸即可。re-export 保留 `Spinner` 命名是为了**不打破**
  `confirm-dialog.tsx` 等既有 `import { Spinner } from
"~/components/ui/page-loading"` 的消费点，后续 PR 可逐条换到 `ui/spinner`
  直连。`PageLoading` 保留（组合 Spinner + 文案，是页面级形态、无对应基元）。
  **历史 ISSUE #720 的坑自动消失**：旧 `Spinner` 是 `<span>`，`<span>`
  默认 `display: inline`、`size-*` 对行内盒不生效，`EmptyState` 的
  `<span class="block">` 图标位画出来是 4×20 px 竖线；当时的解法是给
  `<span>` 自带 `inline-block`。换 lucide `Loader2Icon`（`<svg>`）之后
  `<svg>` 是 replaced element、天然块级、`size-*` 直接生效，与调用处
  display 无关。**page-loading.test.tsx 相应重写**：从「自带 inline-block」
  改为断言新契约（`data-slot` / `role="status"` / `aria-label` 三件 +
  `size-*` / `animate-spin` 同时挂）；jsdom 里 SVG 的 `className` 是
  `SVGAnimatedString` 对象，读 class 串要走 `getAttribute("class")`。

- **`ui/empty-state.tsx` 的 `page` / `error` 两档改为 `~/components/ui/empty`
  基元二次封装**（P67 d 治理，§16.2.3 / §12.18）：外层 `<Empty>` +
  `EmptyHeader` 包裹内容、`EmptyMedia` 承载图标（`className` 传 `text-primary`
  / `text-destructive`）、`EmptyTitle` / `EmptyDescription` 分别对应
  主/副文案、`EmptyContent` 承载操作区（覆盖 `flex-col` → `flex-row`）。
  `hint` 档**刻意保留自绘 `<div>`**：它是「行内小提示条」（挂在按钮组或
  段落区里说明「这里为什么是空的、下一步做什么」），与 `Empty` 的「居中
  虚线卡片」不同族；但文件已 `import Empty`，P67 d 子判据短路透零、不再
  计入。**外部 API 完全不变**（`title` / `description` / `icon` /
  `variant` / `action` / `minHeightClass` / `className`），调用点零改动。
  `empty-state.test.tsx` 现有 7 例（含「page：标题 / 说明 / 操作区都渲染，
  骨架居中带虚线框」的 DOM 结构断言）全部通过。

- **`ui/form-field.tsx` 内部 `<label htmlFor>` + `<p id>` + `<p>` 三件套
  改为 `~/components/ui/field` 基元二次封装**（P67 e 治理，§16.2.4.26 /
  §12.18）：外层 `<div>` → `<Field>`（`role="group"` 让 label + control +
  error 成为语义组），三件分别换成 `FieldLabel` / `FieldDescription` /
  `FieldError`（后者带 `role="alert"` live-region 播报、a11y 契约更完整）。
  **外部 API 完全不变**（`label` / `id` / `error` / `hint` / `required` /
  `children` render-prop / `className` / `labelClassName` /
  `errorClassName`）——15 处消费点（设置页 / 训练工作室 / 工作流导入面板 /
  工坊模型适配弹窗等）零改动。**保留的自绘细节**（`Field` 基元不管这两档）：
  必填 `*` 标记挂 `FieldLabel` 内、`aria-hidden`；项目色板
  `text-ink/80` / `text-danger-strong`（shadcn 通用档 `text-muted-foreground`
  / `text-destructive` 换过去视觉会漂），走 `className` 覆盖。
  `form-field.test.tsx` 现有 9 例（含「有错误时自动上 aria-invalid 与
  aria-describedby 的调用处不可能只写一个」）全部通过。

- **`scripts/.ui-primitives-baseline.json` 收紧**：P67 判据 6 → 4 处
  （棘轮只许降）。`empty-state.tsx` 与 `form-field.tsx` 从 files 中掉出；
  剩下 4 处对应后续 PR：`list-badge.tsx` / `status-badge.tsx`（P67 a Badge，
  PR-4 与已治理的 `task-type-chip` / `source-tag` 同族、可能给 Badge cva
  扩 size/tone）、`progress-bar.tsx`（P67 b，PR-3 基于已装 `Progress` 二
  次封装）、`range-slider.tsx`（P67 c，独立立项 + e2e 覆盖）。
