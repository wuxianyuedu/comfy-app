// 工作流编辑器顶栏的样式判据（规范 17 §17.2 第①层：常量 + 纯派生，无 React）。单独成
// 模块的原因：ISSUE #404 里窄窗口下按钮被 flex 压成竖排断字（「编辑 IO」折成三行、
// 圆角不见）—— 「一排等宽按钮 + 文字可换行 + 可收缩」三者叠加的必然后果。退化顺序
// （宽度不足时按此让位，绝不压扁控件）：① 收内边距与图标间距 + 降一档字号（`md` 以下
// 生效）；② 面包屑里的工作流名与统计行截断；③ 整排按钮换到第二行。

/** 顶栏两态：常规（`md` 起）与紧凑（更窄的窗口）。 */
export type TopBarDensity = "regular" | "compact";

/** tailwind 断点：`md`（768px）。低于它顶栏切入紧凑态。 */
export const TOP_BAR_DENSITY_BREAKPOINT = "md";

/**
 * 按钮**任何状态下都必须带上**的类：不许换行、不许被 flex 压扁。`whitespace-nowrap`
 * 让压不下时整排换行（`flex-wrap`），而不是把「编辑 IO」拆成三行（ISSUE #404 的形态）；
 * `shrink-0` 挡住 flex 默认收缩（否则最后图标与文字重叠，按钮是可点目标不该被压）；`leading-none` 去掉图标行框的额外行距（否则按钮顶成 38px、纵向不居中）。
 */
export const TOP_BAR_BUTTON_BASE = "shrink-0 whitespace-nowrap leading-none";

/**
 * 各密度下的按钮尺寸类。紧凑态 = 内边距 16px→10px、字号 14px→12px、图标间距 6px→4px、
 * 纵向 8px→6px，一个按钮约省 22px 宽 / 6px 高、八个按钮合计约 180px —— 正是 ISSUE#404「较小尺寸按钮可适当缩小」的落点：窗口窄了让按钮变小，而不是让文字折行变形。
 * 两态写在同一字符串里（base 12px，`md` 起自动升回 14px），调用方只传 `"compact"`；断点判据集中在这里，视图里不再出现尺寸响应式类。
 */
const DENSITY_CLASS: Record<TopBarDensity, string> = {
  regular: "gap-1.5 px-4 py-2 text-sm",
  compact:
    `gap-1 px-2.5 py-1.5 text-xs ${TOP_BAR_DENSITY_BREAKPOINT}:gap-1.5 ${TOP_BAR_DENSITY_BREAKPOINT}:px-4 ${TOP_BAR_DENSITY_BREAKPOINT}:py-2 ${TOP_BAR_DENSITY_BREAKPOINT}:text-sm`.trim(),
};

/**
 * 覆盖 `ui/button` 基元的默认外观：顶栏按钮已全换成 `<Button>`（ISSUE #672 P1），但**尺寸与底盘**仍由本模块决定（基元默认的 `h-8`、`px-2.5`、`hover:bg-muted` 不属于
 * 顶栏那套退化设计）。每个 tone 显式带齐 `h-auto`/`px-0`（尺寸归 `DENSITY_CLASS`）、
 * `bg-transparent`（hover 底色由 tone 定）、`rounded-none`；⚠️ 覆盖串**必须排在 tone之前**：`cn()`（tailwind-merge）冲突时后面的类胜，否则圆角被消掉、按钮全变直角。
 */
const BUTTON_PRIMITIVE_OVERRIDE = "h-auto px-0 rounded-none bg-transparent";

/** 顶栏右侧按钮组：`gap-2` -> `gap-1.5`，与按钮内边距同向收缩。 */
const GROUP_GAP_CLASS: Record<TopBarDensity, string> = {
  regular: "gap-2",
  compact: `gap-1.5 ${TOP_BAR_DENSITY_BREAKPOINT}:gap-2`,
};

/**
 * 拼一个顶栏按钮的完整 class 串。
 * @param tone 按钮语义态（默认底 / 激活态 / 主按钮）；@param density 顶栏密度；
 * @param extra 该按钮自己的补充类（如 `disabled:opacity-40`）。
 */
