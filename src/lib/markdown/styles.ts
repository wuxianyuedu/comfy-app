/**
 * 渲染出来的 markdown 元素**长什么样**（本仓库的视觉口径）。
 *
 * 为什么把样式做成一张表、而不是一段 CSS：这些 HTML 由 `dangerouslySetInnerHTML`
 * 直插进 DOM，不经过 Tailwind 的类扫描（类名是运行时拼的，产物里扫不到它），也不
 * 经过 Next 的 CSS 作用域。内联 `style` 是唯一「不依赖构建期能否看见这个类名」的落点。
 *
 * 颜色一律取 `--color-md-*` / `--color-ink-*` token（`globals.css` 两态各一份），
 * 因此浅色 / 暗色跟随主题，不写死色值（规范 03 §3.6）。
 *
 * 本表只放**形状**（padding / border / font-size…）与「这个标签要不要多带一个属性」；
 * 「哪些标签/属性被允许存在」是另一件事，在 `sanitize-config.ts` —— 两者改动理由
 * 不同，放一起会让「加一种语法」看起来像「改一次样式」。
 */

/** 一种元素在产物里的写法。 */
export interface StyleRule {
  /**
   * 直接写进开标签的 `style` 值。**省略 = 这个标签不注入样式**（不是「注入一个空
   * `style=""`」—— 空属性会给产物的每个标签多出十几字节噪音，且让 `style=""` 与
   * 「明确的零样式」这两种含义混在一起）。
   */
  style?: string;
  /**
   * `style` 之外的属性（形如 ` target="_blank" rel="noreferrer"`，**自带前导空格**）。
   * 默认空串。链接与图片会用到。
   */
  extra?: string;
}

const MONO = "font-family:ui-monospace,SFMono-Regular,Menlo,monospace;";

/** 四周留白的统一节奏，省得每条规则各写一遍 `margin:`。 */
function m(v: string): string {
  return `margin:${v};`;
}

