// 工作流编辑器顶栏的样式判据（规范 17 §17.2 第①层：常量 + 纯派生，无 React）。
//
// 为什么单独成模块：顶栏按钮此前在窄窗口下会被 flex 压缩成竖排断字
// （ISSUE #404：按钮文字「编辑 IO」折成三行、按钮不见圆角）。变形不是
// 某一个按钮的问题，而是「一排等宽按钮 + 文字可换行 + 可收缩」三件事叠在
// 一起的必然结果：一旦可用宽度小于按钮的自然宽度之和，每个按钮都被按
// flex-shrink 比例压扁，而 `white-space: normal` 让文字改行去适应压扁后的
// 宽度，行高随之翻倍。
//
// 退化的顺序（宽度不足时按此顺序让位，绝不压扁控件）：
//   ① 收内边距与图标间距 + 降一档字号（`md` 以下生效，`md` 起回升）
//   ② 面包屑里的工作流名与统计行截断（它们本来就有省略号语义）
//   ③ 整排按钮换到第二行（根容器 `flex-wrap`）
//
// 判据放在这里（规范 17 §17.2 第①层：常量 + 纯派生，无 React），视图只
// 消费返回值、测试直接断言字符串。

/** 顶栏两态：常规（`md` 起）与紧凑（更窄的窗口）。 */
export type TopBarDensity = "regular" | "compact";

/** tailwind 断点：`md`（768px）。低于它顶栏切入紧凑态。 */
export const TOP_BAR_DENSITY_BREAKPOINT = "md";

/**
 * 按钮**任何状态下都必须带上**的类：不许换行、不许被 flex 压扁。
 *
 *   - `whitespace-nowrap`：文字是一整块，压不下就真换行（`flex-wrap`）而
 *     不是把「编辑 IO」拆成三行。缺了它，按钮会变成竖排字条——这正是
 *     ISSUE #404 里的形态。
 *   - `shrink-0`：flex 的默认 `flex-shrink: 1` 允许多余宽度按比例从每个
 *     按钮身上抠，抠到最后图标与文字互相重叠。按钮是可点目标，不该被压。
 *   - `leading-none`：图标（emoji / lucide）的行框比中文字号高，默认行高会
 *     把按钮顶成 38px 高、纵向不居中；去掉行框的额外行距后，中英文与图标
 *     在同一基线上。
 */
export const TOP_BAR_BUTTON_BASE = "shrink-0 whitespace-nowrap leading-none";

/**
 * 各密度下的按钮尺寸类。
 *
 * 紧凑态 = 收窄内边距（16px → 10px）+ 字号降一档（14px → 12px）+ 图标间距
 * 收紧（6px → 4px）+ 纵向内边距收紧（8px → 6px）。一个按钮约省 22px 宽、
 * 6px 高，八个按钮合计约 180px——正是 ISSUE #404 里「较小尺寸按钮可适当
 * 缩小」的落点：窗口窄了让按钮变小，而不是让文字折行变形。
 *
 * 两态写在同一个字符串里（而不是 `compact` 只出小尺寸类）是为了让调用方
 * 无脑传 `"compact"`：base 是 12px，`md` 起自动升回 14px。断点判据集中在
 * 这里，视图里不再出现任何尺寸响应式类。
 */
const DENSITY_CLASS: Record<TopBarDensity, string> = {
  regular: "gap-1.5 px-4 py-2 text-sm",
  compact:
    `gap-1 px-2.5 py-1.5 text-xs ${TOP_BAR_DENSITY_BREAKPOINT}:gap-1.5 ${TOP_BAR_DENSITY_BREAKPOINT}:px-4 ${TOP_BAR_DENSITY_BREAKPOINT}:py-2 ${TOP_BAR_DENSITY_BREAKPOINT}:text-sm`.trim(),
};

/**
 * 覆盖 `ui/button` 基元的默认外观。
 *
 * 顶栏按钮现已全部换成 `<Button>`（ISSUE #672 P1），但它的**尺寸与底盘**仍
 * 由本模块决定：顶栏在窄窗口下的退化顺序是专门设计过的（见文件头），基元默认
 * 的 `h-8`、`px-2.5` 与 `ghost` 的 `hover:bg-muted` 都不属于那套设计。
 *
 * 每个 tone 都显式带齐这一串：
 *
 *   · `h-auto` —— 高度归还给 `DENSITY_CLASS` 的 `py`（规范 16 §16.2.4.2 第 3 条）；
 *   · `px-0`   —— 横向内边距同理归还给 `px-*`；
 *   · `bg-transparent` —— ghost 的 hover 底色不许自带，hover 由 tone 决定；
 *   · `rounded-none` —— 圆角由 tone 决定（并且**必须写在 tone 之前**，见下）。
 *
 * ⚠️ **`rounded-none` 的位置是有讲究的**：`cn()` 走 tailwind-merge，同一属性
 * 冲突时**后面的类胜**。tone 里的 `rounded-md` / `rounded-lg` 是真正想要的圆角，
 * 但若把 `rounded-none` 排在它们之后，被消掉的会是 tone 的那一个 —— 顶栏按钮
 * 于是全部变成直角。所以这一串必须排在 tone **之前**（`topBarButtonClass` 的
 * 拼装顺序即为此：base → 覆盖串 → 密度 → tone），让 tone 赢。
 * 契约测试 `workflow-editor-topbar-config.test.ts` 逐个 tone 钉住这三件事：
 * 覆盖串在场、tone 的圆角在场、且 tone 的圆角在覆盖串之后。
 */