export function topBarButtonClass(tone: TopBarTone, density: TopBarDensity, extra = ""): string {
  return [
    TOP_BAR_BUTTON_BASE,
    BUTTON_PRIMITIVE_OVERRIDE,
    DENSITY_CLASS[density],
    TOP_BAR_TONE_CLASS[tone],
    extra,
  ]
    .filter(Boolean)
    .map((part) => part.trim())
    .join(" ");
}

/**
 * 顶栏右侧按钮组的 class。`shrink-0` + 内层按钮各自的 `shrink-0` 保证这一排**整体不被
 * 压扁**；宽度真不够时由根容器的 `flex-wrap` 把整排换到第二行 —— 换行是「排布变化」，
 * 压扁是「控件变形」，只能选前者。
 */
export function topBarGroupClass(density: TopBarDensity): string {
  return `flex shrink-0 items-center ${GROUP_GAP_CLASS[density]}`;
}

/**
 * 面包屑区的最小宽度工具类。必须有的原因：面包屑里的工作流名带 `truncate`，min-content
 * 只有一两个字符宽，flex 于是认为这块「还能再压」，永远不会把按钮组挤到换行，按钮就被压到与面包屑重叠（实测去掉下限后 620px 时两块叠在一起）。取值贴着按钮组实测宽度取
 * 才不过早换行：`md` 以上按钮组 718px，整行最少 32 + 12 + 718 = 762px；地板 170px ≈返回箭头 30 + 间距 12 + 约 7 个中文字符的标题区（再窄名字已看不清）。
 */
export const TOP_BAR_BREADCRUMB_MIN_WIDTH_CLASS = "min-w-42.5";

/**
 * 顶栏左侧面包屑区的 class：可被压缩，但压缩的是这块、不是按钮。`flex-1` 让本块承担宽度
 * 协商的压力（配合内部标题的 `truncate`，这是设计内的退化）；`min-w-50` 是它的地板（见
 * `TOP_BAR_BREADCRUMB_MIN_WIDTH_CLASS` 的说明）—— 真正作用是让根容器的 `flex-wrap`能被触发，而不是无穷无尽地再压一点。
 */
export const TOP_BAR_BREADCRUMB_CLASS = `flex ${TOP_BAR_BREADCRUMB_MIN_WIDTH_CLASS} flex-1 items-center gap-3`;

/**
 * 顶栏根容器的 class。`flex-wrap` 是最后的兜底：窗口窄到按钮排不下（约 880px 以下）时
 * 把按钮组整排换到第二行，而不是让它叠在面包屑上、也不是把按钮压扁。`items-center`
 * 保持两行内容各自居中。
 */
export const TOP_BAR_ROOT_CLASS =
  "border-border-strong bg-panel flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-4 py-3";

/**
 * 按钮语义态 → 类。只承载「底盘 + 交互色」，尺寸与收缩规则一律走
 * `topBarButtonClass`，避免同一件事在两处各写一份（历史上的变形正是因为尺寸类散落在
 * 每个 `<button>` 上，改一处漏一片）。
 */
export type TopBarTone = "outline" | "solid" | "ghost" | "ioOn" | "ioPreviewOn";

const TOP_BAR_TONE_CLASS: Record<TopBarTone, string> = {
  /* 中性底盘：边框 + 半透明底，hover 提亮。 */
  outline:
    "border-border-strong bg-subtle text-ink-bright hover:bg-surface-2 rounded-lg border font-semibold transition-colors",
  /* 主按钮（保存）：实心品牌底。 */
  solid:
    "rounded-lg bg-primary-500 font-semibold text-primary-foreground transition-colors hover:bg-primary-600",
  /* 无底色的次级入口（调试开关）。 */
  ghost: "text-ink-soft hover:text-ink rounded-md font-medium transition-colors",
  /* 「编辑 IO」激活态：警告色高亮。 */
  ioOn: "rounded-lg border border-warning/60 bg-warning/20 font-semibold text-warning-strong transition-colors hover:bg-warning/30",
  /* 「预览 IO」激活态：信息色高亮。 */
  ioPreviewOn:
    "rounded-lg border border-info/60 bg-info/20 font-semibold text-info-strong transition-colors hover:bg-info/30",
};
