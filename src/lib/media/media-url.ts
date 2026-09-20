// ── 「怎么把一个媒体引用变成可渲染的地址」的唯一出口（规范 16 §16.2.4.32）──
//
// 按**形态**扫描时撞出来的账：`` `/api/images?filename=${…}&type=input` ``
// 这一串在全库手拼了 **5 处**（画布内容载体节点的预览 / 相册 / 上传落点、
// 工作流图片预览、项目产出缩略图），而它们对三件事各判各的：
//
//   ① **哪些参数带** —— 三处只带 `filename` + `type`，工作流预览那处还要带
//      `subfolder`（ComfyUI 的 LoadImage 会把它挂进子目录）；
//   ② **编码有没有做** —— 五处都写了 `encodeURIComponent`，但它们各写一遍，
//      漏一处就是静默打到另一个端点（文件名带 `#` / `&` 时）；
//   ③ **什么样的值不该拼 URL** —— 相册那处写的是
//      —— 数组越界时拼出 `?filename=`（**空值**），请求打到服务端由它报错，
//      而不是在调用处就什么都不渲染（那处把可选值 `?? ""` 直接塞进了模板串）。
//
// 也就是说 —— **「这张图能不能显示」取决于它是哪个面板渲染出来的**。
// 这类差异没有报错、没有告警（拼错的 URL 只是一个 400）。
//
// 与 `~/lib/query-string` 的分工：那个管「一组值怎么写进查询串」（编码、
// 省略、重复键的口径），本模块管「媒体引用 → 预览地址」这**一件具体的事**
// （端点、参数名、`input` 类型都写在这里，调用处不再知道）。
// 谁再要拼别的端点，用 `buildQueryString`；谁要显示一张媒体，用这里。

import { buildQueryString } from "~/lib/query-string";

/** ComfyUI 侧的文件引用（`LoadImage` 的 `filename` / `subfolder` / `type` 三元组）。 */
export interface ComfyMediaRef {
  /** 文件名（可含子目录前缀，视本应用上传口径而定）。 */
  filename: string;
  /** ComfyUI 的子目录；缺省表示根目录。 */
  subfolder?: string | null;
  /** ComfyUI 的文件类别：`input`（用户上传）/ `output`（生成产物）/ `temp`。 */
  type?: string | null;
}

/** `/api/images` —— 经本应用代理读 ComfyUI 的媒体文件。 */
const IMAGES_ENDPOINT = "/api/images";

/**
 * 把 ComfyUI 的媒体引用拼成**可直接渲染**的地址；引用无效时返回 `null`。
 *
 * 返回 `null` 的情形只有一种：`filename` 是空串（或全空白）—— 那表示
 * 「这张图还不存在」（相册数组越界、上游还没产出），**不该**拼出一个
 * `?filename=` 的请求让服务端去报错：调用处拿到 `null` 就知道该什么都不渲染
 * （`MediaThumbnail` 的 `src` 本来就接受 `null | undefined`）。
 *
 * 典型调用形态：引用可能是空的（相册越界 / 上游未产出），出口直接给 `null`
 * —— 交给 `MediaThumbnail` 的 `src`（它本来就接受 `null | undefined`），
 * 不必在调用处再包一层三元。示例见 `ContentAssetNode` 的相册区。
 */
export function comfyImageUrl(ref: ComfyMediaRef): string | null {
  const filename = ref.filename?.trim() ?? "";
  if (filename === "") return null;
  return (
    IMAGES_ENDPOINT +
    "?" +
    buildQueryString({
      filename,
      subfolder: ref.subfolder,
      type: ref.type ?? "input",
    })
  );
}

/**
 * 参考图路径 → 预览地址：已经是应用内绝对路径（`/api/generated/...`）的原样
 * 返回，否则按 ComfyUI 的 `input` 文件名走 `/api/images` 代理。
 *
 * 这条判据（「以 `/` 开头 = 已经是可直接使用的路径」）收口前在
 * `ProjectOutputs` 那一处写着，而工作流预览那处**没有**判 ——
 * 于是同一个引用在两个面板里一个能显示、一个 404。
 *
 * 空值同样返回 `null`（与 `comfyImageUrl` 同口径）。
 */
export function mediaPreviewUrl(
  reference: string | null | undefined,
): string | null {
  const value = reference?.trim() ?? "";
  if (value === "") return null;
  if (value.startsWith("/")) return value;
  return comfyImageUrl({ filename: value, type: "input" });
}