/** 表里没有的元素不是「被禁止」，而是「不加工」——能不能出现由白名单决定。 */
export const MARKDOWN_ELEMENT_STYLES: Readonly<Record<string, StyleRule>> = {
  /* 标题字号随层级递减。**层级不下移**：便签标题栏与剧本外层标题各自有语义，
   * 再整体减一档会让 markdown 自己的 `#` 没有落点（`h1` 在域内允许出现）。 */
  h1: {
    style: `font-weight:700;${m("8px 0 4px")}font-size:18px;color:var(--color-ink-bright);`,
  },
  h2: {
    style: `font-weight:700;${m("8px 0 4px")}font-size:16px;color:var(--color-ink-bright);`,
  },
  h3: {
    style: `font-weight:700;${m("8px 0 4px")}font-size:14px;color:var(--color-ink-bright);`,
  },
  h4: {
    style: `font-weight:700;${m("8px 0 4px")}font-size:12.5px;color:var(--color-ink-bright);`,
  },
  h5: {
    style: `font-weight:700;${m("8px 0 4px")}font-size:12px;color:var(--color-ink-bright);`,
  },
  h6: {
    style: `font-weight:700;${m("8px 0 4px")}font-size:11px;color:var(--color-ink-bright);`,
  },
  p: { style: `${m("4px 0")}line-height:1.5;` },
  a: {
    style:
      "color:var(--color-md-link);text-decoration:underline;" +
      "text-decoration-thickness:1px;text-underline-offset:2px;",
    /* 外链新开页签：桌面壳里不能夺走当前窗口；`noreferrer` 同时挡住 `Referer`
     *  与 `window.opener` 回指。 */
    extra: ' target="_blank" rel="noreferrer"',
  },
  /* 代码块：底色比行内代码更重，整体可横向滚动（长行不撑破便签）。 */
  pre: {
    style:
      `background:var(--color-md-code-bg);border:1px solid var(--color-md-border);` +
      `border-radius:4px;padding:6px 8px;${m("6px 0")}overflow-x:auto;` +
      `${MONO}font-size:10.5px;line-height:1.45;`,
  },
  /* `pre` 里的 `code` 不再叠底色与边框（否则代码块里出现「框里的框」）——
   *  `styles.ts` 之后没有别的样式层，这条差异只能在这里按标签本身表达。 */
  code: {
    style:
      `background:var(--color-md-inline-code-bg);border:1px solid var(--color-md-border);` +
      `padding:0 3px;border-radius:3px;font-size:10px;${MONO}`,
  },
  blockquote: {
    style:
      "border-left:3px solid var(--color-md-quote-border);padding:2px 0 2px 8px;" +
      `${m("6px 0")}color:var(--color-ink-soft);`,
  },
  ul: { style: `${m("4px 0 4px 18px")}padding:0;list-style-type:disc;` },
  ol: { style: `${m("4px 0 4px 18px")}padding:0;list-style-type:decimal;` },
  li: { style: m("2px 0") },
  hr: {
    style: `border:none;border-top:1px solid var(--color-md-border);${m("8px 0")}`,
  },
  table: {
    style: `border-collapse:collapse;${m("6px 0")}width:100%;font-size:11px;line-height:1.45;`,
  },
  th: {
    style:
      "padding:4px 8px;border:1px solid var(--color-md-border);" +
      "background:var(--color-md-inline-code-bg);font-weight:600;" +
      "color:var(--color-ink-bright);text-align:left;vertical-align:top;",
  },
  td: {
    style:
      "padding:4px 8px;border:1px solid var(--color-md-border);" +
      "color:var(--color-ink-subtle);text-align:left;vertical-align:top;",
  },
  /* 图片：便签宽度有限，超宽图按容器收窄，不撑破布局。 */
  img: { style: "max-width:100%;height:auto;vertical-align:middle;" },
  /* 任务列表的勾选框：`disabled` 由 marked 自己带上，这里只压尺寸与基线对齐。 */
  input: { style: `vertical-align:middle;${m("0 4px 0 0")}` },
  /* 以下都是「放行但不加工」的行内元素：上表的形状已经够了，单独列出来是为了
   *  让「这些标签被允许」有一个可读的落点（而不是只存在于消毒白名单里）。
   *  省略 `style` 而不是写 `style: ""` —— 见 `StyleRule.style` 的注释。 */
  br: {},
  del: {},
  s: {},
  em: {},
  strong: {},
  b: {},
  i: {},
  u: {},
  mark: {},
  sub: {},
  sup: {},
  small: { style: "font-size:0.85em;" },
  kbd: {
    style: `${MONO}font-size:0.9em;border:1px solid var(--color-md-border);border-radius:3px;padding:0 3px;`,
  },
  /* 折叠块（markdown 里写的原始 `<details>`）：只留语义，不加装饰。 */
  details: { style: m("4px 0") },
  summary: { style: "cursor:pointer;font-weight:600;" },
};

/** 扫开标签：只认「名字 + 属性区」，属性区里不含 `>`（值里的 `>` 已被 DOMPurify 转义）。 */
const OPEN_TAG = /<([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;

/**
 * 拼一个开标签。两处容易错的地方各留一行注释：
 *   · 标签名与属性区之间**必须有空格**；
 *   · 没有样式时不写 `style`，但要保证「`style` 之后还有 `extra`」这种情况
 *     也不会出现前导空格丢失（`rest` 自带前导空格）。
 */
function openTag(name: string, rule: StyleRule, rest: string): string {
  const style = rule.style ? ` style="${rule.style}"` : "";
  return `<${name}${style}${rest}>`;
}

/**
 * 给一串已消毒的 HTML 逐标签套上本仓库的样式。
 *
 * 只处理**开标签**（闭标签不带属性）。属性区原样保留 —— 消毒那一步已经把
 * 位置属性（`align`、`checked`、`href`…）裁到白名单内，这里不再判断第二次。
 *
 * 已知边界：不做完整 HTML 解析，按「标签名 + 属性区」的字面形态替换。输入是
 * DOMPurify 的序列化结果，属性值里的 `>` 已转义成 `&gt;`，因此不会截断。
 */
export function applyElementStyles(html: string): string {
  return html.replace(OPEN_TAG, (whole, nameRaw: string, attrs: string) => {
    const ruleEntry = MARKDOWN_ELEMENT_STYLES[nameRaw.toLowerCase()];
    if (!ruleEntry) return whole;
    return openTag(nameRaw, ruleEntry, `${attrs}${ruleEntry.extra ?? ""}`);
  });
}
