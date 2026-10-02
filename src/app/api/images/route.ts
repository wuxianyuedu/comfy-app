import { type NextRequest, NextResponse } from "next/server";

import { ComfyViewError, getView } from "~/lib/comfyui/client";
import { contentTypeForPath } from "~/lib/media/mime-ext";
import { requireRequestUser } from "~/server/auth/request-user";
import { unauthorizedResponse } from "~/server/lib/error-response";

/**
 * `GET /api/images?filename=&subfolder=&type=` —— 本机代理 ComfyUI 的 `/api/view`。
 *
 * 为什么要有这一层：浏览器直接打 ComfyUI 的 `:8188` 会被 CORS 与「私有网络访问」
 * 挡住，所以媒体字节必须经本应用同源转发。地址形状由 `~/lib/media/media-url` 的
 * `comfyImageUrl()` 一处给出（全库唯一出口），**本文件就是它那个落点** ——
 * 这个 handler 一度在基线迁移时没带过来，于是地址是对的、请求必然 404、
 * 调用点一句 `catch {}` 把 404 咽成「没有图」，界面常年空态而判据全绿（台账 E3‴）。
 *
 * 四道判据，顺序即优先级：会话 → 文件名形状 → 类别枚举 → 上游状态。
 * `type` 只认 ComfyUI 的 `input` / `output` / `temp` 三个值。
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ComfyUI 的三种文件类别；不是枚举的一律 400，不交给上游去猜。 */
const MEDIA_TYPES = new Set(["input", "output", "temp"]);

/** 目录成分：`filename` 与 `subfolder` 都不许出现分隔符或点号段。 */
function hasPathPiece(value: string): boolean {
  return value.includes("/") || value.includes("\\");
}

export async function GET(req: NextRequest): Promise<Response> {
  if (!(await requireRequestUser())) return unauthorizedResponse();

  /* 取查询串走 `new URL(req.url)`（与 `/api/materials` 同一写法），这样用例可以拿
   * 真 `Request` 顶替 `NextRequest`，不必伪造 `nextUrl`。 */
  const query = new URL(req.url).searchParams;
  const filename = (query.get("filename") ?? "").trim();
  const subfolder = (query.get("subfolder") ?? "").trim();
  const type = query.get("type") ?? "input";

  if (filename === "")
    return NextResponse.json({ error: "缺少文件名" }, { status: 400 });
  if (hasPathPiece(filename))
    return NextResponse.json({ error: "文件名不合法" }, { status: 400 });
  if (subfolder !== "" && (hasPathPiece(subfolder) || subfolder === ".."))
    return NextResponse.json({ error: "子目录不合法" }, { status: 400 });
  if (!MEDIA_TYPES.has(type))
    return NextResponse.json({ error: "媒体类别不合法" }, { status: 400 });

  let body: Buffer;
  try {
    body = await getView(filename, subfolder, type);
  } catch (e) {
    /* 三种失败给三个可分支的答案，而不是统一一个 500：
     *  · 上游明确 404 → 这一格本来就没有文件；
     *  · 上游回了别的状态 → 网关层的失败；
     *  · fetch 自己抛（连不上 / 超时）→ ComfyUI 没在跑。最后这条是**常态**
     *    （壳起来而 ComfyUI 还没起来），所以带 `hint` 让调用方能显示「未连接」
     *    而不是把它当「图不存在」画成碎图标。 */
    if (e instanceof ComfyViewError) {
      if (e.status === 404)
        return NextResponse.json({ error: "素材不存在" }, { status: 404 });
      return NextResponse.json(
        { error: `ComfyUI 回 ${e.status}` },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: "无法连接 ComfyUI", hint: "comfyui-unreachable" },
      { status: 503 },
    );
  }

  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": contentTypeForPath(filename),
      /* 两条各自独立的要求叠在这一行上：
       *  · 响应取决于「你是谁」（上面那道会话闸）⇒ 必须 `private`，
       *    `public` 等于授权共享缓存把 A 的图回给 B（口径同台账 A13）；
       *  · ComfyUI 的 `input` 目录会被同名上传覆盖 ⇒ 不许 `immutable`，
       *    只给一个短 TTL 让拖动画布时不重复取同一张。 */
      "Cache-Control": "private, max-age=60",
    },
  });
}
