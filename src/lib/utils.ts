/**
 * 合并 Tailwind 类名。
 *
 * 当前实现：过滤 falsy 值并展平一层数组。项目后续应迁移到
 * `clsx` + `tailwind-merge` 的组合（已写入开发规范），以便在合并时
 * 正确处理 `px-2` vs `p-4` 等冲突类名。
 */
export function cn(
  ...parts: Array<string | false | null | undefined | Array<string | false | null | undefined>>
) {
  const flattened = parts.flat();
  return flattened.filter(Boolean).join(" ");
}

export function formatNumber(n: number) {
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, "") + "w";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}
