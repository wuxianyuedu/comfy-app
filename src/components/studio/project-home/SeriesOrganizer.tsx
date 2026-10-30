"use client";

/**
 * 系列 / 季 / 集 组织者（FR-SR-01/02，#2508）。
 *
 * 纯视图：所有 tRPC 取数与变更都来自 `useSeriesOrganizer`（逻辑层，规范 17 / 硬闸 S3），
 * 本文件不再出现 `useQuery(trpc.series…)`。把「一个项目 = 一集」的层级关系落地：
 * 系列 → 季 → 集，集可挂一个 projectId（assignCurrentProject）。
 */

import { useState } from "react";
import { Button } from "~/components/ui/button";
import { textHandler } from "~/lib/form-props";
import { cn } from "~/lib/utils";
import { useSeriesOrganizer } from "./hooks/use-series-organizer";
import { SeriesCharacterLibrary } from "./SeriesCharacterLibrary";

interface SeriesOrganizerProps {
  /** 当前项目 id（来自 workspace 的活跃项目）。提供时展示「本项目归属」并支持一键归入某集。 */
  projectId?: string;
}

export function SeriesOrganizer({ projectId }: SeriesOrganizerProps) {
  const c = useSeriesOrganizer(projectId);
  const [newSeries, setNewSeries] = useState("");
  const [newSeason, setNewSeason] = useState("");
  const [newEpisode, setNewEpisode] = useState("");

  const ep = c.currentEp;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="u-title">系列 / 季 / 集</h2>
        <span className="text-ink-faint text-xs">把项目归入系列层级（FR-SR：多剧集组织）</span>
      </div>

      {/* ── 本项目当前归属 ─────────────────────────── */}
      {projectId && (
        <div className="border-border bg-surface-1 flex items-center gap-3 rounded-xl border px-3 py-2 text-xs">
          <span className="text-ink-muted">本项目当前归属：</span>
          <span className="font-medium">
            {ep === undefined
              ? "加载中…"
              : ep
                ? `第 ${ep.episodeNumber} 集「${ep.title || "未命名"}」`
                : "未归入任何集"}
          </span>
        </div>
      )}

      {/* ── 系列 ───────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <div className="text-ink-muted text-sm font-medium">系列</div>
        <div className="flex flex-col gap-1.5">
          {c.seriesList?.map((s) => (
            <div
              key={s.id}
              className={cn(
                "group flex items-center gap-2 rounded-lg border px-2 py-1.5",
                c.seriesId === s.id ? "border-border-strong bg-surface-2" : "border-border",
              )}
            >
              <input
                className="flex-1 bg-transparent text-sm outline-none"
                defaultValue={s.title}
                onBlur={(e) => {
                  if (e.target.value && e.target.value !== s.title) {
                    c.renameSeries(s.id, e.target.value);
                  }
                }}
              />
              <Button
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => c.selectSeries(c.seriesId === s.id ? null : s.id)}
              >
                {c.seriesId === s.id ? "收起" : "展开"}
              </Button>
              <Button
                variant="ghost"
                className="text-destructive h-7 px-2 text-xs"
                onClick={() => c.deleteSeries(s.id)}
              >
                删除
              </Button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            className="border-border bg-surface-1 flex-1 rounded-lg border px-2 py-1 text-sm outline-none"
            placeholder="新系列名称"
            value={newSeries}
            onChange={textHandler(setNewSeries)}
          />
          <Button
            variant="primary-solid"
            className="h-8"
            disabled={!newSeries.trim() || c.seriesList === undefined}
            onClick={() => {
              c.createSeries(newSeries.trim());
              setNewSeries("");
            }}
          >
            新建系列
          </Button>
        </div>
      </div>

      {/* ── 季（选中系列后）─────────────────────────── */}
      {c.seriesId && (
        <div className="border-border flex flex-col gap-2 border-l-2 pl-3">
          <div className="text-ink-muted text-sm font-medium">季</div>
          <div className="flex flex-col gap-1.5">
            {c.seasons?.map((se) => (
              <div
                key={se.id}
                className={cn(
                  "group flex items-center gap-2 rounded-lg border px-2 py-1.5",
                  c.seasonId === se.id ? "border-border-strong bg-surface-2" : "border-border",
                )}
              >
                <span className="text-ink-faint w-6 text-xs">S{se.seasonNumber}</span>
                <input
                  className="flex-1 bg-transparent text-sm outline-none"
                  defaultValue={se.title}
                  onBlur={(e) => {
                    if (e.target.value !== se.title) {
                      c.renameSeason(se.id, e.target.value);
                    }
                  }}
                />
                <Button
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={() => c.selectSeason(c.seasonId === se.id ? null : se.id)}
                >
                  {c.seasonId === se.id ? "收起" : "展开"}
                </Button>
                <Button
                  variant="ghost"
                  className="text-destructive h-7 px-2 text-xs"
                  onClick={() => c.deleteSeason(se.id)}
                >
                  删除
                </Button>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              className="border-border bg-surface-1 flex-1 rounded-lg border px-2 py-1 text-sm outline-none"
              placeholder="新季名称（可空）"
              value={newSeason}
              onChange={textHandler(setNewSeason)}
            />
            <Button
              variant="primary-solid"
              className="h-8"
              disabled={c.seasons === undefined}
              onClick={() => {
                if (!c.seriesId) return;
                c.createSeason(c.seriesId, newSeason.trim());
                setNewSeason("");
              }}
            >
              新建季
            </Button>
          </div>
        </div>
      )}

      {/* ── 集（选中季后）───────────────────────────── */}
      {c.seasonId && (
        <div className="border-border flex flex-col gap-2 border-l-2 pl-3">
          <div className="text-ink-muted text-sm font-medium">集</div>
          <div className="flex flex-col gap-1.5">
            {c.episodes?.map((e) => (
              <div
                key={e.id}
                className={cn(
                  "group flex items-center gap-2 rounded-lg border px-2 py-1.5",
                  c.episodeId === e.id ? "border-border-strong bg-surface-2" : "border-border",
                )}
              >
                <span className="text-ink-faint w-6 text-xs">E{e.episodeNumber}</span>
                <input
                  className="flex-1 bg-transparent text-sm outline-none"
                  defaultValue={e.title}
                  onBlur={(ev) => {
                    if (ev.target.value !== e.title) {
                      c.renameEpisode(e.id, ev.target.value);
                    }
                  }}
                />
                {projectId && (
                  <Button
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={() => c.selectEpisode(c.episodeId === e.id ? null : e.id)}
                  >
                    {c.episodeId === e.id ? "已选" : "选定"}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  className="text-destructive h-7 px-2 text-xs"
                  onClick={() => c.deleteEpisode(e.id)}
                >
                  删除
                </Button>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              className="border-border bg-surface-1 flex-1 rounded-lg border px-2 py-1 text-sm outline-none"
              placeholder="新集标题（可空）"
              value={newEpisode}
              onChange={textHandler(setNewEpisode)}
            />
            <Button
              variant="primary-solid"
              className="h-8"
              disabled={c.episodes === undefined}
              onClick={() => {
                if (!c.seasonId) return;
                c.createEpisode(c.seasonId, newEpisode.trim());
                setNewEpisode("");
              }}
            >
              新建集
            </Button>
          </div>
          {projectId && c.episodeId && (
            <Button
              variant="primary-solid"
              className="mt-1 h-8"
              onClick={() => {
                if (c.episodeId) c.assignCurrentProject(c.episodeId);
              }}
            >
              把当前项目归入此集
            </Button>
          )}
        </div>
      )}

      {/* ── 系列角色库（选中系列后）────────────────────── */}
      {c.seriesId && (
        <div className="border-border flex flex-col gap-2 border-l-2 pl-3">
          <SeriesCharacterLibrary c={c} projectId={projectId} />
        </div>
      )}
    </section>
  );
}
