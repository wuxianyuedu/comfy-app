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