const BUTTON_PRIMITIVE_OVERRIDE = "h-auto px-0 rounded-none bg-transparent";

/** 顶栏右侧按钮组：`gap-2` -> `gap-1.5`，与按钮内边距同向收缩。 */
const GROUP_GAP_CLASS: Record<TopBarDensity, string> = {
  regular: "gap-2",
  compact: `gap-1.5 ${TOP_BAR_DENSITY_BREAKPOINT}:gap-2`,
};

/**
 * 拼一个顶栏按钮的完整 class 串。
 *
 * @param tone           按钮语义态（默认底 / 激活态 / 主按钮）
 * @param density        顶栏密度（常规 / 紧凑）
 * @param extra          该按钮自己的补充类（如 `disabled:opacity-40`）
 */
export function topBarButtonClass(
  tone: TopBarTone,
  density: TopBarDensity,
  extra = "",
): string {
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
 * 顶栏右侧按钮组的 class。
 *
 * `shrink-0` + 内层按钮各自的 `shrink-0` 保证这一排**整体不被压扁**；宽度
 * 真不够时由根容器的 `flex-wrap` 把整排换到第二行——换行是「排布变化」，
 * 压扁是「控件变形」，只能选前者。
 */
export function topBarGroupClass(density: TopBarDensity): string {
  return `flex shrink-0 items-center ${GROUP_GAP_CLASS[density]}`;
}

/**
 * 面包屑区的最小宽度工具类。
 *
 * 为什么必须有：面包屑里的工作流名带 `truncate`，它的 min-content 只有一
 * 两个字符宽——flex 于是认为这一块「还能再压」，永远不会把按钮组挤到换行，
 * 按钮就被压到与面包屑重叠（实测：去掉下限后 620px 时两块叠在一起）。
 *
 * **取值要贴着按钮组的实测宽度取**，否则会过早换行：按钮组在 `md` 以上是
 * 718px（常规态），整行最少要 `32（左右内边距）+ 12（组间距）+ 718 =
 * 762px` 留给按钮组，再加上这块的地板才是换行门槛。地板取 170px ≈
 * 返回箭头 30 + 间距 12 + 约 7 个中文字符的标题区——名字到这个宽度已经
 * 看不清，确实该让位给按钮了。
 */
export const TOP_BAR_BREADCRUMB_MIN_WIDTH_CLASS = "min-w-42.5";

/**
 * 顶栏左侧面包屑区的 class：可被压缩，但压缩的是这块、不是按钮。
 *
 * `flex-1` 让本块承担宽度协商的压力（配合内部标题的 `truncate` 截断，
 * 这是设计内的退化）；`min-w-50` 是它的地板，见
 * `TOP_BAR_BREADCRUMB_MIN_WIDTH_CLASS` 的说明——地板的真正作用是让根容器
 * 的 `flex-wrap` 能被触发，而不是无穷无尽地再压一点。
 */
export const TOP_BAR_BREADCRUMB_CLASS = `flex ${TOP_BAR_BREADCRUMB_MIN_WIDTH_CLASS} flex-1 items-center gap-3`;

/**
 * 顶栏根容器的 class。
 *
 * `flex-wrap` 是最后的兜底：窗口窄到按钮排不下（约 880px 以下）时把按钮组
 * 整排换到第二行，而不是让它叠在面包屑上、也不是把按钮压扁。`items-center`
 * 保持两行内容各自居中。
 */
export const TOP_BAR_ROOT_CLASS =
  "border-border-strong flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-4 py-3 backdrop-blur-md";

/**
 * 按钮语义态 → 类。
 *
 * 只承载「底盘 + 交互色」，尺寸与收缩规则一律走 `topBarButtonClass`，
 * 避免同一件事在两处各写一份（历史上的变形正是因为尺寸类散落在每个
 * `<button>` 上，改一处漏一片）。
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
  ghost:
    "text-ink-soft hover:text-ink rounded-md font-medium transition-colors",
  /* 「编辑 IO」激活态：警告色高亮。 */
  ioOn: "rounded-lg border border-warning/60 bg-warning/20 font-semibold text-warning-strong transition-colors hover:bg-warning/30",
  /* 「预览 IO」激活态：信息色高亮。 */
  ioPreviewOn:
    "rounded-lg border border-info/60 bg-info/20 font-semibold text-info-strong transition-colors hover:bg-info/30",
};
