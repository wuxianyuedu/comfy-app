/** 把字体栈按展示口径归一化（折叠空白），用于比较“是否为默认”。 */
export function normalizeFontStack(value: string): string {
  return value.replaceAll(/\s+/gu, " ").trim();
}
