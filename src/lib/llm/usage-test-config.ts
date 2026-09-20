// ── 「实际使用」测试弹窗的纯逻辑/常量 ───────────────────────────
// 弹窗把请求体额外字段做成结构化行编辑（替代原先手填整段 JSON）：
// 每行一个字段名 key + 一个值 value，值可为文本 / 数字 / 图片。
// 本文件只放可被单测的纯函数与常量，DOM / FileReader 等留在视图层。

import { withQuery } from "~/lib/query-string";

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

/** 各 mode 的取值要求与所需媒体字段说明（按 Agnes 文档措辞归纳，
 *  其它模型若取值不同可直接手改，不写死）。 */
export const VIDEO_MODE_HINT: Record<string, string> = {
  text: "文生视频：仅靠提示词生成，不能带 first_frame / images 等媒体字段",
  keyframe: "首帧/尾帧控制：需额外传入 first_frame（或 last_frame）图片",
  reference: "参考图/音频驱动：需额外传入 images 或 audios 至少一类",
};

/** 视频「请求体额外字段」的预填模板：mode 是大多数视频接口的必填项，
 *  一打开弹窗就可见可改，避免首次执行就因缺 mode 被 400。 */
export function defaultVideoFields(): UsageField[] {
  return [{ key: "mode", value: "text" }];
}

/** 视频请求里承载媒体（图片/音频）的字段名集合。mode=text 不允许携带它们
 *（Agnes 等提供方会以 invalid mode 拒绝），选中 text 时这些行应隐藏/删除。 */
export const VIDEO_MEDIA_FIELD_KEYS = [
  "first_frame",
  "last_frame",
  "images",
  "audios",
] as const;

/** 视频 mode=text 时是否应隐藏媒体字段行：text 只靠提示词生成，
 *  带媒体字段会被提供方拒绝（invalid mode）。 */
export function videoModeHidesMedia(fields: UsageField[]): boolean {
  const mode =
    fields
      .find((f) => f.key.trim() === "mode")
      ?.value.trim()
      .toLowerCase() ?? "";
  return mode === "text";
}

/** 判断某行是不是媒体行：字段名命中媒体字段集合（first_frame / images 等）。 */
export function isMediaField(key: string): boolean {
  return (VIDEO_MEDIA_FIELD_KEYS as readonly string[]).includes(key.trim());
}

/** 媒体字段对图片地址的公网可达要求说明（Agnes 等要求其服务可拉取该 URL，
 *  本地 data URL 无法满足——需填公网图片地址）。 */
export const MEDIA_URL_NOTICE =
  "图片地址需提供方可公网访问（http(s) 开头）；本地 data URL 仅适合支持内联图片的接口。";

/** 视频请求缺媒体字段时（mode 与已填字段明显不匹配）给出的人文提示。
 *  仅做「该传什么」的引导，不做硬校验——各家接口规则不一，以服务端报错为准。 */
export function videoModeMissingHint(fields: UsageField[]): string | null {
  const mode = fields.find((f) => f.key.trim() === "mode")?.value.trim() ?? "";
  const keys = new Set(fields.map((f) => f.key.trim()));
  if (
    mode === "keyframe" &&
    !keys.has("first_frame") &&
    !keys.has("last_frame")
  ) {
    return "mode=keyframe 需要 first_frame（或 last_frame）图片：添加一行字段名 first_frame，填公网可访问的图片地址（http(s) 开头），或点「上传」选本地图片。";
  }
  if (mode === "reference" && !keys.has("images") && !keys.has("audios")) {
    return 'mode=reference 需要 images（或 audios）：添加一行字段名 images，值填公网可访问的图片地址（http(s) 开头）；单张直接贴 URL 即可，多张用逗号分隔或 JSON 数组写法 ["…","…"]。';
  }
  if (mode === "text") {
    const forbidden = ["first_frame", "last_frame", "images", "audios"].filter(
      (k) => keys.has(k),
    );
    if (forbidden.length > 0) {
      return `mode=text 不能携带媒体字段（${forbidden.join(" / ")}）：请删掉这些行，或把 mode 改成 keyframe / reference。`;
    }
  }
  return null;
}

