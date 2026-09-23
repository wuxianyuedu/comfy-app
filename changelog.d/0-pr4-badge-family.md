## Changed

- **`ui/badge.tsx` cva 加两条独立轴 `size` 与 `tone`**（§16.2.4.5 +
  §4.11.1 + P67 治理 PR-4 的地基）：徽章家族四个成员（`status-badge` /
  `list-badge` / `task-type-chip` / `source-tag`）此前**基座都是手写
  `<span>` 胶囊**——语义色映射表在 §4.11.1 的 ISSUE #672 整改里已 token
  化，但基座没跟上。本次把两条通用维度沉进 cva：
  - **`size`** = `default | sm | xs`（default 保持原 base 里 `h-5 / px-2 /
py-0.5 / rounded-4xl / text-xs`，不加类；sm 是密集行内元信息档
    `h-auto rounded-md px-1.5 py-0.5 text-[10px]`，与 PR-1 里
    `task-type-chip` / `source-tag` 手抄的 `CHIP_SHAPE` 同档；xs 是
    极窄列表行内小徽标档 `h-auto gap-0 rounded px-1 py-px text-[9px]
leading-tight`，正是原 `list-badge` 的内联尺寸）；
  - **`tone`** = `success | warning | danger | primary | neutral`
    （`bg-X/10 + text-X-strong + border-X/30` 五档，destructive 走
    `--color-destructive`，全部与 `status-badge` / `list-badge` 手抄
    映射表里的档位**同源**）。
    **向后兼容**：不传 `size` / `tone` 时两轴在 cva 里都是 undefined、不加
    类、只吃 `variant` + base 的原视觉——已有 30+ 处 `<Badge>` 消费点 0 影响。
    `Badge` 组件签名同时扩到接收 `tone` / `size` 两条 prop，向 `badgeVariants`
    透传。

- **`ui/status-badge.tsx` 从手写 `<span>` + STATUS_STYLES 表改为
  `<Badge tone=...>` 薄封装**（P67 判据 a 治理第 4 步）：本件**只剩一张
  业务映射表**——「SUCCEEDED / ACTIVE / PUBLISHED / READY / DONE → success；
  RUNNING → primary；QUEUED / PENDING / DRAFT / STARTING → warning；
  FAILED / ERROR / BANNED / STALE → danger；IDLE / DISABLED / INACTIVE /
  LOCKED → neutral」——这才是真正的**业务判据**（哪些状态字符串归哪档
  语义），与样式无关；其余全部交给 Badge 基座。`dot` 档保留（业务子件、
  Badge 里没有），是 `<span class="h-1.5 w-1.5 rounded-full bg-current
opacity-80">` 挂在文字前。**外部 API 完全不变**（`status` / `label` /
  `dot` / `className`），15 处消费点（`WorkflowRunLogModal` /
  `CanvasNode` / `VideoStudio.parts` / `ShotStudio` / `WorkflowLibraryList`
  / `GlobalStepLogPanel` / `ProjectOutputs` / `SettingsParts` / `NodesTab`
  / `StoryboardPlanner.parts` / `ResultCard` / `CanvasNodePrimitives` 等）
  0 改动。

- **`ui/list-badge.tsx` 从手写 `<span>` + TONE_CLASS 表改为
  `<Badge size="xs" tone=...>` 薄封装**（P67 判据 a 治理第 5 步）：本件
  只剩「`tone` prop 直通 Badge tone」这一层极薄的映射（`neutral` /
  `success` / `warning` / `danger` / `primary` 五档**同名直通**）。
  **无边框视觉**通过 `className="border-transparent"` 顶掉 Badge tone 的
  `border-X/30`（tailwind-merge 后传者胜）——不给 Badge 再加一条
  `bordered` 轴，那会是「只有一处用到」的过度泛化（§12.15「只有 1 个又
  看不出第二个的，先就地写、别急着抽象」）。`data-slot="list-badge"` 顺带
  去掉（全库 grep 只有本文件自引用、无消费点查这个 selector，Badge 基座
  自带 `state.slot="badge"`）。**外部 API 完全不变**（`tone` / `title` /
  `children` / `className`），ListBadgeTone 类型导出不变。

- **`scripts/.ui-primitives-baseline.json` 收紧**：P67 判据 3 → 1 处
  （棘轮只许降）。`status-badge.tsx` 与 `list-badge.tsx` 从 files 中掉出；
  剩下 **1 处**：`range-slider.tsx`（P67 c Slider）。文件头注释里已经
  自认这是「改动代价大」的例外——跟进 PR 独立立项迁移到已装的 `<Slider>`
  基座，配快照与 e2e 覆盖。P67 治理至此完成 8/8 中的 7/8。

## Notes

- **未来机会**：`ui/task-type-chip.tsx` 与 `ui/source-tag.tsx`（PR-1 已
  治理为 `<Badge variant="outline">` + 手抄 `CHIP_SHAPE` layout 覆盖）现在
  可以顺手把 `CHIP_SHAPE` 常量删掉、改成 `<Badge size="sm" ...>`——视觉
  完全等价（size.sm 与 CHIP_SHAPE 差一个 `border-transparent`，那是
  variant.outline 的边框顶掉、仍然必要）。但那是**优化 PR-1 已合规代码
  的写法**、不改变 P67 判据命中，可以留作独立 cleanup PR。本 PR 保守
  不动。
