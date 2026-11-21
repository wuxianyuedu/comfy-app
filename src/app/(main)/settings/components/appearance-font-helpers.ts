import type { FontTier } from "~/lib/appearance";
import { DEFAULT_CODE_FONT, DEFAULT_INTERFACE_FONT, DEFAULT_TERMINAL_FONT } from "~/lib/appearance";

/** 把字体栈按展示口径归一化（折叠空白），用于比较“是否为默认”。 */
export function normalizeFontStack(value: string): string {
  return value.replaceAll(/\s+/gu, " ").trim();
}

/** 拆分逗号分隔的字体栈，去掉空项（引号原样保留，拼回时不错断 CSS 字符串）。 */
export function splitFontStack(value: string): Array<string> {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** 将单个字体项转换为更易读的中文说明（保留原始字体名语义）。 */
export function describeFontPart(part: string): string {
  const normalized = part.replaceAll(/^['"]|['"]$/gu, "").trim();
  if (normalized === "var(--font-geist-sans)") {
    return "Geist Sans（内置西文字体）";
  }
  if (normalized === "system-ui") {
    return "system-ui（系统界面字体）";
  }
  if (normalized === "-apple-system") {
    return "-apple-system（Apple 系统字体）";
  }
  if (normalized === "sans-serif" || normalized === "monospace") {
    return `${normalized}（通用回退）`;
  }
  if (normalized === "ui-monospace" || normalized === "SFMono-Regular") {
    return `${normalized}（等宽字体）`;
  }
  return normalized;
}

/** 字体栈中一项的归类（设置页按类分组的口径，ISSUE #3784）。 */
export function fontCategoryForTier(part: string): string {
  const normalized = part.replaceAll(/^['"]|['"]$/gu, "").trim();
  if (
    [
      "var(--font-geist-sans)",
      "SF Mono",
      "ui-monospace",
      "SFMono-Regular",
      "Menlo",
      "Cascadia Mono",
      "Cascadia Code",
      "Consolas",
    ].includes(normalized)
  ) {
    return "西文/等宽首选";
  }
  if (
    ["Sarasa UI SC", "Sarasa Mono SC", "PingFang SC", "Microsoft YaHei", "Noto Sans SC"].includes(
      normalized,
    )
  ) {
    return "中文字体";
  }
  if (["system-ui", "-apple-system", "sans-serif", "monospace"].includes(normalized)) {
    return "通用回退";
  }
  return "自定义/其他";
}

/**
 * 栈里一项的「什么时候在用」说明（ISSUE #4059 补充意见：光陈列名字，用户看不出
 * 每一种什么时候用、为什么系统回退也有多种）。CSS 字体栈按「缺字才回退」逐个尝试：
 * 排在前面的先生效，后面的只在前面字体缺这个字时接替；不同系统自带的中文 / 等宽
 * 字体不同，所以栈里给各平台各留一个。
 *
 * @param part 栈里的原始项（可带引号 / var()）
 * @param isFirstInGroup 是否是该部分的第一项（优先使用的那一个）
 * @returns 一句可读说明，直接陈列在设置页的字体名旁边
 */
export function fontRoleNote(part: string, isFirstInGroup: boolean): string {
  const normalized = part.replaceAll(/^['"]|['"]$/gu, "").trim();
  const notes: Record<string, string> = {
    "var(--font-geist-sans)": "内置西文（随包自带）",
    "Sarasa UI SC": "内置中文（随包自带）",
    "Sarasa Mono SC": "内置中文等宽（随包自带）",
    "PingFang SC": "macOS 自带中文",
    "Microsoft YaHei": "Windows 自带中文",
    "Noto Sans SC": "Android / Linux 自带中文",
    "SF Mono": "macOS 自带等宽",
    Menlo: "macOS 等宽回退",
    "Cascadia Code": "Windows 等宽回退",
    "Cascadia Mono": "Windows 等宽回退",
    Consolas: "Windows 等宽回退",
    "ui-monospace": "系统等宽兜底",
    "SFMono-Regular": "系统等宽兜底",
    "system-ui": "跟随系统界面字体（兜底）",
    "-apple-system": "Apple 平台兜底",
    "sans-serif": "无衬线最终兜底",
    monospace: "等宽最终兜底",
  };
  const note = notes[normalized];
  if (note === undefined) {
    return isFirstInGroup ? "优先使用" : "缺字时回退";
  }
  if (isFirstInGroup) {
    return `${note}，优先使用`;
  }
  /* 兜底类的说明本身已经答了「什么时候用」，不再叠一句「缺字时回退」。 */
  return note.includes("兜底") ? note : `${note}，缺字时回退`;
}

/* ── 陈列的平台过滤（ISSUE #4700）────────────────────────
   字体栈给各平台各留了回退项，但设置页把它们一次全量陈列 —— Windows 用户也看到
   PingFang SC / Noto Sans SC。这里把「哪项专属哪个平台」收口成一张表：陈列框默认
   只显示运行平台会用到的字面，其他平台经下拉切换查看（字体本身不从栈里删）。 */

/** 运行平台（浏览器侧判据；Node 的 process.platform 管不到 WebView 里的渲染）。 */
export type RuntimePlatform = "macos" | "windows" | "linux";

/** 陈列视图：current = 跟随运行平台（默认），其余为点名平台或全量。 */
export type FontPlatformView = "current" | RuntimePlatform | "all";

/** 平台展示名（下拉选项与「当前平台」后缀共用这一份，不各写各的）。 */
export const PLATFORM_LABELS: Record<RuntimePlatform, string> = {
  macos: "macOS",
  windows: "Windows",
  linux: "Linux / Android",
};

/** 栈里一项**专属**的平台。内置项（Geist / Sarasa）与通用回退（system-ui /
 *  sans-serif / ui-monospace 等）不进这张表 = 任何平台都显示；未知项是用户
 *  自定义字体，同样恒显示。平台归属与 fontRoleNote 的说明同一口径。 */
const FONT_PART_PLATFORM: Record<string, RuntimePlatform> = {
  "PingFang SC": "macos",
  "SF Mono": "macos",
  Menlo: "macos",
  "-apple-system": "macos",
  "Microsoft YaHei": "windows",
  "Cascadia Code": "windows",
  "Cascadia Mono": "windows",
  Consolas: "windows",
  "Noto Sans SC": "linux",
};

/** 从 navigator（或给定的 platform + UA 串）判运行平台；判不出兜底 windows
 *  （桌面壳的主力平台）。 */
export function currentFontPlatform(source?: string): RuntimePlatform {
  const raw =
    source ??
    (typeof navigator === "undefined" ? "" : `${navigator.platform} ${navigator.userAgent}`);
  if (/win/i.test(raw)) {
    return "windows";
  }
  if (/mac|iphone|ipad|ipod|ios/i.test(raw)) {
    return "macos";
  }
  if (/linux|android|x11|unix/i.test(raw)) {
    return "linux";
  }
  return "windows";
}

/** 一项在某个平台下是否会用到。 */
export function fontPartOnPlatform(part: string, platform: RuntimePlatform): boolean {
  const normalized = part.replaceAll(/^['"]|['"]$/gu, "").trim();
  const owned = FONT_PART_PLATFORM[normalized];
  return owned === undefined || owned === platform;
}

/** 一项在某陈列视图下是否显示。 */
export function fontPartInView(
  part: string,
  view: FontPlatformView,
  current: RuntimePlatform,
): boolean {
  if (view === "all") {
    return true;
  }
  return fontPartOnPlatform(part, view === "current" ? current : view);
}

/** 平台下拉的选项（数组驱动，规范 04 §4.2）；「当前平台」带出实际平台名。 */
export function fontPlatformViewOptions(current: RuntimePlatform | null): Array<{
  label: string;
  value: FontPlatformView;
}> {
  return [
    {
      value: "current",
      label: current === null ? "当前平台" : `当前平台 · ${PLATFORM_LABELS[current]}`,
    },
    { value: "windows", label: PLATFORM_LABELS.windows },
    { value: "macos", label: PLATFORM_LABELS.macos },
    { value: "linux", label: PLATFORM_LABELS.linux },
    { value: "all", label: "全部平台" },
  ];
}

/**
 * 每一档的「部分」槽位（ISSUE #3784 补充）：一类字体一个槽位，配置时**每槽一种
 * 字体**；「系统回退」是固定档（不提供输入）——任何字体缺字时都得有地方落地。
 */
export type FontSlot = {
  fixed: boolean;
  key: "primary" | "cjk" | "fallback";
  label: string;
};

const FONT_SLOTS: Record<FontTier, Array<FontSlot>> = {
  interface: [
    { key: "primary", label: "西文字体", fixed: false },
    { key: "cjk", label: "中文字体", fixed: false },
    { key: "fallback", label: "系统回退", fixed: true },
  ],
  code: [
    { key: "primary", label: "等宽字体", fixed: false },
    { key: "fallback", label: "通用回退", fixed: true },
  ],
  terminal: [
    { key: "primary", label: "等宽字体", fixed: false },
    { key: "cjk", label: "中文字体", fixed: false },
    { key: "fallback", label: "通用回退", fixed: true },
  ],
};

const SLOT_OF_CATEGORY: Record<string, FontSlot["key"]> = {
  "西文/等宽首选": "primary",
  中文字体: "cjk",
  通用回退: "fallback",
  "自定义/其他": "primary",
};

function defaultStackOf(tier: FontTier): string {
  return tier === "interface"
    ? DEFAULT_INTERFACE_FONT
    : tier === "code"
      ? DEFAULT_CODE_FONT
      : DEFAULT_TERMINAL_FONT;
}

function slotIndexOf(slotKey: string, tier: FontTier): number {
  return FONT_SLOTS[tier].findIndex((slot) => slot.key === slotKey);
}

/** 一档字体按「部分」分组后的读数：每组一类字体，顺序即栈里的顺序。 */
export type FontPartGroup = {
  editable: boolean;
  items: Array<string>;
  label: string;
  slot: string;
};

/** 把某一档的字体栈按类分组（组的骨架来自该档的槽位定义，自定义项归入首选组）。 */
export function fontGroupsOf(stack: string, tier: FontTier): Array<FontPartGroup> {
  const groups = new Map<string, Array<string>>();
  for (const part of splitFontStack(stack)) {
    const slot = SLOT_OF_CATEGORY[fontCategoryForTier(part)] ?? "primary";
    const list = groups.get(slot);
    if (list) list.push(part);
    else groups.set(slot, [part]);
  }
  return FONT_SLOTS[tier].map((slot) => {
    const items = groups.get(slot.key) ?? [];
    return { slot: slot.key, label: slot.label, editable: !slot.fixed, items };
  });
}

/** 某一槽位在输入框里的值：组内首项（去掉引号；内置变量项显示为空 = 用默认）。 */
export function slotInputValue(stack: string, tier: FontTier, slotKey: string): string {
  const group = fontGroupsOf(stack, tier).find((g) => g.slot === slotKey);
  const first = group?.items[0] ?? "";
  return first.startsWith("var(") ? "" : first.replaceAll(/^['"]|['"]$/gu, "");
}

/** 含空格 / 非 ASCII 的 family 名必须加引号，否则 CSS 把空格当分隔符解析断句。 */
function quoteFamily(family: string): string {
  return /\s/.test(family) || /[^A-Za-z0-9_ -]/.test(family) ? `"${family}"` : family;
}

/**
 * 把某一槽位的字体换成用户填的那一种（ISSUE #3784 补充：不同部分配不同的字体）；
 * `family` 为空 = 该槽恢复默认项。其余槽原样、栈内顺序不变。
 */
export function stackWithSlotFont(
  stack: string,
  tier: FontTier,
  slotKey: string,
  family: string | null,
): string {
  const slotIndex = slotIndexOf(slotKey, tier);
  const replacement =
    family === null
      ? (fontGroupsOf(defaultStackOf(tier), tier).find((g) => g.slot === slotKey)?.items ?? [])
      : [quoteFamily(family)];
  const out: Array<string> = [];
  let inserted = false;
  for (const part of splitFontStack(stack)) {
    const partSlot = SLOT_OF_CATEGORY[fontCategoryForTier(part)] ?? "primary";
    if (partSlot === slotKey) {
      if (!inserted) {
        out.push(...replacement);
        inserted = true;
      }
      continue;
    }
    if (!inserted && slotIndexOf(partSlot, tier) > slotIndex) {
      /* 原栈里没有这一槽的项（被清空过）：插在下一个槽前面，保住优先级顺序。 */
      out.push(...replacement);
      inserted = true;
    }
    out.push(part);
  }
  if (!inserted) {
    out.push(...replacement);
  }
  return out.join(", ");
}