/** 服务端按「数组」接收的媒体字段（可携带多张参考图/音频）。这类字段常被用户
 *  贴成一张裸 URL 字符串，而服务端期望 []string——不包成数组就会 400
 *  （原文是 cannot unmarshal string into []string，即「无法把字符串解成字符串数组」）。 */
export const MEDIA_ARRAY_FIELD_KEYS = ["images", "audios"] as const;

/** 判断字段是不是数组型媒体字段（命中 images / audios 等，含首尾空白）。 */
export function isMediaArrayField(key: string): boolean {
  return (MEDIA_ARRAY_FIELD_KEYS as readonly string[]).includes(key.trim());
}

/** 把结构化字段行转成请求体的 JSON 对象字符串（服务器按 JSON 对象逐键合并）。
 * 值若本身是 JSON 字面量（数字 / 布尔 / 数组 / 对象 / null）则原样解析，
 * 否则按字符串处理——这样 seed=42 是数字、图片 data-URL 是字符串都对。
 * 特例：images / audios 这类数组媒体字段，若拿到的是单个 URL 字符串（裸地址
 *  或带引号的 "…"）会自动包成数组，避免服务端期望 []string 却收到 string 而 400。 */
export function usageFieldsToJson(fields: UsageField[]): string {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const key = f.key.trim();
    const value = f.value.trim();
    if (!key || value === "") continue;
    let parsed: unknown;
    let isLiteral = false;
    try {
      parsed = JSON.parse(value);
      isLiteral = true;
    } catch {
      /* 非合法 JSON 字面量（如裸图片 URL / 普通文本） */
    }
    if (isLiteral) {
      out[key] = parsed;
      // 数组媒体字段：合法 JSON 却是单个字符串（用户可能写了带引号的 "url"）
      // → 包成数组，避免服务端期望 []string 却收到 string 而 400。
      if (isMediaArrayField(key) && typeof parsed === "string") {
        out[key] = [parsed];
      }
    } else if (isMediaArrayField(key)) {
      // 数组媒体字段：用户贴的裸 URL（逗号分隔可多张）→ 拆成字符串数组。
      out[key] = value
        .split(",")
        .map((u) => u.trim())
        .filter(Boolean);
    } else {
      out[key] = value; // 其余字段按字符串保留（如 first_frame 单图）
    }
  }
  return Object.keys(out).length ? JSON.stringify(out, null, 2) : "";
}

/** 判断某行值是否值得尝试做「图片预览」：data:image 或 http(s) 地址。
 *  与 looksLikeImage 不同——后者要求路径带图片扩展名才返回 true，会漏掉大量
 *  真实存在但「无扩展名」的 CDN 图片地址（如 Bing 缩略图、云存储
 *  签名 URL 等，其响应 content-type 是 image/jpeg 但路径没有 .jpg）。而一个
 *  地址究竟是不是可解码图片，只有浏览器真正加载后才知道，因此预览入口放开到
 *  「是 URL 就尝试」，交由 <img onError> 兜底优雅降级。 */
