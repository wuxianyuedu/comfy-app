/* ── 「扩展名 ⇄ MIME 类型」的唯一出口（规范 16 §16.2.4.51）──────────────
 *
 * 按**形态**扫描撞出来的账（ISSUE #672）：同一件「这个扩展名对应什么 MIME、
 * 这个 MIME 该落成什么扩展名」，在全库有 **6 份互不相同的映射表**：
 *
 *   api/generated/[...path]/route.ts   EXT→MIME  13 条（产物流响应的 Content-Type）
 *   lib/workshop/media-source.server   EXT→MIME   7 条（拉不到 content-type 时兜底）
 *   lib/workshop/character-portrait    MIME→EXT   5 条（data URL 落成素材文件）
 *   api/workshop-local/prepare/route   MIME→EXT   4 条（参考图进 ComfyUI input）
 *   api/film/bgm/route.ts              EXT         `path.extname(file.name) || ".mp3"`
 *   api/upload/route.ts                EXT         `file.name.lastIndexOf(".")` 手切
 *
 * 关键认识：**六份表的差异不是「覆盖面不同」这一件小事**。它们互相矛盾——
 * `image/avif` 只在其中两份里有、`image/webp` 在 prepare 那份里缺、而
 * `api/generated` 那份还多背了 `text/plain` / `application/json`（它服务的是
 * **磁盘上的任意产物文件**，不只是媒体）。同一个上传文件在「走 resolveMediaBytes
 * 兜底」与「走 prepare 路由落盘」两条路径上，会得到**不同的扩展名与 Content-Type**。
 *
 * 收口口径（与 §16.2.4.19 的进度值同款：「只搬定义、不动取值」）：
 *   · 本模块是「媒体扩展名 ⇄ MIME」的**单一事实源**，两边各一次；
 *   · **不合并成一张表就完事** —— `api/generated` 需要「非媒体产物」（txt/json）
 *     的档位，那是**它自己的域需求**，用 `contentTypeForPath()` 显式表达：
 *     媒体档走本模块，媒体之外的档留在调用处（这样「谁是媒体」只有一处定义）；
 *   · **兜底值也不该各写各的**：三个落点各写 `?? "png"` / `?? "image/png"` /
 *     `?? "application/octet-stream"` —— 兜底取决于是「浏览器当图片渲染」还是
 *     「HTTP 响应头」，前者归本模块的 `DEFAULT_IMAGE_MIME`，后者由调用处
 *     在明确语境下给（`application/octet-stream` 是「我不知道」，与「当 png 看」
 *     是两件事）。
 *
 * 纯字符串查表、零依赖、与 React / Node 无关 —— 因此是 `src/lib/media/` 下的
 * 叶子模块（同 `media-kind.ts`：被浏览器与服务端两侧读取，不能带 `server-only`）。
 */

/** 浏览器侧的「不知道类型就当图片」兜底（上传/落盘路径的默认值）。 */
export const DEFAULT_IMAGE_MIME = "image/png";

/**
 * 扩展名（带或不带前导点，大小写不敏感）→ MIME。
 *
 * **媒体档**（image / video / audio）—— 非媒体类型不在这里：产物流路由要
 * 服务磁盘上的任意文件（`.txt` / `.json`），那是它自己的域需求。返回 `null`
 * 表示「这不是一个已知的媒体扩展名」，由调用处决定兜底（`?? "application/octet-stream"`
 * 还是 `?? DEFAULT_IMAGE_MIME`）。
 */
export function mimeForExt(ext: string | null | undefined): string | null {
  if (!ext) return null;
  return EXT_TO_MIME[ext.replace(/^\./, "").toLowerCase()] ?? null;
}

/**
 * MIME → 落盘扩展名（**不带点**，可直接拼进文件名）。
 *
 * 返回 `null` 表示未知类型 —— 调用处需显式给兜底（`?? "png"` 是「当图片存」、
 * `?? ""` 是「不加后缀」）。刻意**不**在出口里塞默认值：这个默认值在
 * 「素材库落盘」与「ComfyUI input 上传」两处语义相同（都当图片），但在别的
 * 语境下未必 —— 让调用处写出来，差异才看得见。
 */
export function extForMime(mime: string | null | undefined): string | null {
  if (!mime) return null;
  /* `content-type` 常带参数（`image/png; charset=utf-8`），先切干净。 */
  const bare = mime.split(";")[0]?.trim().toLowerCase();
  if (!bare) return null;
  return MIME_TO_EXT[bare] ?? null;
}

