import { promises as fs } from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
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
} from "@/lib/materials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ── 画布素材库 API ───────────────────────────────────────────
 * 文件系统支撑，落点 public/generated/materials/{scope}/{folder}/。
 * 详见 src/lib/materials.ts 顶部的存储选型说明。
 *
 * GET    /api/materials?projectId=proj_1&scope=project
 *          → { folders: [{id,name,count}], items: [] }           列分类
 * GET    /api/materials?projectId=proj_1&folder=docs
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
  projectId: string | null
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
  try {
    const url = new URL(req.url);
    const projectId = sanitizeScope(url.searchParams.get("projectId"));
    const scopeMode = url.searchParams.get("scope"); // "project" | "cross"
    const folder = url.searchParams.get("folder")?.trim() || null;
    const q = url.searchParams.get("q")?.trim().toLowerCase() || null;

    const scopes = await resolveScopes(scopeMode, projectId);

    // 分类计数始终返回，面板顶部/返回上级都要用
    const byFolder = await collectByFolder(scopes);
    const folders = MATERIAL_FOLDERS.map((f) => ({
      id: f.id,
      name: f.name,
      count: byFolder.get(f.id)?.length ?? 0,
    }));

    let items: MaterialItem[] = [];
    if (q) {
      // 搜索优先于 folder：跨所有分类找名字匹配的
      const pool: MaterialItem[] = [];
      for (const f of MATERIAL_FOLDERS) pool.push(...(byFolder.get(f.id) ?? []));
      items = pool.filter((it) => it.name.toLowerCase().includes(q));
    } else if (folder) {
      if (!isValidFolder(folder)) {
        return NextResponse.json({ error: `未知分类：${folder}` }, { status: 400 });
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
  } catch (e: any) {
    console.error(`[materials] GET failed | ${e?.message ?? e}`);
    return NextResponse.json(
      { error: e?.message ?? "读取素材库失败", folders: [], items: [] },
      { status: 500 }
    );
  }
}

/** 上传素材。multipart/form-data: file, projectId, folder, shared? */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "未收到文件" }, { status: 400 });

    const folder = String(form.get("folder") ?? "").trim();
    if (!isValidFolder(folder)) {
      return NextResponse.json({ error: `未知分类：${folder || "(空)"}` }, { status: 400 });
    }

    // shared=true 时落到共享目录，否则落到项目目录
    const shared = String(form.get("shared") ?? "") === "true";
    const projectId = sanitizeScope(String(form.get("projectId") ?? ""));
    const scope = shared ? SHARED_SCOPE : projectId;
    if (!scope) {
      return NextResponse.json(
        { error: "缺少 projectId（或改用 shared=true 上传到共享素材）" },
        { status: 400 }
      );
    }

    const safeName = sanitizeFileName(file.name);
    if (!safeName) return NextResponse.json({ error: "文件名不合法" }, { status: 400 });

    const dir = folderDir(scope, folder);
    if (!dir) return NextResponse.json({ error: "路径不合法" }, { status: 400 });
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
          folder
        )}/${encodeURIComponent(finalName)}`,
        size: buf.length,
        scope,
      },
    });
  } catch (e: any) {
    console.error(`[materials] POST failed | ${e?.message ?? e}`);
    return NextResponse.json({ error: e?.message ?? "上传失败" }, { status: 500 });
  }
}

/** 删除素材。?id=scope/folder/name（GET 返回的 item.id 原样回传）。 */
export async function DELETE(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id")?.trim();
    if (!id) return NextResponse.json({ error: "缺少 id" }, { status: 400 });

    const parts = id.split("/");
    if (parts.length !== 3) {
      return NextResponse.json({ error: "id 格式应为 scope/folder/name" }, { status: 400 });
    }
    const scope = sanitizeScope(parts[0]);
    const folder = parts[1];
    const name = sanitizeFileName(parts[2]);
    if (!scope || !isValidFolder(folder) || !name) {
      return NextResponse.json({ error: "id 不合法" }, { status: 400 });
    }

    const dir = folderDir(scope, folder);
    if (!dir) return NextResponse.json({ error: "路径不合法" }, { status: 400 });

    const target = path.join(dir, name);
    // 再确认一次目标仍在该分类目录内（双保险）
    if (!target.startsWith(dir + path.sep)) {
      return NextResponse.json({ error: "路径不合法" }, { status: 400 });
    }

    try {
      await fs.unlink(target);
    } catch (e: any) {
      if (e?.code === "ENOENT") {
        // 已经不在了，视作成功（幂等删除）
        return NextResponse.json({ ok: true, alreadyGone: true });
      }
      throw e;
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error(`[materials] DELETE failed | ${e?.message ?? e}`);
    return NextResponse.json({ error: e?.message ?? "删除失败" }, { status: 500 });
  }
}
