import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getServerUser } from "@/lib/auth-server";
import { type ValidationError, parseValidationErrors } from "@/lib/comfyui/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ── 媒体类型推导 ────────────────────────────────────────────
 * 画布「历史记录」面板要按 图片 / 视频 / 音频 分栏，但 Task 表没有
 * 直接的 media 列。推导优先级：
 *   1. 封面 TaskImage.mediaType（"image" | "video"，落盘时写入，最可靠）
 *   2. 产出文件扩展名（封面 mediaType 缺失的历史行兜底）
 *   3. Task.type（VIDEO / *2V / I2V 等 → video）
 * 音频目前没有对应的 task 类型，靠扩展名识别（后续接入 TTS 时自然生效）。
 */
const VIDEO_EXT = /\.(mp4|webm|mov|mkv|avi|gif)$/i;
const AUDIO_EXT = /\.(wav|mp3|flac|ogg|m4a|aac)$/i;

export type TaskMediaType = "image" | "video" | "audio";

function inferMediaType(
  coverPath: string | null,
  coverMediaType: string | null,
  taskType: string
): TaskMediaType {
  if (coverPath) {
    if (AUDIO_EXT.test(coverPath)) return "audio";
    if (VIDEO_EXT.test(coverPath)) return "video";
  }
  if (coverMediaType === "video") return "video";
  if (coverMediaType === "audio") return "audio";
  if (coverMediaType === "image") return "image";
  // 无产出（排队中 / 失败）时只能靠 task.type 猜测意图
  if (/video|2V$|^T2V|^I2V|FLF/i.test(taskType)) return "video";
  if (/audio|tts|voice/i.test(taskType)) return "audio";
  return "image";
}

// List the current user's tasks (their "我的作品" gallery).
//
// Query params (all optional — 无参调用行为与改造前完全一致):
//   take=<n>            上限 200，默认 60
//   projectId=<id>      仅返回归属该画布项目的任务（画布内历史记录面板用）
//   media=image|video|audio   按推导出的媒体类型过滤
//   status=<S1,S2>      按任务状态过滤（逗号分隔，如 SUCCEEDED,RUNNING）
export async function GET(req: NextRequest) {
  try {
    const user = await getServerUser();
    const url = new URL(req.url);
    const take = Math.min(Number(url.searchParams.get("take") ?? 60) || 60, 200);
    const projectId = url.searchParams.get("projectId")?.trim() || null;
    const media = url.searchParams.get("media")?.trim().toLowerCase() || null;
    const statusRaw = url.searchParams.get("status")?.trim() || null;

    const statusList = statusRaw
      ? statusRaw
          .split(",")
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean)
      : null;

    const where: Record<string, unknown> = { userId: user.id };
    if (projectId) where.projectId = projectId;
    if (statusList && statusList.length > 0) where.status = { in: statusList };

    // media 过滤是在推导后于内存中做的（推导依赖封面扩展名，SQL 无法直接表达），
    // 所以先多取一些行再截断，避免过滤后不足 take 条。
    const overFetch = media ? Math.min(take * 4, 400) : take;

    const tasks = await prisma.task.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: overFetch,
      include: {
        // isCover 优先；某些历史行没有标记封面，故再兜底取第一张
        images: { orderBy: [{ isCover: "desc" }, { sortIndex: "asc" }], take: 1 },
      },
    });

    let list = tasks.map((t) => {
      const p = (t.params as Record<string, any>) ?? {};
      // R-Next (2026-08-17): surface parsed structured validation errors so the
      // history list can render a precise failure breakdown (not just a string).
      const validationErrors: ValidationError[] | null = parseValidationErrors(
        t.validationErrors
      );
      const cover = t.images[0]?.localPath ?? null;
      const coverMediaType = t.images[0]?.mediaType ?? null;
      return {
        id: t.id,
        type: t.type,
        workflowName: t.workflowName,
        status: t.status,
        prompt: t.prompt,
        createdAt: t.createdAt,
        cover,
        checkpoint: p.checkpoint ?? null,
        validationErrors,
        // ── 新增（向后兼容：老调用方忽略即可）──
        mediaType: inferMediaType(cover, coverMediaType, t.type),
        projectId: t.projectId ?? null,
        progress: t.progress,
        error: t.error ?? null,
      };
    });

    if (media === "image" || media === "video" || media === "audio") {
      list = list.filter((t) => t.mediaType === media);
    }
    if (media) list = list.slice(0, take);

    return NextResponse.json({ tasks: list });
  } catch (e: any) {
    console.error(`[tasks] GET failed | ${e?.message ?? e}`);
    return NextResponse.json(
      { error: e?.message ?? "查询任务失败", tasks: [] },
      { status: 500 }
    );
  }
}
