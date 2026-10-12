#!/usr/bin/env node
// @ts-nocheck -- UI 基元判据的规则表分片：P67 ~ P86（ui 层自身 / 表单与 token / 服务端出口 / 近几批接上的基元）
/**
 * `ui-primitives-rules.cjs` 的规则表分片（ISSUE #1811）。
 *
 * 85 条判据的 `count` 实现合计 2754 行 —— 按 R5「单文件超 900 行须拆」的尺子，
 * 一张表放不下，于是按 P 编号区间切成四份；四份都是**同构的对象片段**，
 * 由 `ui-primitives-rules.cjs` 用 `{...a, ...b}` 合并成 `RULES`。
 *
 * 切法只跟**编号区间**走（不按档位）：档位表 `RULE_TIER_IDS` 是另一维度，
 * 把它和「实现住在哪一份」绑在一起，会让「改判据所属档位」变成跨文件搬家。
 * 合并顺序即对象键顺序，与拆分前逐字一致。
 */
const {
  stripCommentsCached,
  stripP71AllowBlocks,
  countNestedMinMax,
  countNonContainment,
  scanJsxAttrs,
  readJsxAttrsPastTag,
  parseJsxProps,
  countButtonTitle,
  isBusySlotName,
  isP81IconName,
} = require("./ui-primitives-engine.cjs");


