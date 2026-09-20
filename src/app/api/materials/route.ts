import { promises as fs } from "fs";
import path from "path";
import { type NextRequest, NextResponse } from "next/server";
import { requireRequestUser } from "~/server/auth/request-user";
import { logger } from "~/server/lib/logger";
import { apiErrorBody, apiErrorDetail } from "~/lib/api-error";
import { matchesNeedle, normalizeNeedle } from "~/lib/list-filter";
import { unauthorizedResponse } from "~/server/lib/error-response";
import {
  MATERIAL_FOLDERS,
  SHARED_SCOPE,
  collectByFolder,
  folderDir,
  folderName,
  isValidFolder,
  listScopes,
  sanitizeFileName,
  sanitizeScope,
  type MaterialItem,
} from "~/lib/media/materials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ── 上传白名单：素材库覆盖 image/video/audio/doc 四类 ──
 * 与 src/lib/materials.ts 的 MaterialKind 推断保持一致；
 * 防止任意扩展名/超大体量写入 public 素材目录（OWASP A04/A05）。 */
const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/avif",
  "image/svg+xml",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-matroska",
  "video/x-msvideo",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/x-m4a",
  "audio/ogg",
  "audio/flac",
  "audio/aac",
  "application/pdf",
  "application/json",
  "text/plain",
  "text/markdown",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/zip",
]);
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/** 鉴权守卫：无有效会话时返回 401（响应对象）。 */
async function requireUser(): Promise<NextResponse | null> {
  const user = await requireRequestUser();
  if (!user) {
    return unauthorizedResponse();
  }
  return null;
}

/* ── 画布素材库 API ───────────────────────────────────────────
 * 文件系统支撑，落点 public/generated/materials/{scope}/{folder}/。
 * 详见 src/lib/materials.ts 顶部的存储选型说明。
 *
 * 端点：GET    /api/materials?projectId=proj_1&scope=project
 *          → { folders: [{id,name,count}], items: [] }           列分类
 * 端点：GET    /api/materials?projectId=proj_1&folder=docs
 *          → { folders: [...], items: [...] }                    列分类内文件
 * GET    /api/materials?projectId=proj_1&q=角色
 *          → { folders: [...], items: [...] }                    全库搜索
 * GET    ...&scope=cross                                         跨项目聚合
 * POST   multipart: file, projectId, folder                      上传
 * DELETE ?id=scope/folder/name                                   删除
 */

/** 解析出本次请求要读取的 scope 列表。 */
async function resolveScopes(
  scopeMode: string | null,
  projectId: string | null,
): Promise<string[]> {
  if (scopeMode === "cross") {
    // 跨项目：素材库下所有目录（含 _shared）
    const all = await listScopes();
    return all.length ? all : projectId ? [projectId] : [];
  }
  // 本项目：项目目录 + 共享目录（共享素材在任何项目里都应可见）
  const scopes: string[] = [];
  if (projectId) scopes.push(projectId);
  scopes.push(SHARED_SCOPE);
  return scopes;
}

export async function GET(req: NextRequest) {
  const denied = await requireUser();
  if (denied) return denied;
  try {
    const url = new URL(req.url);
    const projectId = sanitizeScope(url.searchParams.get("projectId"));
    const scopeMode = url.searchParams.get("scope"); // "project" | "cross"
    const folder = url.searchParams.get("folder")?.trim() ?? null;
    /* 归一化走 `~/lib/list-filter`（规范 16 §16.2.4.16）—— 与 tRPC 路由
     * 的同一段此前各写一遍，`trim` 与折小写都漏一处就会两侧搜索结果不一致。 */
    const q = normalizeNeedle(url.searchParams.get("q") ?? "") || null;

    const scopes = await resolveScopes(scopeMode, projectId);

    // 分类计数始终返回，面板顶部/返回上级都要用
    const byFolder = await collectByFolder(scopes);
    const folders = MATERIAL_FOLDERS.map((MATERIAL_FOLDERS) => ({
      id: MATERIAL_FOLDERS.id,
      name: MATERIAL_FOLDERS.name,
      count: byFolder.get(MATERIAL_FOLDERS.id)?.length ?? 0,
    }));

    let items: MaterialItem[] = [];
    if (q) {
      // 搜索优先于 folder：跨所有分类找名字匹配的
      const pool: MaterialItem[] = [];
      for (const f of MATERIAL_FOLDERS)
        pool.push(...(byFolder.get(f.id) ?? []));
      items = pool.filter((it) => matchesNeedle(q, it.name));
    } else if (folder) {
      if (!isValidFolder(folder)) {
        return NextResponse.json(
          { error: `未知分类：${folder}` },
          { status: 400 },
        );
      }
      items = byFolder.get(folder) ?? [];
    }

    return NextResponse.json({
      scope: scopeMode === "cross" ? "cross" : "project",
      projectId,
      folder,
      folders,
      items,
    });
  } catch (e) {
    logger.error(`[materials] GET failed | ${apiErrorDetail(e, String(e))}`);
    return NextResponse.json(
      apiErrorBody(e, "读取素材库失败", { folders: [], items: [] }),
      { status: 500 },
    );
  }
}