export function isPreviewableUrl(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  return /^data:image\//i.test(v) || /^https?:\/\//i.test(v);
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

/** mode 字段是否已被破坏：值为空，或看起来像图片地址/过长的杂值——
 *  典型场景是用户误在 mode 行上传/粘贴了参考图，把 text / keyframe /
 *  reference 覆盖成了图片，导致提交 400 invalid mode。 */
export function isModeValueBroken(value: string): boolean {
  const v = value.trim();
  return v === "" || looksLikeImage(v) || v.length > 64;
}

/** mode 值自愈：值被图片/杂值覆盖时回落到 text（可见且可再改），
 *  其余原样返回。仅修复值本身，不动用户其它字段行。 */
export function sanitizeModeValue(value: string): string {
  return isModeValueBroken(value) ? "text" : value;
}

/** 「额外字段」一键预设：固定名称的常用字段，避免手输拼错 / 反复键入。
 *  key → 界面按钮文案说明；点对应「＋」即自动补一行该字段名的行。
 *  视频 reference / keyframe 必用的 images / first_frame 等都在列，命中即加。 */
export const USAGE_FIELD_PRESETS: ReadonlyArray<{
  key: string;
  hint: string;
}> = [
  { key: "seed", hint: "随机种子" },
  { key: "duration", hint: "时长(秒)" },
  { key: "images", hint: "参考图 / 输入图列表" },
  { key: "first_frame", hint: "首帧图片" },
  { key: "last_frame", hint: "尾帧图片" },
  { key: "audios", hint: "参考音频" },
];

/** 判断某个固定名是否已被作为字段行加入（避免一键预设时重复堆空行）。 */
export function hasUsageFieldKey(fields: UsageField[], key: string): boolean {
  return fields.some((f) => f.key.trim() === key.trim());
}

/* ── 弹窗草稿保留 + 产物本地落盘的文件名/扩展名推断（纯函数） ── */

/** 每个模型条目的测试弹窗草稿稳定键：kind + 条目名。
 * 用于「关闭弹窗后重新打开时恢复上次填写内容 / 状态 / 执行流程」。 */
export function usageTestDraftKey(kind: string, name: string): string {
  return `${kind}::${name}`;
}

/** 从产物 URL 推断合理的文件扩展名（供存到本地 temp 用）。
 *  远程 http(s) 地址按路径扩展名取；data:image/xxx 按 mime 取；
 *  其它一律回落默认扩展名（图片 png / 视频 mp4）。返回不含点的扩展名。 */
export function mediaExtensionFromUrl(
  url: string,
  fallback: "png" | "mp4",
): string {
  const u = url.trim();
  if (u.startsWith("data:image/")) {
    const m = /^data:image\/([a-zA-Z0-9.+-]+)/.exec(u);
    if (m?.[1]) {
      const ext = m[1]
        .toLowerCase()
        .replace("jpeg", "jpg")
        .replace("svg+xml", "svg");
      if (/^[a-z0-9]{1,8}$/.test(ext)) return ext;
    }
    return fallback;
  }
  if (/^https?:\/\//i.test(u)) {
    const pathPart = u.split(/[?#]/)[0] ?? "";
    const dot = pathPart.lastIndexOf(".");
    if (dot >= 0 && dot < pathPart.length - 1) {
      const ext = pathPart.slice(dot + 1).toLowerCase();
      if (/^[a-z0-9]{1,8}$/.test(ext)) return ext;
    }
  }
  return fallback;
}

/** 根据用途取默认产物扩展名（图片 png，视频 mp4）。 */
export function mediaDefaultExt(kind: string): "png" | "mp4" {
  return kind === "video" ? "mp4" : "png";
}

/** 远端任务（如异步视频）状态查询地址（http 可达）。任务制接口提交后返回任务
 *  ID，需轮询某个查询端点取回最终产物。不同提供方习惯不同，返回两个候选形状：
 *  ① REST 风格 {base}{pathDir}/{taskId}（如 /v1/videos/{id}）
 *  ② Agnes 系 {origin}/agnesapi?video_id={id}&model_name={model}
 *  由调用方逐个尝试，读到媒体 URL 即视为完成。纯字符串拼装，可单测。 */
export interface VideoPollUrl {
  /** REST 风格：任务 ID 直接拼在端点目录后 */
  rest: string;
  /** Agnes 系带签名查询串；origin 解析失败时为 null（跳过该候选） */
  agnes: string | null;
}

/** 端点路径的目录部分（/videos/generations → /videos），用于任务轮询拼接。 */
export function videoEndpointDir(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx <= 0 ? "" : path.slice(0, idx);
}

/** 构造远端视频任务的状态查询候选 URL（纯函数，服务端提交 / 继续查询共用）。 */
export function buildVideoPollUrls(
  baseUrl: string,
  path: string,
  model: string,
  taskId: string,
): VideoPollUrl {
  const base = baseUrl.replace(/\/+$/, "");
  const dir = videoEndpointDir(path);
  let agnes: string | null = null;
  try {
    /* 上游供应商的地址模板也走查询串出口：编码与省略口径同一处
     *（规范 16 §16.2.4.32）—— 它是跨域地址，但参数拼装是同一件事。 */
    agnes = withQuery(`${new URL(base).origin}/agnesapi`, {
      video_id: taskId,
      model_name: model,
    });
  } catch {
    agnes = null;
  }
  return {
    rest: `${base}${dir}/${taskId.replace(/^\/+/, "")}`,
    agnes,
  };
}
