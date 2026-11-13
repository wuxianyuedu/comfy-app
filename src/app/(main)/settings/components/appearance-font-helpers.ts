import type { FontTier } from "~/lib/appearance";

/** 把字体栈按展示口径归一化（折叠空白），用于比较“是否为默认”。 */
export function normalizeFontStack(value: string): string {
  return value.replaceAll(/\s+/gu, " ").trim();
}

/** 拆分逗号分隔的字体栈，去掉空项。 */
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
    return "Geist Sans（拉丁/西文字体变量）";
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

/** 给字体栈中的一项归类，便于在设置页分组展示。 */
export function fontCategoryForTier(part: string, tier: FontTier): string {
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
    return tier === "interface" ? "系统与通用回退" : "通用回退";
  }
  return "自定义/其他";
}
