import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getServerUser } from "@/lib/auth-server";
import { listModelFolders } from "@/lib/comfyui/client";
import { modelCountsByFolder } from "@/lib/models";
import { folderMeta } from "@/lib/model-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Row shape consumed by the "模型目录配置" modal. */
export interface ModelFolderConfigRow {
  folder: string;
  /** The directory name IS the model type (R-ardot45). */
  type: string;
  label: string;
  /** Whether the user has explicitly enabled this directory. */
  enabled: boolean;
  /** Whether the user has an explicit config row for this folder. */
  hasConfig: boolean;
  /** Files currently registered from this folder. */
  count: number;
}

/**
 * GET /api/models/config
 *
 * Lists every real ComfyUI directory, with the user's overrides (if any)
 * applied.  R-ardot45: each directory IS its own model type — the `type`
 * value is simply the directory name verbatim, no auto-recognition or
 * per-row extra types.
 */
export async function GET() {
  try {
    const user = await getServerUser();
    const [rows, comfyFolders, counts] = await Promise.all([
      prisma.userModelConfig.findMany({ where: { userId: user.id } }),
      listModelFolders(),
      modelCountsByFolder(),
    ]);

    const overrides = new Map(rows.map((r) => [r.folder, r]));
    const comfySet = new Set(comfyFolders);

    const build = (folder: string): ModelFolderConfigRow => {
      const ov = overrides.get(folder);
      return {
        folder,
        type: folder,
        label: ov?.label || folderMeta(folder).label,
        enabled: ov?.enabled ?? false,
        hasConfig: Boolean(ov),
        count: counts[folder] ?? 0,
      };
    };

    // 1) Every real ComfyUI directory (primary source of truth).
    const folders: ModelFolderConfigRow[] = comfyFolders.slice().sort().map(build);

    // 2) User-configured folders ComfyUI no longer reports — surfaced so the
    // user can still delete them without surprise data loss.
    for (const r of rows) {
      if (!comfySet.has(r.folder) && !folders.some((f) => f.folder === r.folder)) {
        folders.push(build(r.folder));
      }
    }
    folders.sort((a, b) => a.folder.localeCompare(b.folder));

    return NextResponse.json({
      ok: true,
      comfyReachable: comfyFolders.length > 0,
      folders,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "读取模型目录配置失败";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/**
 * POST /api/models/config  { folder }
 *
 * Adds (or re-enables) a directory.  The type IS the directory name
 * (R-ardot45) — the user never picks one.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await getServerUser();
    const body = (await req.json().catch(() => ({}))) as {
      folder?: unknown;
      label?: unknown;
    };

    const folder = typeof body.folder === "string" ? body.folder.trim() : "";
    if (!folder) {
      return NextResponse.json({ ok: false, error: "目录名不能为空" }, { status: 400 });
    }
    if (!/^[\w./-]+$/.test(folder)) {
      return NextResponse.json(
        { ok: false, error: "目录名只能包含字母、数字、下划线、点、斜杠和连字符" },
        { status: 400 }
      );
    }

    const label = typeof body.label === "string" && body.label.trim() ? body.label.trim() : null;

    const row = await prisma.userModelConfig.upsert({
      where: { userId_folder: { userId: user.id, folder } },
      create: {
        userId: user.id,
        folder,
        type: folder,
        types: "[]",
        label,
        enabled: true,
        isCustom: true,
      },
      update: {
        type: folder,
        types: "[]",
        label,
        enabled: true,
      },
    });

    return NextResponse.json({ ok: true, config: row });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "新增模型目录失败";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/**
 * PATCH /api/models/config  { folder, enabled?, label? }
 *
 * Upserts the override row.  Instant feedback: toggling `enabled` flips the
 * registered files' availability so the library reflects the change without
 * waiting for a full re-scan.
 */
export async function PATCH(req: NextRequest) {
  try {
    const user = await getServerUser();
    const body = (await req.json().catch(() => ({}))) as {
      folder?: unknown;
      enabled?: unknown;
      label?: unknown;
    };

    const folder = typeof body.folder === "string" ? body.folder.trim() : "";
    if (!folder) {
      return NextResponse.json({ ok: false, error: "缺少 folder" }, { status: 400 });
    }

    const patch: { enabled?: boolean; label?: string | null } = {};
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    if (body.label === null) patch.label = null;
    else if (typeof body.label === "string") patch.label = body.label.trim() || null;

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ ok: false, error: "没有需要更新的字段" }, { status: 400 });
    }

    const row = await prisma.userModelConfig.upsert({
      where: { userId_folder: { userId: user.id, folder } },
      create: {
        userId: user.id,
        folder,
        type: folder,
        types: "[]",
        label: patch.label ?? null,
        enabled: patch.enabled ?? true,
        isCustom: true,
      },
      update: patch,
    });

    // Instant feedback: hide/show this folder's files without a re-scan.
    if (patch.enabled === false) {
      await prisma.model.updateMany({ where: { folder }, data: { isAvailable: false } });
    } else if (patch.enabled === true) {
      await prisma.model.updateMany({ where: { folder }, data: { isAvailable: true } });
    }

    return NextResponse.json({ ok: true, config: row });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "更新模型目录失败";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/models/config?folder=xxx
 *
 * Drops the override row and hides the folder's registered files.  Idempotent
 * (returns ok even if the row didn't exist).
 */
export async function DELETE(req: NextRequest) {
  try {
    const user = await getServerUser();
    const folder = req.nextUrl.searchParams.get("folder")?.trim() ?? "";
    if (!folder) {
      return NextResponse.json({ ok: false, error: "缺少 folder" }, { status: 400 });
    }

    await prisma.userModelConfig
      .delete({ where: { userId_folder: { userId: user.id, folder } } })
      .catch(() => null);

    await prisma.model.updateMany({ where: { folder }, data: { isAvailable: false } });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "删除模型目录失败";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}