module.exports = {
  P67: {
    label:
      "ui/ 层自造组件绕开已装 shadcn 基元（Badge / Progress / Slider / Empty / Field —— 规范 §16.2.3 / §12.18）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      let hits = 0;

      /* a. Badge 绕开：`export function X(Badge|Chip|Tag)` 命名形态，且没
       *    import `~/components/ui/badge`。shadcn 已装基元（avatar/combobox/
       *    sidebar）内部的 `function AvatarBadge` / `function ComboboxChip` /
       *    `function SidebarMenuBadge` 都**不带 export function**（只在文件
       *    末尾 `export { ... }` 聚合导出），判据以 `export function` 为形态
       *    锚点即可精准避开——不用逐个基元走 EXEMPT_FILES。
       *    实测 2026-09-23：命中 status-badge / list-badge / source-tag /
       *    task-type-chip 四处真轮子；badge.tsx 自身（`function Badge`）不命中。 */
      if (
        !/from ["']~\/components\/ui\/badge["']/.test(t2) &&
        /export function \w*(?:Badge|Chip|Tag)\s*\(/.test(t2)
      )
        hits++;

      /* b. Progress 绕开：手写 `role="progressbar"` 却没用 shadcn Progress
       *    也没直接引 base-ui Progress。`ui/progress.tsx` 自身走的是
       *    `ProgressPrimitive.Root`（base-ui 会自己挂 role），源码里不含
       *    字面 `role="progressbar"`——因此不需 EXEMPT_FILES。 */
      if (
        !/from ["']~\/components\/ui\/progress["']/.test(t2) &&
        !/from ["']@base-ui\/react\/progress["']/.test(t2) &&
        /role=["']progressbar["']/.test(t2)
      )
        hits++;

      /* c. Slider 绕开：原生 `<input type="range">` 却不用 shadcn Slider。
       *    `ui/slider.tsx` 自身是 base-ui 复合控件，源码里不含字面
       *    `type="range"`（已实测）。 */
      if (
        !/from ["']~\/components\/ui\/slider["']/.test(t2) &&
        !/from ["']@base-ui\/react\/slider["']/.test(t2) &&
        /type=["']range["']/.test(t2)
      )
        hits++;

      /* d. Empty 绕开：`export function Empty*` 命名形态。`ui/empty.tsx` 已装
       *    （Empty / EmptyHeader / EmptyTitle / EmptyDescription / EmptyMedia /
       *    EmptyContent，业务侧已有多处消费），所以这条没有「起点」可言，须为 0。
       *    ⚠️ 别拿 `components.json` 当安装判据：它只有 aliases / registries 这些
       *    配置键，**不记录装过哪些组件**（本条原先就以「里面没有 empty」为据把
       *    判据放软过，那个前提从来不存在）。安装与否看磁盘：`ui/empty.tsx`。 */
      if (
        !/from ["']~\/components\/ui\/empty["']/.test(t2) &&
        /export function Empty\w*\s*\(/.test(t2)
      )
        hits++;

      /* e. Field 绕开：手拼 `<label htmlFor=` 与 `aria-describedby=` 的表单
       *    行 —— `ui/field.tsx` 已装（Field / FieldSet / FieldGroup / FieldContent /
       *    FieldTitle / FieldLabel / FieldDescription / FieldError / FieldSeparator /
       *    FieldLegend），本仓库的薄封装是 `ui/form-field.tsx`，两条都算「用了基元」。
       *    当年列进起点名单的那两条，现在这样定性：
       *      · `ui/form-field.tsx`（真轮子，见 outputs 审计报告 A5）—— 它就是被
       *        本条要替换掉的那一侧，靠 `ui/form-field` 治理批次清零；
       *      · `ui/form.tsx`（shadcn 已装、react-hook-form 集成版，
       *        `FormLabel` 就是 `<Label htmlFor>` + 内部挂 `aria-describedby`）
       *        —— 走 EXEMPT_FILES 显式豁免（它是**已装基元**，不算轮子）。
       *    aria-describedby 的锚点**必须同时吃两种写法**：JSX 属性
       *    （`aria-describedby="…"`）与 JS 对象键（`"aria-describedby": …`
       *    —— form-field.tsx 通过 a11y 对象把三条 aria-* 透传给 children，
       *    只有后者），否则真轮子会漏检。 */
      if (
        !/from ["']~\/components\/ui\/field["']/.test(t2) &&
        /<label[\s\S]{0,60}?htmlFor=/.test(t2) &&
        /aria-describedby["']?\s*[:=]/.test(t2)
      )
        hits++;

      return hits;
    },
  },

  /* ── P68「视图层手写 `<input>` 或 `<textarea>`」（硬闸，§16.2.3 / §12.18）─────
   * P67 是 ui/ 层判据（UI_ONLY_RULES），P68/P69 是**视图层**判据（默认作用域：
   * view + app + server，`ui/` `hooks/` `lib/` 走原有 EXEMPT_DIRS 短路）。
   * 2026-09-23 治理 settings/ 目录 9 处 raw input 之后，全库还剩约 40 处
   * 视图层轮子（workshop / studio / login / model 等）；本条按棘轮冻结起点、
   * 后续按域分片治理。
   *
   * 锚点分两半：
   *   ① 显式 `type="text|number|password|url|email|search|tel"` 的 `<input>`
   *     （`type` 属性可能换行、用 `[\s\S]{0,80}` 窗口匹配）；
   *   ② `<textarea>`（本项目 textarea 一律走 `ui/textarea`，无正当原生
   *     落点）。
   *
   * 未列 `<input>` 无 type（默认 text）与 `type="file"`：前者实测视图层没有
   * 出现（都写了显式 type）、判据先保守；后者由 P7（file-picker 硬闸）管，
   * 不重复计。`type="checkbox|radio"` 走 P69。
   *
   * 已 import `~/components/ui/{input,textarea,number-field}` 的文件短路
   * 清零（换用基元即自动合规）。 */
  P68: {
    label:
      "视图层手写 <input> 或 <textarea>（应使用 ~/components/ui/{input,textarea,number-field}）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      if (
        /from ["']~\/components\/ui\/(?:input|textarea|number-field)["']/.test(
          t2,
        )
      )
        return 0;
      const inputs =
        t2.match(
          /<input[\s\S]{0,80}type=["'](?:text|number|password|url|email|search|tel)["']/g,
        ) || [];
      const textareas = t2.match(/<textarea[\s\n>]/g) || [];
      return inputs.length + textareas.length;
    },
  },

  /* ── P69「视图层手写 `<input type="checkbox|radio">`」（硬闸，§16.2.3 / §12.18）
   * shadcn `ui/checkbox.tsx` 与 `ui/radio-group.tsx` 早已装（PR #925 拉齐到
   * 最新形态），但视图层仍有多处原生 `<input type="checkbox">` + `accent-*`
   * 着色档——浏览器 OS 级控件、深色主题下勾选态与整站焦点档不协调、
   * `accent-color` 跨浏览器渲染不一致。本条按棘轮冻结起点、后续按域分片治理。
   *
   * 已 import `~/components/ui/{checkbox,radio-group}` 的文件短路清零。 */
  P69: {
    label:
      "视图层手写 <input type=checkbox|radio>（应使用 ~/components/ui/{checkbox,radio-group}）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      if (/from ["']~\/components\/ui\/(?:checkbox|radio-group)["']/.test(t2))
        return 0;
      return (
        t2.match(/<input[\s\S]{0,80}type=["'](?:checkbox|radio)["']/g) || []
      ).length;
    },
  },

  /* ── P70「视图层用 space-y-N / space-x-N」（硬闸，shadcn styling.md）─────
   * shadcn `styling.md` 明确「No `space-x-N` or `space-y-N`. Use `flex` with
   * `gap-*`.」`space-y-N` 靠给子元素加 `margin-top`（`:not(:last-child) > *`
   * 选择器）实现间距，与 flex / grid 的 `gap` 是两套机制——混用会让
   * 「改间距」要同时找 `space-y-*` 与 `gap-*` 两种写法，且 `space-y-*` 在
   * 嵌套 flex 容器里会被父级的 `gap` 叠加出非预期间距。
   * 2026-09-24 一次治理把全库 107 处 `space-y-*` 清零，本条从此是硬闸。 */
  P70: {
    label:
      "视图层用 space-y-* / space-x-*（应使用 flex + gap-*，shadcn styling.md）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      return (t2.match(/space-[xy]-\d/g) || []).length;
    },
  },

  /* ── P71「视图层手写 dark:palette 色（应走语义 token）」（硬闸，§4.11.1）───
   * shadcn `styling.md`「No manual `dark:` color overrides. Use semantic
   * tokens」+ 规范 §4.11.1「映射表里的颜色也必须走语义 token」。项目的
   * `--color-success` / `--color-warning` / `--color-destructive` 几类
   * `--color-primary-*` 等 token 内部已含深浅两态，写 `text-amber-700
   * dark:text-amber-400` 这种「字面量 + 手写 dark:」等于把同一件事在明暗
   * 两处各写一遍，改主题跟不动。
   *
   * 锚点：`dark:` 前缀 + Tailwind 调色板色名 + 数字档位（覆盖
   * `dark:text-red-400` 这类红 / `dark:bg-emerald-500/15` 这类绿 /
   * `dark:border-amber-*` 这几条字面量）。`text-ink-*` / `bg-subtle` / `text-muted-foreground` 这类语义类
   * 不含调色板色名 + 数字档，天然不命中。
   *
   * 例外块：`// p71-allow:start <一句话理由>` 与 `// p71-allow:end` 之间的
   * 代码整段不计入 P71。用于 §3.6.1 文档化例外——palette 字面量本身就是
   * 语义（例如 ANSI SGR 终端 8 色，代表 terminal color identity、不是主题
   * 状态色），不能被 token 化；用它比留一堆永久基线债更诚实。理由文本
   * 写短、写具体，别拿它当「随手关掉一条判据」的逃生口。
   *
   * 棘轮（非硬闸）：2026-09-24 全界面扫网实测视图层 230 处存量，本批折叠
   * log-level 色系统后冻结为 215 处起点、只许降。「精确等值」的状态文字
   * （text-amber-700/red-700 配 dark:）已在本批折叠；其余（状态底色
   * bg/border、品牌紫 violet→primary、类型青 cyan）token 值非精确等值、
   * 需逐案视觉核对，按域分片降基线。 */
  P71: {
    label:
      "视图层手写 dark:palette 色（应走语义 token，shadcn styling.md / §4.11.1）",
    count: (t) => {
      const t2 = stripCommentsCached(stripP71AllowBlocks(t));
      return (
        t2.match(
          /dark:(?:bg|text|border|ring|from|to|shadow|fill|stroke|outline|decoration|accent|caret|divide|placeholder|file|space)-\[?[a-z-]*?(?:emerald|green|rose|red|amber|sky|cyan|violet|blue|purple|fuchsia|indigo|teal|lime|orange|yellow)-[0-9]/g,
        ) || []
      ).length;
    },
  },

  /* ── P72「模态无可访问名」（硬闸，shadcn composition.md / WCAG 4.1.2）─────
   * `<DialogContent>` / `<SheetContent>` 打开的模态必须能被读屏器播报"这是
   * 什么面板"。base-ui（Radix 同）在缺少标题时不会自动补 aria-labelledby，
   * 用户进入模态只能听到"对话框"、上下文完全丢失。合规写法二选一：
   *   · 组件树里放 `<DialogTitle>` / `<SheetTitle>`（可以是 sr-only）；
   *   · 在 `<DialogContent>` / `<SheetContent>` 上直接给 `aria-label` 或
   *     `aria-labelledby`。
   * 本仓库形态约定是「自绘 header + 关闭」，多数落点走第二条；两种都放行。
   *
   * 判据按**标签块**扫（`<DialogContent` … `</DialogContent>`、
   * `<SheetContent` … `</SheetContent>`），块内既无对应 Title 组件又无
   * aria-label/labelledby 即计 1。`ui/` 层通过 EXEMPT_DIRS 短路（基元自身
   * 是这些标签的实现处、不该被自己扫到）。 */
  P72: {
    label:
      "视图层 <DialogContent>/<SheetContent> 缺可访问名（应加 <DialogTitle>/<SheetTitle> 或 aria-label/aria-labelledby，shadcn composition.md）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      let n = 0;
      for (const [open, close, nameRe] of [
        ["<DialogContent", "</DialogContent>", /<DialogTitle\b/],
        ["<SheetContent", "</SheetContent>", /<SheetTitle\b/],
      ]) {
        let cursor = 0;
        while (true) {
          const start = t2.indexOf(open, cursor);
          if (start < 0) break;
          const end = t2.indexOf(close, start);
          if (end < 0) {
            cursor = start + open.length;
            continue;
          }
          const block = t2.slice(start, end);
          if (
            !/aria-label\s*=|aria-labelledby\s*=/.test(block) &&
            !nameRe.test(block)
          ) {
            n++;
          }
          cursor = end + close.length;
        }
      }
      return n;
    },
  },

  /* ── P73「视图层自闭合 <div className="border-t">」（硬闸，shadcn composition.md）──
   * shadcn `composition.md`：`Use Separator instead of <hr> or
   * <div className="border-t">.`
   *
   * 视图里出现「**自闭合** `<div>` + className 含 `border-{t|b|l|r}`」=
   * 用 border 手搓了一条线、该走 `~/components/ui/separator` 的 `<Separator>`。
   * 与含子内容的卡片结构边框（`<div className="border-t ...">文字…</div>`）
   * 区分开——那种是"容器边框的一部分"、不是分隔线、不该被算。锚点**必须
   * 要求自闭合**（`/>` 收尾、无 children）。
   *
   * 本会话内一次治理 4 处清零（SectionHeader / GroupedControls /
   * IoEndpointsSection ×2 · 全是 `flex-1 border-t border-dashed` 类虚线
   * 填充线 · 迁 `<Separator className="... border-dashed bg-transparent
   * h-0/h-px" />` 保留原视觉）· 直接进硬闸。 */
  P73: {
    label:
      '视图层自闭合 <div className="border-{t|b|l|r}">（应使用 ~/components/ui/separator 的 <Separator>，shadcn composition.md）',
    count: (t) => {
      const t2 = stripCommentsCached(t);
      /* 自闭合 div + className 含 border-{t|b|l|r}。用 `[^>]*?/>` 而非
       * `[^/>]*?/>` 是因为 className 值可能带 `/`（如 `w-1/2`），但 `>`
       * 是硬边界、不能跨。 */
      return (
        t2.match(
          /<div\b[^>]*?className="[^"]*\bborder-[tblr]\b[^"]*"[^>]*?\/>/g,
        ) || []
      ).length;
    },
  },

  /* ── P75「视图层手搓空态卡」（硬闸，shadcn composition.md · Empty 基元）───
   * `pnpm dlx shadcn@latest add empty` 已装 `~/components/ui/empty.tsx`
   * （`<Empty>` + `EmptyHeader/Title/Description/Content/Media` 组合）、
   * 项目自立 `~/components/ui/empty-state.tsx`（`<EmptyState>` · page/error/hint
   * 三档 · 是官方 Empty 的薄封装 · 补 icon 位与最小高度）。视图层里出现
   * 「自闭合之外、className 含 border-dashed + rounded-(xl|2xl|3xl)、含子文本、
   * 无 onClick / cursor-pointer」= 手搓了一张"这里现在是空的"占位卡、该走
   * `<EmptyState>` 或 `<Empty>` 组合。
   *
   * 判据是**三重条件**、少一条都不算：
   *   ① className 里 `border-dashed` + `rounded-(xl|2xl|3xl)` 双有；
   *   ② **非自闭合**（自闭合的是 P73 那条虚线、或 flex-1 装饰填充线）；
   *   ③ className 里**不含** `cursor-pointer`、inner 里**不含** `onClick=`
   *     （排除"点击添加占位卡"这类合法交互 · HomePage 里"新建项目" dashed
   *     按钮就是这种）；
   *   ④ inner trim 后至少 5 字符（排除装饰性空 div）。
   *
   * 走棘轮（非硬闸）：本会话摸底命中 12 处（都是清晰"空态卡"· 见
   * `changelog.d/0-session-final`）· 冻结起点。下一批按域分片把每个
   * `<div>` 迁到 `<EmptyState variant="page" title="…" description="…" />`
   * 或 `<Empty>` 组合 · 清零后独立 PR 升硬闸。
   *
   * P74 编号跳过：`bg-X/N + text-X-strong` 组合锚点在本仓库**命中 0** ·
   * 手搓 callout 里同用两件事的模式稀有 · 判据立起来会变"死判据"（无假阳 ·
   * 也几乎无真命中）· 若将来发现真需要 · 由更精的 AST 扫描器做 · 不塞进
   * 这条正则棘轮。 */
  P75: {
    label:
      '视图层手搓空态卡 `<div className="border-dashed rounded-xl/2xl/3xl">`（应使用 ~/components/ui/empty-state 的 <EmptyState> 或 ~/components/ui/empty 的 <Empty>，shadcn composition.md）',
    count: (t) => {
      const t2 = stripCommentsCached(t);
      let n = 0;
      /* 扫每个 `<div>` 起始标签 · 三重条件命中才计一次。 */
      const openRe = /<div\b([^>]*)>/g;
      for (const open of t2.matchAll(openRe)) {
        const attrs = open[1];
        /* 排除自闭合（`/` 结尾 · 那是 P73 虚线的账）。 */
        if (attrs.trimEnd().endsWith("/")) continue;
        const cm = attrs.match(/className=["']([^"']+)["']/);
        if (!cm) continue;
        const cls = cm[1];
        if (!/\bborder-dashed\b/.test(cls)) continue;
        if (!/\brounded-(?:xl|2xl|3xl)\b/.test(cls)) continue;
        if (/\bcursor-pointer\b/.test(cls)) continue;
        /* 找匹配的 </div> · 简化：从 open.index 起、扫第一个 </div> ·
         * 不递归嵌套（视图里"空态卡"极少嵌套同层 div · 简化足够）。 */
        const after = t2.slice(open.index + open[0].length);
        const close = after.indexOf("</div>");
        if (close < 0) continue;
        const inner = after.slice(0, close);
        if (/\bonClick=/.test(inner)) continue;
        /* 装饰性空 div（padding 或 min-h 撑位）不算。 */
        if (inner.trim().length < 5) continue;
        n++;
      }
      return n;
    },
  },

  /* ── P76「视图层裸写 <select>」（硬闸，规范 §16.2.3 / §12.18）───────────
   * P68 拦住了裸 `<input>` / `<textarea>`、P69 拦住了裸
   * `<input type=checkbox|radio>`；`<select>` 是同一族里的漏项。
   * 项目里已有两个合规出口：
   *   · `~/components/ui/native-select` 的 `<NativeSelect>`（保留原生外观 +
   *     统一样式与 a11y 契约）
   *   · `~/components/ui/select-menu` 的 `<SelectMenu>`（Base UI 派，与
   *     项目里其它富 ReactNode 标签的下拉同一口径）
   * 视图里出现 `<select` = 这个文件在**第三处**手拼同一件事。
   *
   * 判据按形态取（`<select` 标签字面量），只看视图与业务落点：
   * `ui/native-select.tsx` 是这条账要收口的唯一实现、走 EXEMPT_DIRS 天然豁免。
   *
   * 走棘轮（非硬闸）：本批评据上线时视图层实测 13 处存量，冻结起点、
   * 只许降。下一批按域分片把每个 `<select>` 迁到上述两个出口之一，
   * 与 P71 的引入节奏一致（先冻结、后治理）。
   *
   * P72 / P76 编号跳空是**有意**的：P73 / P74 / P75 预留给 Separator /
   * Alert / EmptyState 三条同批的判据、下一批落地；本批只做「模态可访问名
   * （硬闸，#993）」与「原生 select（棘轮，本条）」两条最独立、迁移路径最
   * 明确的判据。 */
  P76: {
    label:
      "视图层裸写 <select>（应使用 ~/components/ui/native-select 的 NativeSelect 或 ~/components/ui/select-menu 的 SelectMenu）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      /* 只数 `<select` 标签起始形态（后接空白、`>`、`/` 之外的字符），
       * 不误伤 `selectedValue` / `select-none` 这类同前缀的标识符与类名。 */
      return (t2.match(/<select[\s/>]/g) || []).length;
    },
  },

  /* ── P78「视图层裸写 <label>」（硬闸，规范 §16.2.4.26 / §12.18）─────────
   * 与 P23 是同一族账的两层：
   *   · **P23**（硬闸，视图层已清零）数的是「`<label>` + 控件同文件出现」的
   *     **表单行组合形态**——15 处已收口到 `~/components/ui/form-field` 的
   *     `FormField`（内部走 shadcn `ui/field` 的 `FieldLabel`，`htmlFor` 与
   *     `aria-describedby` 由 FormField 派生）。
   *   · **P78**（本条，棘轮）数的是**任何** `<label` 起始标签——包含那些
   *     没配显式控件、只做视觉分组或给 Base UI Checkbox 当点击区的孤立 label。
   *     这类不该套 `FormField`（它是一行表单），但 shadcn `ui/field` 里的
   *     `FieldLabel` 或 Base UI `Checkbox` 的 children 才是合规出口——
   *     裸 `<label>` 缺 `htmlFor` 时点标签不聚焦控件、读屏器把它读成孤立文本。
   *
   * 判据按形态取（`<label[\s/>]`），不误伤 `labelClassName` / `label=` 这类
   * 同前缀属性名（后面接的是标识符字符而不是空白/`>`/`/`）；`ui/` 通过
   * EXEMPT_DIRS 天然豁免（`ui/label.tsx` 与 `ui/field.tsx` 自身要写 `<label>`）。
   *
   * 走棘轮（非硬闸）：本批评据上线时视图层实测 15 处存量，冻结起点、只许降。
   * 下一批按域分片把每个 `<label>` 迁到 `FieldLabel` / `FormField` /
   * Base UI `Checkbox`（children 形式），与 P71/P76 引入节奏一致。
   *
   * P77 号**故意跳过**：P77 预留给 ToggleGroup 判据（`<Button aria-pressed>`
   * 循环），锚点需要「同一 map 里出现 aria-pressed」这种跨行组合、下一条
   * 独立 PR 更稳。 */
  P78: {
    label:
      "视图层裸写 <label>（表单行应走 ~/components/ui/form-field 的 FormField 或 ~/components/ui/field 的 FieldLabel；checkbox/radio 点击区走 ~/components/ui/{checkbox,radio-group} 的 children 语义）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      return (t2.match(/<label[\s/>]/g) || []).length;
    },
  },

  /* ── P77「视图层手写 aria-pressed」（硬闸，shadcn forms.md）────────────
   * shadcn `forms.md` 原文：`Option sets (2–7 choices) use ToggleGroup. Don't loop Button with manual active state.`
   *
   * 项目里 `~/components/ui/toggle-group` 装了（shadcn base-nova 版，内部
   * 走 Base UI `ToggleGroup` / `ToggleGroupItem`），但视图层里出现
   * `aria-pressed={cond}` = 这个文件在**手写一份"哪一个是选中"的状态契约**。
   * `aria-pressed` 是 toggle 语义的 ARIA 硬要求，Base UI 的 `ToggleGroupItem`
   * 会自己打这一份、并给键盘 / 读屏器 / `data-state="on|off"` 一致的样式；
   * 手写 `<Button aria-pressed>` 循环少了这一层：读屏器只能听到"按下"但
   * 拿不到组内互斥关系（`role="group"` 与 `aria-labelledby` 都得手写），
   * 视觉的 active 态也得每处 `className={\`${cond ? A : B}\`}` 重抄。
   *
   * 判据按形态取：视图里出现 `aria-pressed\s*=` 字面量 = 该文件手搓了一份
   * toggle 状态。`ui/toggle-group.tsx` 是这条账要收口的唯一实现、`ui/` 走
   * EXEMPT_DIRS 天然豁免；`ui/image-viewer.tsx` 里的两处 `aria-pressed`
   * 是**项目自定义基元**内部的形态（视图模式切换器），也在豁免范围内、
   * 视图层不该学它。
   *
   * 走棘轮（非硬闸）：本批评据上线时视图层实测约 6 处存量（LogFilterBar /
   * FilmStudio ×2 / LlmLocalSection / UsageTestDialog / RgthreeBodies），
   * 冻结起点、只许降。下一批按域分片把每个循环 `<Button aria-pressed>`
   * 迁到 `<ToggleGroup>` + `<ToggleGroupItem>`，与 P71 / P76 / P78 引入
   * 节奏一致（先冻结、后治理）。
   *
   * P77 号回填：**这条**在 P76（原生 `<select>`）与 P78（裸 `<label>`）
   * 之间的跳空位、由这一批填上（P73 / P74 / P75 三条 Separator / Alert /
   * EmptyState 判据的锚点还需打磨、留下批）。 */
  P77: {
    label:
      "视图层手写 aria-pressed（2–7 项的选项组应走 ~/components/ui/toggle-group 的 ToggleGroup + ToggleGroupItem；shadcn forms.md）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      return (t2.match(/aria-pressed\s*=/g) || []).length;
    },
  },

  /* ── P79「视图层无 dark: 前缀的浅色原色板」（硬闸，shadcn styling.md）──
   * P71 只管 `dark:` 前缀的调色板（把同一件事在明暗两处各写一遍），P79 补上
   * **无前缀的浅色版原色板** —— shadcn `styling.md` 原则 4 原文：`Use semantic colors. bg-primary, text-muted-foreground — never raw values like bg-blue-500.`
   *
   * 项目的 `--color-primary-strong` / `--color-info` / `--color-success-strong`
   * / `--color-warning-strong` / `--color-destructive` / `--color-subtle`
   * / `--color-border-strong` 等 token 内部已含浅/深两态（`globals.css`），
   * 视图里出现 `bg-violet-500/40` / `text-fuchsia-700` / `border-sky-400`
   * / `ring-emerald-400` / `from-red-*` / `to-amber-*` 这类**具体 palette
   * 色名 + 数字档位**（无论是否带 `dark:` 前缀）就是绕开语义 token、把主题
   * 色硬编码。改主题跟不动、深浅两态一致性靠人肉。
   *
   * 锚点复用 P71 的调色板色名表 + 前缀集，做两点收窄：
   *   · **去掉 `dark:` 前缀强制**（这一条就是数无前缀的浅色版）；
   *   · **再排除掉已经命中 P71 的**（带 `dark:` 的归 P71 管、避免双计）。
   *
   * 例外块复用 P71 的 `p71-allow:start … p71-allow:end` —— 同一族账：
   * palette 字面量本身就是语义（ANSI SGR 8 色 / workshop 域专有装饰色 /
   * 媒体类型色 / 文件夹黄橙 / 品牌渐变端点 …），不能被 token 化，走同一份
   * allow 块；一条 `p71-allow` 覆盖两条判据，比再造一个 `p79-allow` 更省
   * 也更难漏标。
   *
   * 走棘轮（非硬闸）：本批上线时实测视图层约 60 处（`studio/**` 35、
   * `workshop/**` 9、`ui/**` 自研件 12、其它 4），冻结起点、只许降。下一批
   * 按域分片迁语义 token（与 P71 治理同批节奏）。P79 号回填：填 P78 之后
   * 下一个可用号（P73/P74/P75/P76/P77 都已用或留）。 */
  P79: {
    label:
      "视图层无 dark: 前缀的浅色原色板（应走语义 token，shadcn styling.md 原则 4；例外块走 p71-allow 与 P71 共享）",
    count: (t) => {
      const t2 = stripCommentsCached(stripP71AllowBlocks(t));
      /* 与 P71 同款前缀集 + 色名表，但**不带 `dark:` 前缀**。用 `(?!dark:)`
       * 前瞻把带前缀的排掉、避免与 P71 双计。 */
      return (
        t2.match(
          /(^|[\s"'`{])(?!dark:)(?:bg|text|border|ring|from|to|shadow|fill|stroke|outline|decoration|accent|caret|divide|placeholder|file)-\[?[a-z-]*?(?:emerald|green|rose|red|amber|sky|cyan|violet|blue|purple|fuchsia|indigo|teal|lime|orange|yellow)-[0-9]/g,
        ) || []
      ).length;
    },
  },

  /* ── P80「视图层 w-N 与 h-N 同值应换 size-N」（硬闸，shadcn styling.md）──
   * shadcn `styling.md` 原则：`Use size-* when width and height are equal.
   * size-10 not w-10 h-10.` `size-N` 是 `w-N h-N` 的简写、由 tailwind
   * 内建；同一份 `w-N h-N` 手写会：
   *   · 让「改尺寸」要动两处、且两处不同步就会漂（`w-8 h-9` 是不是有意
   *     的还是漏改？机器看不出来）；
   *   · 与 `rounded-full` / `size-*` 混用时视觉一致性问题（圆点用 size
   *     表达"这是个圆"，用 w/h 表达的是"两个方向独立设"）。
   *
   * JS 正则**支持 backreference**（不像 ripgrep 默认不支持），锚点用两个
   * 方向都数一次、避免顺序漂移：`w-N ... h-N` 与 `h-N ... w-N`。数字
   * 支持小数（`w-1.5 h-1.5` 也是同款形态）。
   *
   * ⚠️ 只管 className 字符串里的**等值** w/h 对；不等值（`w-8 h-9` 之类）
   * 是**有意**的宽×高、不算这条账。也不看 style 属性里的 `width: N; height: N`
   * （那是另一层、动态尺寸常见）。
   *
   * `ui/` 走 EXEMPT_DIRS 天然豁免；`ui/avatar.tsx` 里 size-* 变体表本身就是
   * 这条判据要推荐的写法。视图层实测约 90 处，走棘轮冻结起点。 */
  P80: {
    label:
      "视图层 w-N 与 h-N 同值（应换 size-N，shadcn styling.md「Use size-* when width and height are equal」）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      let n = 0;
      /* 扫每个 `className="…"` / `className='…'` / `className={\`…\`}` 字符串，
       * 收集里面出现的 w-N 与 h-N 的数字集，看交集。同字符串里 w-8 与 h-8
       * 只算一处（`size-8` 是唯一修法）；不同 className 之间相互独立。
       * 夹在中间的其它 utility（`w-8 rounded-lg h-8`）不影响判定，也不
       * 会被数字前后有 `.` `/` 之类的分隔符（如 `w-1.5`）误伤。 */
      const clsRe = /className\s*=\s*(?:"([^"]*)"|'([^']*)'|`\([^`]*`\s*)/g;
      for (const m of t2.matchAll(clsRe)) {
        const cls = m[1] ?? m[2] ?? "";
        if (!cls) continue;
        const ws = new Set();
        const hs = new Set();
        /* 前面必须是**行首 / 空白 / 引号**（`(^|[^-\w])` + 捕获后续），
         * 否则会把 `min-h-0` / `max-w-md` 这类带前缀的容器写法误当
         * 成 `h-0` / `w-md`（JS 正则 `\b` 在 `-h-` 处也算边界）。 */
        for (const x of cls.matchAll(
          /(?:^|[^-\w])w-(\d+(?:\.\d+)?)(?=\s|$)/g,
        )) {
          ws.add(x[1]);
        }
        for (const x of cls.matchAll(
          /(?:^|[^-\w])h-(\d+(?:\.\d+)?)(?=\s|$)/g,
        )) {
          hs.add(x[1]);
        }
        for (const w of ws) if (hs.has(w)) n++;
      }
      return n;
    },
  },

  /* ── P81「视图层 `<Button>` 内 icon 缺 `data-icon=`」（硬闸，shadcn composition.md）──
   * shadcn `composition.md`：`Icons in buttons need data-icon="inline-start"
   * or "inline-end" (Base UI + Tailwind v4 has-* selector).` 项目 `ui/button.tsx`
   * 的 `buttonVariants` size 变体（default / xs / sm / lg）里显式依赖这个 hook：
   *   `has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2`
   * —— **有 `data-icon` 才切内边距**。视图里 `<Button>` 直接放 icon 但忘了标
   * `data-icon=` 的表现：按钮左右内边距停在 `px-2.5`（无 icon 档），文字
   * 与 icon 挤在一起、或纯 icon 按钮宽度不对；改主题或换尺寸档时得逐处补。
   *
   * 判据按形态取：视图层 `<Button>...</Button>` 块内、**深度 1**（Button 的
   * 直接子节点）处出现 icon-like 起始标签、且该标签开括号里不含 `data-icon=`
   * 即计一处。icon-like 判据（`isP81IconName`）：
   *   · 项目自研 `<Icon name="…">`、原生 `<svg>`；
   *   · 后缀是 `Icon` 的 PascalCase（`ChevronLeftIcon` 等 lucide 别名约定）；
   *   · 已知 lucide 组件名集合（视图里目前用到的 25 项，够覆盖 111 处
   *     实测存量、避免全量 lucide 名单在扫描里做前缀匹配的假阳）。
   *
   * 深度 1 之外不算：`<Button><span><Plus/></span>Label</Button>` 里 Plus
   * 被 span 包着、shadcn 的 `has-data-*` 选择器只吃**直接子级**、那种写法
   * 就算加了 `data-icon` 也不生效，不属这条账。
   *
   * 走棘轮（非硬闸）：本批上线时视图层实测 111 处（跨 52 文件 · 见
   * `changelog.d/0-p81-gate.md`），冻结起点、只许降。下一批按域分片
   * （studio / workshop / message-center / ui 内部）把每个 icon 补上
   * `data-icon="inline-start" | "inline-end"`（前者是「icon 在文字前」、
   * 后者是「icon 在文字后」），再走一次清零 → 升硬闸。 */
  P81: {
    label:
      '视图层 <Button> 直接子 icon 缺 data-icon="inline-start|end"（shadcn composition.md；buttonVariants 的 has-data-[icon=*] 选择器只吃直接子级）',
    count: (t) => {
      const t2 = stripCommentsCached(t);
      let n = 0;
      for (const m of t2.matchAll(/<Button\b[^>]*>([\s\S]*?)<\/Button>/g)) {
        const inner = m[1];
        let depth = 0;
        /* tag 匹配：`<` 后紧跟 `[A-Za-z]` 起始的名字、属性段允许引号字面量
         * 与 `{…}` 表达式（不递归平衡、够用即可）、以 `>` 或 `/>` 收尾。
         * 未闭合的 `<` 在 TSX 泛型里存在（`<T,>` 带尾逗号）—— 那条不像
         * JSX 标签、这里靠 `[^>]*` 会吞到下一行；作为棘轮判据、少计一次
         * 不影响清零节奏。 */
        for (const tg of inner.matchAll(
          /<(\/?)([A-Za-z][A-Za-z0-9]*)((?:"[^"]*"|'[^']*'|\{[^{}]*\}|[^>])*?)(\/?)>/g,
        )) {
          const closing = tg[1] === "/";
          const name = tg[2];
          const attrs = tg[3];
          const selfClose = tg[4] === "/";
          if (closing) {
            if (depth > 0) depth--;
            continue;
          }
          if (
            depth === 0 &&
            isP81IconName(name) &&
            !/\bdata-icon\s*=/.test(attrs)
          ) {
            n++;
          }
          if (!selfClose) depth++;
        }
      }
      return n;
    },
  },

  /* ── P82「视图层 `<Button>` 原生 `title=`（应走 `<Tooltip>`）」（硬闸）────
   * shadcn `composition.md`：`For icon-only or hover-help affordances use
   * Tooltip, not native title.` 原生 `title=` 的三个短板：
   *   · 屏幕阅读器多数浏览器只读一次、且不参与 aria 关系（读屏器对 `title`
   *     的支持在 Chrome / Firefox 长期不一致，Safari 上 VoiceOver 直接忽略）；
   *   · 显示延迟不可控、移动端不显示；
   *   · 样式不能主题化（浏览器原生 tooltip 灰底、脱离设计 token 系统）。
   * 合规出口是 `~/components/ui/hint` 的 `<Hint label=…>`（`Tooltip` +
   * `<TooltipTrigger render={…} />` 的薄封装 · Base UI render prop · 不用
   * asChild）；三个 prop 分别挡「条件态提示不出」「图标按钮丢可访问名」
   * 「禁用按钮弹不出原因」三类场景。
   *
   * 判据按形态取：视图层 `<Button` 后紧跟空白 / `>` / `/`（不误伤
   * `<ButtonLink>`）时，**平衡扫描**它的整个开标签、解析出属性、再判
   * `title=` 的取值档位（见 `countButtonTitle`）：
   *   · 属性段边界交给扫描器（`scanJsxAttrs`），不用 `[^>]*` 那种粗锚 ——
   *     箭头函数 `onClick={() => …}` 里的 `>` 会让粗锚早停、把后面带 `title=`
   *     的 Button 漏掉（引入时粗锚实测 78 处、AST 复扫 157 处）；
   *   · 属性名**整名匹配**（`parseJsxProps` 里 `-` `.` `$` `:` 都算名字字符）——
   *     旧的 `\btitle\s*=` 会把 `data-title=` / `aria-label="title=x"` 误报；
   *   · 取值分五档，只有 static（`title="文字"`）与 dynamic（`title={expr}`）
   *     计违规；empty（`title=""` / `{undefined}` / `{null}`）等同没写、不计；
   *     `{...props}` 展开的 unknown 单列人工抽查（静态判不了，见 `--report`
   *     的 `P82-unknown` 通道）。
   *   ⚠️ 已知边界：**字符串 / 模板字面量里**字面出现的 `<Button title=…>`
   *   （如测试夹具的字符串）仍会被命中 —— 这一档只有 AST（`@babel/parser`
   *   开 jsx 插件或 ts-morph 遍历 `JsxOpeningElement`）能根治；本仓库实测
   *   该形态真实出现 0 处（落在注释里的已被 `stripComments` 剥掉），故不在
   *   正则/扫描器上继续打补丁（§12.18）。 */
  P82: {
    label:
      "视图层 <Button> 用原生 title=（应走 ~/components/ui/hint 的 <Hint label=…>；shadcn composition.md）",
    /* 五档判定（见 countButtonTitle）：只有 static / dynamic 计入违规；
     * empty（空值等同没写）与 unknown（{...props} 展开、静态判不了）不进
     * 这条硬闸，后者单列人工抽查。 */
    count: (t) => countButtonTitle(t).violations,
  },

  /* ── P83「屏级标题不走字阶档 / 在 h1 上硬写字号」（硬闸）─────────────────
   * `globals.css` 里 `.u-title-page` 注明就是「页面级标题（h1）统一规范」，可它
   * 引入至今只有 1 处消费者；屏级标题实际写在 11 个 h1 上，尺寸有 18 / 20 / 24 /
   * 34px 四五种 —— 同一个角色在不同屏大小不一，而 `.u-title` / `.u-title-page`
   * 的数值本身也是工具类里的硬编码字面量（规范 03 §3.2 反对的那一类）。
   *
   * 判据只管 **h1（屏级）**：属性段里必须出现屏级档
   * （`u-title-page` / `text-page`），且不得再叠硬写字号（`text-lg`、`text-[34px]`
   * 这类）。
   *
   * 曾经还放行一档 `u-title-hero`（首页欢迎区那块大标题）。ISSUE #1691 把首页
   * 那块欢迎区整个删了（标题是句口号、副标题把四张入口卡的说明重说一遍，两者占掉
   * 首屏上沿约 150px），`--text-hero` 与 `.u-title-hero` 随之成为零消费者 —— 于是
   * 这里只剩下唯一那一档。**别把这一档当「以后可能用得上」留着**：留着的代价是
   * 「唯一档」这句话在后一个想写 `text-[34px]` 的人面前就不成立了。
   *
   * 区块级标题（h2 / h3）**不入本条**：那里刻意保留 10.5–14px 的多档微排版，
   * 并成一档会压平信息层次，那是另一件事，不该由这条判据顺手管。
   *
   * 属性段用 `readJsxAttrsPastTag` 平衡扫描（同 P82 的教训）：`className={cn(...)}`
   * 里的 `>` 不提前收尾、`className={[..].join("")}` 的数组形态也能读全 ——
   * 粗锚 `[^>]*` 会在这两种写法上漏计。 */
  P83: {
    label:
      "屏级标题 <h1> 未走字阶档 u-title-page，或在 h1 上硬写字号（字号由档位给，不在调用点写）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      let n = 0;
      const re = /<h1(?=[\s/>])/g;
      let m;
      while ((m = re.exec(t2)) !== null) {
        const attrs = readJsxAttrsPastTag(t2, re.lastIndex);
        if (attrs === null) continue;
        const hasTier = /\b(?:u-title-page|text-page)\b/.test(attrs);
        const hardSize =
          /\btext-(?:xs|sm|base|md|lg|xl|2xl|3xl|4xl|5xl)\b|\btext-\[/.test(
            attrs,
          );
        if (!hasTier || hardSize) n++;
      }
      return n;
    },
  },

  /* ── P84「视图层手搓面包屑」（硬闸，规范 §16.2.4.72）───────────────────
   * 锚**形态**（「谁在砌一段 `A / B / 当前 C` 的行」），不按名字找
   * （§16.2.4.6 的教训：按目录名扫会得出「没场景」的误判）。
   *
   * 形态是两件同时出现，缺一不算：
   *   ① 一个**分隔符 span**：JSX 里一段**文本只有 `/`** 的元素
   *      （`<span …>/</span>`，可带 class / 转义）；
   *   ② 一个**段数组的 map**：回调里出现末尾判定（`isLast` / 下标与长度比较
   *      那一族）—— 这只是把「路径段」与任何别的 `.map` 区分开。
   *
   * 出口是 `~/components/ui/breadcrumb-path` 的 `<BreadcrumbPath>`
   * （它自己建在 `ui/breadcrumb` 的整套 slot 上）—— 把 `ol` / `li` 的层级
   * 与 `aria-current="page"` 一并给到，而手搓的 `span` + `/` 里这两样都没有。
   */
  P84: {
    label:
      "视图层手搓面包屑（`/` 分隔 span + 段数组 map；应使用 ~/components/ui/breadcrumb-path 的 BreadcrumbPath）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      /* ① 分隔符 span：`<span …>` 的内容只有 `/`（允许前后空白）。
       *    属性段放开到 `[^>]*`，但**要求不以 `/` 结尾**（避开自闭合
       *    `<span … />` 这种不承载文本的形态）。 */
      const sepRe = /<span\b[^>]*>\s*\/\s*<\/span>/g;
      if (!sepRe.test(t2)) return 0;
      /* ② 段数组的 map：回调里有末尾判定。三种常见写法都算。 */
      const tailRe =
        /\bisLast\b|\bi\s*===\s*[^\n]*\.length\s*-\s*1\b|\bindex\s*===\s*[^\n]*\.length\s*-\s*1\b/;
      const mapRe = /\.map\s*\(/g;
      let m;
      while ((m = mapRe.exec(t2)) !== null) {
        /* 看 map 回调这一小段（到下一个 `)` 或 200 字符，够判末尾判定了）。 */
        const window = t2.slice(m.index, m.index + 400);
        if (tailRe.test(window)) return 1;
      }
      return 0;
    },
  },

  /* ── P85「视图层手写 `<table>`」（硬闸，规范 §16.2.4.72）───────────────
   * 锚 `<table` 标签起始形态（同 P76 对 `<select` 的口径，不误伤
   * `tableData` / `Table` 组件名 —— 后面必须接空白 / `>` / `/`）。
   *
   * 出口是 `~/components/ui/table`：它此前**全库零引用**（`ui/` 里躺着
   * 一整套 `Table` / `TableHeader` / `TableRow` / `TableCell` / `TableHead`，
   * 而视图里手写裸 `<table>` + `<thead>` / `<tr>` / `<td>`）。直接写裸标签
   * 会丢掉基元给的 `data-slot` 与统一排版（边框 / 悬停 / 末行去边框）。
   */
  P85: {
    label:
      "视图层手写 <table>（应使用 ~/components/ui/table 的 Table / TableHeader / TableRow / TableCell / TableHead）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      return (t2.match(/<table[\s/>]/g) || []).length;
    },
  },

  /* ── P86「视图层手搓屏级页头」（硬闸，规范 §16.2.4.73）───────────────────
   * 规范 16 的判据表里这一行早就占了编号，而脚本里没有对应实现 ——
   * 表里紧挨着的一句是「84 条全部是硬闸」，读表的人会得出「P86 是条已存在、
   * 只是走棘轮的判据」。它既不在硬闸也不在棘轮，是**占了编号的未实现**
   * （ISSUE #1668；与 §13.5.12 立的案同族：判据自称在跑、实际没有执行者）。
   *
   * 出口是 `~/components/ui/page-header` 的 `<PageHeader>`：它一处管三件事
   * ——屏级 `h1` 走 `.u-title-page` 字阶档、一行副说明走已定档的
   * `.text-sm` + 语义色、右侧动作组 `shrink-0` 不被压扁。
   *
   * ## 判据锚的是形态，不是名字
   *
   * 收口当时真正在守的是 `tests/page-name-single-source.test.ts`，但它的
   * `PAGE_HEADER_CONSUMERS` 是一份**具名文件清单**（7 屏）—— 拦得住
   * 「这 7 屏退回手抄」，拦不住第 8 个新屏自己拼页头。而 P83 只判「屏级标题
   * 是不是 `.u-title-page`」，**看不见形状**：手抄照样过 P83。
   *
   * 形态是**两件在同一次页头块内同现**，缺一不算：
   *   ① `.u-title-page` 的屏级标题（P83 已要求的那一档）；
   *   ② 紧接着一行**副说明**：`.mt-1.text-sm` —— 规范 03 §3.10 末尾给
   *      「新增一个屏时」写死的那两个类（色类两种写法都算，见下）。
   *
   * ## 为什么第二锚敢收得这么窄（实测过的）
   *
   * 三处**刻意不迁**的落点（工具条形态页头 / 工作区型屏 / 页头即数据）
   * 都只有 ①、没有 ② —— 实测 `FilmStudioTopBar` / `WorkflowLibraryHeader` /
   * `WorkshopHeader` / `ProjectHomePage` / `SettingsShell` 的 `mt-1 text-sm`
   * 命中数**全是 0**，所以「①+②同现」这一锚恰好只挑出手抄页头、一处不误抓。
   *
   * ⚠️ 色类**不写进锚**：手抄样本 `src/app/(main)/models/page.tsx` 用的副说明
   * 色类是 `text-muted-foreground`，而基元里是 `text-ink-muted` —— 若把
   * `text-ink-muted` 也写成判据的一部分，这条判据会**恰好漏掉唯一的现成手抄
   * 样本**、落在 0 上永远绿（正是本仓反复踩的那条：等式为 0 的判据若正则写漂
   * 会永远绿）。色类归 §3.6.2 的语义 token 口径管，不归这里。
   *
   * ## 窗口为什么是「按行邻域」而不是整文件
   *
   * 整文件口径下，只要一个文件里**任何地方**有 `mt-1 text-sm`，它里面所有
   * `.u-title-page` 都会被算上 —— 一个屏里同时有页头与别的说明行时会误抓。
   * 收成「`.u-title-page` 那一行起、往后 8 行内」后严格同形，反向样本三条
   * 同批在册（见 tests/check-ui-primitives.test.ts 的 P86 组）。
   */
  P86: {
    label:
      "视图层手搓屏级页头（`.u-title-page` 标题 + `mt-1 text-sm` 副说明同现；应使用 ~/components/ui/page-header 的 PageHeader）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      const lines = t2.split("\n");
      let n = 0;
      for (let i = 0; i < lines.length; i++) {
        if (!/\bu-title-page\b/.test(lines[i])) continue;
        /* 那枚标题行起、往后 8 行内（含自身）出现副说明档即算 ——
         * `mt-1` 与 `text-sm` 同处一枚 class 串，但两枚 token 的先后
         * 不固定（`mt-1 text-sm` / `text-sm mt-1` 都见过），所以分开判。 */
        const window = lines.slice(i, i + 9).join("\n");
        if (/\bmt-1\b/.test(window) && /\btext-sm\b/.test(window)) n++;
      }
      return n;
    },
  },
};
