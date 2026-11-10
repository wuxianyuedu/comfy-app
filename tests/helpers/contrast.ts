/**
 * tests/helpers/contrast.ts — WCAG 对比度的真算工具（测试基建）。
 *
 * 为什么抽成共用：颜色对比度的算法只有一处口径（sRGB 线性化 → 相对亮度 → 比值），
 * 抄进第二个用例就会漂 —— 而这一族的判据全是「读数」，读数的算法抄一份 = 判据
 * 自己会算错。第一份消费者是 `tests/sidebar-state-contrast.test.ts`（侧栏导航三态），
 * 第二份是 `tests/settings-surface-contrast.test.ts`（设置页「卡片内的一行」）。
 *
 * ⚠️ **别改回 `getComputedStyle`**：jsdom 不解析 `var()`，别名会返回字面量
 * （`var(--x)`），断言全误报。取值一律走 `tests/helpers/theme-tokens.ts`
 * （从 Tailwind 的编译产物真解析）。
 */

/** `#rrggbb` → sRGB 三个通道（0~255）。产物里主题 token 都是 6 位 hex。 */
export function channels(value: string): [number, number, number] {
  const m = /^#(?<hex>[0-9a-f]{6})$/i.exec(value.trim());
  if (!m) {
    throw new Error(`期望 6 位 hex 色值，实际是 ${JSON.stringify(value)}`);
  }
  const n = Number.parseInt(m.groups?.hex ?? "", 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG 相对亮度（sRGB 线性化后加权）。 */
export function luminance(value: string): number {
  const [r, g, b] = channels(value);
  const linear = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG 对比度，1:1 ~ 21:1（传色值的顺序不影响结果）。 */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  const [hi, lo] = x > y ? [x, y] : [y, x];
  return (hi + 0.05) / (lo + 0.05);
}
