/**
 * 外观偏好（圆角 / 标题字阶）—— 令牌的唯一应用点与持久化形状。
 *
 * 为什么是顶层单例而不是某个页面的局部逻辑：这两档改的是**全局 CSS 变量**
 * （`--radius` 与 `--font-scale`），必须在任何路由下都成立。若只在设置页里
 * setProperty，用户离开设置页、或刷新到别的路由，偏好就悄悄不生效了 ——
 * 表现是"设置有时管用有时不管用"，这类半生效比没做更难查。
 *
 * 令牌形状（都在 `app/globals.css`，本模块不重复定义数值基准）：
 *   · `--radius` 是圆角总闸，`--radius-sm…4xl` 全部由它 calc 派生；
 *   · `--font-scale` 只作用于四档**标题**令牌，正文与小号文字不随它变
 *     （正文主力是 `text-sm`/14px，微标签 `text-2xs`/`text-3xs`）。这里曾写
 *     「正文锚定 13px」并被设置页当承诺展示给用户，实测 body 是 preflight 的
 *     16px、全站并无 13px 基准 —— 界面文案不要再写具体 px，写「保持原尺寸」。
 *
 * 刻意**没有**「界面密度」这一档：仓库里没有全局密度令牌（唯一的 `DENSITY_CLASS`
 * 是画布编辑器内部的局部常量）。做一个只影响半屏的假开关，比不做更糟。
 */
import { readStorageItem, writeStorageItem } from "~/lib/browser-storage";

/** 持久化键。 */
export const APPEARANCE_STORAGE_KEY = "comfyapp:appearance-v1";

/** 一档可选值：id 用于持久化，label 是界面文案，value 是写进 CSS 变量的值。 */
export interface AppearanceStep {
  id: string;
  label: string;
  value: string;
}

/**
 * 圆角档位。`中` 就是 `globals.css` 里 `--radius` 那颗基数（1rem）——
 * 默认档必须与"从没设置过"逐像素相同，否则升级后老用户第一眼看到的就是变化。
 *
 * 标签里的 px 是**基数** `--radius`（= `--radius-lg`）：整条刻度按系数跟着它缩放
 * （`ui/card` 走 `rounded-xl`，实际角比标签值大 4px）。改基数或改这里的值，
 * 两边必须同批 —— 文案说 16px 而实渲染 12px 就是骗用户。
 */
export const RADIUS_STEPS: AppearanceStep[] = [
  { id: "sm", label: "小 · 12px", value: "0.75rem" },
  { id: "md", label: "中 · 16px", value: "1rem" },
  { id: "lg", label: "大 · 20px", value: "1.25rem" },
  { id: "xl", label: "特大 · 24px", value: "1.5rem" },
];

/** 标题字阶档位（倍率；基准在 CSS 里）。 */
export const FONT_SCALE_STEPS: AppearanceStep[] = [
  { id: "90", label: "紧凑 90%", value: "0.9" },
  { id: "100", label: "标准 100%", value: "1" },
  { id: "110", label: "舒适 110%", value: "1.1" },
  { id: "125", label: "宽松 125%", value: "1.25" },
];

export interface AppearancePrefs {
  radius: string;
  fontScale: string;
}

/** 默认值 = `globals.css` 里 `--radius` / `--font-scale` 的基数（两者必须同批改）。 */
export const DEFAULT_APPEARANCE: AppearancePrefs = {
  radius: "md",
  fontScale: "100",
};

function stepValue(
  steps: AppearanceStep[],
  id: string,
  fallbackId: string,
): string {
  const hit = steps.find((step) => step.id === id);
  return (hit ?? steps.find((step) => step.id === fallbackId))?.value ?? "";
}

/**
 * 解析持久化值。**任何不认识的取值都整份回落默认**，不做"认哪个用哪个"：
 * 半份生效会让界面出现"圆角是新的、字号是旧的"这种无法解释的组合。
 */
export function parseAppearance(
  raw: string | null | undefined,
): AppearancePrefs {
  if (!raw) return { ...DEFAULT_APPEARANCE };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { ...DEFAULT_APPEARANCE };
  }
  const record = parsed as { radius?: unknown; fontScale?: unknown };
  if (
    typeof record.radius !== "string" ||
    typeof record.fontScale !== "string" ||
    !RADIUS_STEPS.some((step) => step.id === record.radius) ||
    !FONT_SCALE_STEPS.some((step) => step.id === record.fontScale)
  ) {
    return { ...DEFAULT_APPEARANCE };
  }
  return { radius: record.radius, fontScale: record.fontScale };
}

export function serializeAppearance(prefs: AppearancePrefs): string {
  return JSON.stringify(prefs);
}

/** 本偏好要写进 CSS 的变量集合（纯数据，便于单测）。 */
export function appearanceVars(prefs: AppearancePrefs): Record<string, string> {
  return {
    "--radius": stepValue(
      RADIUS_STEPS,
      prefs.radius,
      DEFAULT_APPEARANCE.radius,
    ),
    "--font-scale": stepValue(
      FONT_SCALE_STEPS,
      prefs.fontScale,
      DEFAULT_APPEARANCE.fontScale,
    ),
  };
}

/** 把变量写到给定元素上（默认 `<html>`，与 next-themes 的 `dark` class 同一层）。 */
export function applyAppearance(
  prefs: AppearancePrefs,
  element: HTMLElement | null | undefined = typeof document === "undefined"
    ? null
    : document.documentElement,
): void {
  if (!element) return;
  for (const [name, value] of Object.entries(appearanceVars(prefs))) {
    element.style.setProperty(name, value);
  }
}

/** 读取已保存的偏好（无存储 / 坏值都回落默认）。 */
export function readAppearance(): AppearancePrefs {
  return parseAppearance(readStorageItem(APPEARANCE_STORAGE_KEY));
}

/**
 * 保存并立即生效。
 *
 * 返回是否写进了存储 —— 隐私模式等场景 `localStorage` 会抛，此时**变量仍然生效**
 * （本次会话可用），只是下次打开回到默认。界面要把这件事说出来，不能让用户以为
 * 设置丢了。
 */
export function saveAppearance(prefs: AppearancePrefs): boolean {
  applyAppearance(prefs);
  return writeStorageItem(APPEARANCE_STORAGE_KEY, serializeAppearance(prefs));
}