/* ── 两张表（互为反函数的部分）─────────────────────────────────────────
 * 用两张手写表而不是「一张 + 反转」：`jpeg` 与 `jpg` 两个扩展名映到同一个
 * MIME，反转时只该保留一个（`jpg`）—— 反转会产出不确定的结果。
 *
 * 覆盖面取**六份旧表的并集**，并且只取「媒体」这一侧：
 *   · `svg` 计入（素材库白名单收 `image/svg+xml`，`kindOf` 也把它判成图片）；
 *   · `avif` / `bmp` 计入（素材库与定妆照两条路径都在用，旧表各缺一半）；
 *   · `mov` / `mkv` / `avi` 计入（`media-kind.ts` 的 `VIDEO_EXT` 有它们，
 *     产物流路由也在用 `mov`）；
 *   · `txt` / `json` 等**非媒体**不入 —— 那是 `api/generated` 的域需求。
 */
const EXT_TO_MIME: Record<string, string> = {
  /* 图片 */
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  avif: "image/avif",
  svg: "image/svg+xml",
  /* 视频 */
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  /* 音频 */
  wav: "audio/wav",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  flac: "audio/flac",
  aac: "audio/aac",
};

const MIME_TO_EXT: Record<string, string> = {
  /* 图片 */
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  /* 视频 */
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "video/x-matroska": "mkv",
  "video/x-msvideo": "avi",
  /* 音频 */
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/ogg": "ogg",
  "audio/flac": "flac",
  "audio/aac": "aac",
};

/**
 * 从文件名 / 路径取扩展名（**不带点**，小写）；取不到返回 `""`。
 *
 * 与 `path.extname()` 的差别：**零 Node 依赖**（本模块要被浏览器侧读），
 * 且对「文件名里没有点」与「点在段首（`.gitignore`）」给同一种答案（都是空）。
 * 调用处此前各写一份 `lastIndexOf(".")` 手切，漏掉「没有点」时给出整段文件名
 * 当扩展名。
 */
export function extOfPath(p: string | null | undefined): string {
  if (!p) return "";
  /* 先剥查询串与 hash（URL 形态的入参很常见），再取最后一段的最后一个点。 */
  const pathPart = p.split(/[?#]/)[0] ?? "";
  const lastSegment = pathPart.split(/[\\/]/).pop() ?? "";
  const dot = lastSegment.lastIndexOf(".");
  /* 点在段首（隐藏文件）或不在段里 → 没有扩展名。 */
  if (dot <= 0) return "";
  return lastSegment.slice(dot + 1).toLowerCase();
}

/**
 * 文件路径 → MIME（**含非媒体档**的调用处助手）。
 *
 * `api/generated` 服务的是磁盘上的任意产物文件，除了媒体还要回 `text/plain`
 * / `application/json` / 未知二进制的 `application/octet-stream`。这里把那
 * 「媒体之外」的一档收在本模块**一处**（而不是让调用处既维护一张媒体表、
 * 又维护一张补集表）—— 它是「这条 HTTP 响应该报什么类型」的唯一答案。
 */
export function contentTypeForPath(p: string): string {
  const ext = extOfPath(p);
  const media = mimeForExt(ext);
  if (media) return media;
  if (ext === "txt" || ext === "md" || ext === "log") {
    return "text/plain; charset=utf-8";
  }
  if (ext === "json") return "application/json; charset=utf-8";
  /* 「我不知道这是什么」—— 不是「当 png 看」。两者语义不同，不该混用兜底值。 */
  return "application/octet-stream";
}

/**
 * 从文件名 / 路径取**去后缀的文件名**（基名）；取不到后缀时原样返回。
 *
 * 与 `extOfPath` 配对：调用处要「展示名 + 后缀分开放」时用这一对，不要自己写
 * `slice(0, len - ext.length - 1)` —— 那种算法在「没有后缀」时会多切掉一个
 * 字符（收口前 bgm 路由正是踩了这个，只是它把后缀又拼了一次，表现成
 * `name.mp3.mp3`，因为那个多切的分支只有「没有点」时才走到）。
 */
export function stemOfPath(p: string | null | undefined): string {
  if (!p) return "";
  const pathPart = p.split(/[?#]/)[0] ?? "";
  const lastSegment = pathPart.split(/[\\/]/).pop() ?? "";
  const ext = extOfPath(lastSegment);
  if (!ext) return lastSegment;
  return lastSegment.slice(0, lastSegment.length - ext.length - 1);
}
