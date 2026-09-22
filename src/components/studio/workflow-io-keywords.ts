/**
 * 工作流 IO 的**关键字匹配器**叶子模块。
 *
 * 「这条 pin 是不是宽度 / 高度 / 宽高比 / 百万像素 / 倍数 / 时长 / 画质?」
 * 的判据集中处。主模块的 `inferControlFromName`（决定控件类型）与
 * `workflow-io-groups.ts`（决定分组与预设）共用同一批判据，必须**同源**——
 * 否则「画布上认它是宽高比、下拉里认它是 text」这类分叉就会长出来。
 * 因此单独沉成叶子，两侧从它 import。
 */

/* ── 关键字匹配器（名字 + 标签，忽略大小写）── */
export function isDimWidth(e: { name?: string; label?: string }): boolean {
  const name = (e.name ?? "").toLowerCase();
  const label = (e.label ?? "").toLowerCase();
  if (name.includes("width")) return true;
  if (label === "宽度" || label === "横" || label === "横向") return true;
  if (name === "宽") return true;
  return false;
}
export function isDimHeight(e: { name?: string; label?: string }): boolean {
  const name = (e.name ?? "").toLowerCase();
  const label = (e.label ?? "").toLowerCase();
  /* NOTE: a bare "高" inside a 画质 label like "高清" must NOT count as the
   *  height pin — we only accept the exact Chinese shape 高度/纵向/纵 or the
   *      *  英文名字，绝不能是某个无关标签的子串。 */
  if (/height|heigth/.test(name)) return true;
  if (label === "高度" || label === "纵" || label === "纵向") return true;
  if (name === "高") return true;
  return false;
}
export function isDimAspect(e: { name?: string; label?: string }): boolean {
  const name = (e.name ?? "").toLowerCase();
  const label = (e.label ?? "").toLowerCase();
  if (/\baspect_ratio\b/.test(name) || /\baspect\b|\bratio\b/.test(name))
    return true;
  if (label === "宽高比" || label.includes("比例") || label.includes("纵横"))
    return true;
  return false;
}
export function isDimMegapixels(e: { name?: string; label?: string }): boolean {
  const name = (e.name ?? "").toLowerCase();
  const label = (e.label ?? "").toLowerCase();
  if (name.includes("megapixel")) return true;
  if (label.includes("百万像素") || label.includes("像素")) return true;
  return false;
}
export function isDimMultiple(e: { name?: string; label?: string }): boolean {
  const name = (e.name ?? "").toLowerCase();
  const label = e.label ?? "";
  if (/multiple|upscale_factor|upscale_by|upscale_amount/.test(name))
    return true;
  if (label.includes("倍数") || label.includes("倍率")) return true;
  return false;
}
export function isVideoLength(e: { name?: string; label?: string }): boolean {
  const searchText = `${e.name ?? ""} ${e.label ?? ""}`.toLowerCase();
  return /length|duration|时长|帧数|frames|seconds|秒/.test(searchText);
}
export function isVideoAspect(e: { name?: string; label?: string }): boolean {
  const searchText = `${e.name ?? ""} ${e.label ?? ""}`.toLowerCase();
  return /aspect|ratio|比例|纵横/.test(searchText);
}
export function isVideoQuality(e: { name?: string; label?: string }): boolean {
  const searchText = `${e.name ?? ""} ${e.label ?? ""}`.toLowerCase();
  return /quality|clarity|清晰|画质/.test(searchText);
}
