/* ── 媒体种类判据的单一事实源 ────────────────────────────────────────
 *
 * 背景（ISSUE #571）：同一件事——「这个文件名/路径是图片、视频还是音频」——
 * 在本仓库里有三份互不相同的实现，而它们**互相矛盾**：
 *
 *   src/lib/media.ts:2                  /\.(mp4|webm|ogg|m4v|mov)$/i       （无 mkv/avi，有 ogg/m4v）
 *   src/lib/materials.ts:51             /\.(mp4|webm|mov|mkv|avi)$/i       （无 ogg/m4v，有 mkv/avi）
 *   src/server/api/routers/task.ts:6    /\.(mp4|webm|mov|mkv|avi|gif)$/i   （把 gif 算成视频）
 *
 * 表现是**静默的行为分叉**：同一个产出文件从历史面板看是图片、从素材库看是
 * 文档、从任务列表看是视频。`media.ts` 的注释明确写着「gif 不是视频——它必须
 * 用 `<img>` 渲染，`<video>` 解不了 GIF，会显示黑屏」，而 task router 把 gif
 * 判成视频，正是那条注释要防的事。
 *
 * 本模块把**判据**收到一处：扩展名集合 + `kindOf()`。各调用方只保留自己
 * 「怎么用这个结论」的逻辑（渲染成 `<video>` / 归到哪个素材文件夹 / 过滤任务
 * 类型），不再各自维护一份扩展名清单。
 *
 * 为什么放 `src/lib/` 根、而不是 `src/lib/materials.ts`：本模块同时被浏览器
 * （历史面板、画布节点、视频队列）与服务端（tRPC router、素材库）读取，必须
 * **零依赖、零 `server-only`**——`materials.ts` 顶层 `import fs`，引它会把
 * Node 内建带进浏览器 chunk（ISSUE #282 / #317 的同族事故）。
 *
 * 分层约定（与 `src/lib/endpoints.ts` 一致）：本模块只回答「扩展名 → 种类」，
 * 不回答「用户配置 / 工作流模式码 → 种类」——后者是业务判断，留在各自领域。
 */

/** 媒体种类。文档类（`.pdf` / `.md` / 无扩展名等）归 `doc`。 */
export type MediaKind = "image" | "video" | "audio" | "doc";

/** 图片扩展名（**不含 `gif`**：GIF 是动画图片，但见下方 `VIDEO_EXT` 的说明）。 */
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|avif|svg)$/i;

/** 视频扩展名。
 *
 *  含 `mkv` / `avi`：素材库允许用户直接丢文件进目录，这些容器格式很常见，
 *  本机播放器能解，判成 `doc` 会让它们在素材库里消失。
 *
 *  含 `ogg` / `m4v`：`ogg` 既可音频也可视频容器，本项目 ComfyUI 产出的
 *  `ogg` 一律是视频（见 `media.ts` 的历史实现），按视频处理才能正确渲染。
 *
 *  **不含 `gif`**：`<video>` 无法解码 GIF，判成视频会渲染成黑屏。这条是
 *  `media.ts` 原本的明确注释，也是本模块存在的直接原因（task router 曾把
 *  gif 算成视频）。GIF 归 `image`，走 `<img>` 渲染。 */
const VIDEO_EXT = /\.(mp4|webm|ogg|m4v|mov|mkv|avi)$/i;

/** 音频扩展名。 */
const AUDIO_EXT = /\.(wav|mp3|flac|ogg|m4a|aac)$/i;

/**
 * 从文件名 / 路径 / URL 推导媒体种类。
 *
 * 只做**扩展名后缀匹配**，因此对 URL 查询串与 hash 天然不敏感（见测试）：
 * `clip.mp4?download=1` 不以 `.mp4` 结尾 → `doc`；这是刻意的保守行为
 * （宁可让调用方看到「未知」，也不要猜错后渲染成黑屏）。
 *
 * `ogg` 同时出现在 `VIDEO_EXT` 与 `AUDIO_EXT` 中，**判定顺序即优先级**：
 * 先图片、再视频、最后音频，故 `ogg` → `video`（与历史 `media.ts` 一致）。
 */
export function kindOf(src?: string | null): MediaKind {
  if (!src) return "doc";
  if (IMAGE_EXT.test(src)) return "image";
  if (VIDEO_EXT.test(src)) return "video";
  if (AUDIO_EXT.test(src)) return "audio";
  return "doc";
}

/**
 * 该源是否应按 `<video>` 渲染。
 *
 * 语义只有一条：**依据文件名/路径**判断。调用方若还有「工作流模式码」或
 * 「类型字段」这类**业务**判据，应先自行判定业务事实再回落到本函数，不要把
 * 两种判据混进同一个表达式（那正是 `ResultCard.tsx` 内联第四份实现的原因）。
 */
export function isVideo(src?: string | null): boolean {
  return kindOf(src) === "video";
}

/** 该源是否为音频。 */
export function isAudio(src?: string | null): boolean {
  return kindOf(src) === "audio";
}
