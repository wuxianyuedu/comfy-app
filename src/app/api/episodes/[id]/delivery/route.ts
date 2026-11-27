/**
 * 集级交付清单只读导出（ISSUE #5217 / FR-SR-05）：JSON 清单 + 与成片同源的 SRT。
 * 只走现有 episode 行与 `generated/films/<stem>.srt`，不另存一份字幕；越权与不存在
 * 同形按 404 处理（与 tRPC 面的按 id 单读同一归属口径）。
 */
import { type NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";

import { db } from "~/lib/db";
import { buildDeliveryManifest, srtStemOf } from "~/lib/production/delivery-manifest";
import { filmsRoot } from "~/lib/media/output-paths";
import { requireRequestUser } from "~/server/auth/request-user";
import { unauthorizedResponse } from "~/server/lib/error-response";
import { episode, season, series } from "~/server/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireRequestUser();
  if (user === null) {
    return unauthorizedResponse();
  }
  const { id } = await ctx.params;
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    return NextResponse.json({ error: "集 id 不合法" }, { status: 400 });
  }
  const rows = await db
    .select({ episode })
    .from(episode)
    .innerJoin(season, eq(episode.seasonId, season.id))
    .innerJoin(series, eq(season.seriesId, series.id))
    .where(and(eq(episode.id, id), eq(series.userId, user.id)))
    .limit(1);
  const row = rows[0]?.episode;
  if (row === undefined) {
    return NextResponse.json({ error: "剧集不存在" }, { status: 404 });
  }

  const stem = srtStemOf(row.delivery);
  const srt =
    stem === null
      ? ""
      : await fs.readFile(path.join(filmsRoot(), `${stem}.srt`), "utf8").catch(() => "");
  return NextResponse.json({ manifest: buildDeliveryManifest(row), srt });
}