/** 上传素材。multipart/form-data: file, projectId, folder, shared? */
export async function POST(req: NextRequest) {
  const denied = await requireUser();
  if (denied) return denied;
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file)
      return NextResponse.json({ error: "未收到文件" }, { status: 400 });

    if (!ALLOWED_MIME.has(file.type)) {
      return NextResponse.json(
        { error: "不支持的文件类型（仅限图片 / 视频 / 音频 / 文档）" },
        { status: 400 },
      );
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: "文件大小不能超过 100MB" },
        { status: 400 },
      );
    }

    const folderRaw = form.get("folder");
    const folder = (typeof folderRaw === "string" ? folderRaw : "").trim();
    if (!isValidFolder(folder)) {
      return NextResponse.json(
        { error: `未知分类：${folder || "(空)"}` },
        { status: 400 },
      );
    }

    // shared=true 时落到共享目录，否则落到项目目录
    const sharedRaw = form.get("shared");
    const shared = (typeof sharedRaw === "string" ? sharedRaw : "") === "true";
    const projectIdRaw = form.get("projectId");
    const projectId = sanitizeScope(
      typeof projectIdRaw === "string" ? projectIdRaw : "",
    );
    const scope = shared ? SHARED_SCOPE : projectId;
    if (!scope) {
      return NextResponse.json(
        { error: "缺少 projectId（或改用 shared=true 上传到共享素材）" },
        { status: 400 },
      );
    }

    const safeName = sanitizeFileName(file.name);
    if (!safeName)
      return NextResponse.json({ error: "文件名不合法" }, { status: 400 });

    const dir = folderDir(scope, folder);
    if (!dir)
      return NextResponse.json({ error: "路径不合法" }, { status: 400 });
    await fs.mkdir(dir, { recursive: true });

    // 重名不覆盖：追加 -1 / -2 …，避免用户误丢文件
    const ext = path.extname(safeName);
    const stem = safeName.slice(0, safeName.length - ext.length);
    let finalName = safeName;
    for (let i = 1; i < 500; i++) {
      try {
        await fs.access(path.join(dir, finalName));
        finalName = `${stem}-${i}${ext}`;
      } catch {
        break; // 不存在 → 可用
      }
    }

    const buf = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(path.join(dir, finalName), buf);

    return NextResponse.json({
      ok: true,
      item: {
        id: `${scope}/${folder}/${finalName}`,
        name: finalName,
        folder,
        folderName: folderName(folder),
        url: `/api/generated/materials/${encodeURIComponent(scope)}/${encodeURIComponent(
          folder,
        )}/${encodeURIComponent(finalName)}`,
        size: buf.length,
        scope,
      },
    });
  } catch (e) {
    logger.error(`[materials] POST failed | ${apiErrorDetail(e, String(e))}`);
    return NextResponse.json(apiErrorBody(e, "上传失败"), { status: 500 });
  }
}

/** 删除素材。?id=scope/folder/name（GET 返回的 item.id 原样回传）。 */
export async function DELETE(req: NextRequest) {
  const denied = await requireUser();
  if (denied) return denied;
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id")?.trim();
    if (!id) return NextResponse.json({ error: "缺少 id" }, { status: 400 });

    const parts = id.split("/");
    if (parts.length !== 3) {
      return NextResponse.json(
        { error: "id 格式应为 scope/folder/name" },
        { status: 400 },
      );
    }
    const scope = sanitizeScope(parts[0]);
    const folder = parts[1];
    const name = sanitizeFileName(parts[2]);
    if (!scope || !isValidFolder(folder) || !name) {
      return NextResponse.json({ error: "id 不合法" }, { status: 400 });
    }

    const dir = folderDir(scope, folder);
    if (!dir)
      return NextResponse.json({ error: "路径不合法" }, { status: 400 });

    const target = path.join(dir, name);
    // 再确认一次目标仍在该分类目录内（双保险）
    if (!target.startsWith(dir + path.sep)) {
      return NextResponse.json({ error: "路径不合法" }, { status: 400 });
    }

    try {
      await fs.unlink(target);
    } catch (e) {
      if (
        typeof e === "object" &&
        e !== null &&
        "code" in e &&
        e.code === "ENOENT"
      ) {
        // 已经不在了，视作成功（幂等删除）
        return NextResponse.json({ ok: true, alreadyGone: true });
      }
      throw e;
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    logger.error(`[materials] DELETE failed | ${apiErrorDetail(e, String(e))}`);
    return NextResponse.json(apiErrorBody(e, "删除失败"), { status: 500 });
  }
}
