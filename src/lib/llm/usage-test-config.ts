// ── 「实际使用」测试弹窗的纯逻辑/常量 ───────────────────────────
// 弹窗把请求体额外字段做成结构化行编辑（替代原先手填整段 JSON）：
// 每行一个字段名 key + 一个值 value，值可为文本 / 数字 / 图片。
// 本文件只放可被单测的纯函数与常量，DOM / FileReader 等留在视图层。

/** 「实际使用」测试弹窗的一条额外请求体字段。key 是请求体里的字段名
 *（如 mode / first_frame / image），value 为输入内容——文本、数字或图片。
 * 图片既可以是远端 URL，也可以是本地上传后转成的 data:image URL。 */
export interface UsageField {
  key: string;
  value: string;
}

/** 视频生成常见的 mode 预设（Agnes 等：text / keyframe / reference）。
 * 仅为快捷选项——选中后仍可在输入框里自由改，适配其它模型的其它取值。 */
export const VIDEO_MODE_PRESETS = ["text", "keyframe", "reference"] as const;

export const VIDEO_MODE_HINT: Record<string, string> = {
  text: "文生视频：仅靠提示词生成",
  keyframe: "首帧图生视频：额外传入首帧图 first_frame",
  reference: "参考图驱动：额外传入参考图 reference_image",
};

/** 把结构化字段行转成请求体的 JSON 对象字符串（服务器按 JSON 对象逐键合并）。
 * 值若本身是 JSON 字面量（数字 / 布尔 / 数组 / 对象 / null）则原样解析，
 * 否则按字符串处理——这样 seed=42 是数字、图片 data-URL 是字符串都对。 */
export function usageFieldsToJson(fields: UsageField[]): string {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const key = f.key.trim();
    const value = f.value.trim();
    if (!key || value === "") continue;
    try {
      const parsed: unknown = JSON.parse(value);
      out[key] = parsed;
    } catch {
      out[key] = value; // 非 JSON 字面量 → 当作字符串
    }
  }
  return Object.keys(out).length ? JSON.stringify(out, null, 2) : "";
}

/** 判断某行值是否可当作图片预览（data:image 或 http(s) 图片地址）。 */
export function looksLikeImage(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  return (
    /^data:image\//i.test(v) ||
    /^(https?:\/\/).+\.(png|jpe?g|webp|gif|avif|bmp)([?#].*)?$/i.test(v)
  );
}
