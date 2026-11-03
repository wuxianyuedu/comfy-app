"use client";

/**
 * 系列 / 季 / 集 组织者（FR-SR-01/02/04，#2508）。纯视图：tRPC 取数与变更全来自 useSeriesOrganizer
 *（逻辑层，规范 17 / 硬闸 S3），本文件不出现 useQuery(trpc.series…)。「一个项目 = 一集」：
 * 系列 → 季 → 集，集可挂一个 projectId（assignCurrentProject）。
 */

import { useState } from "react";
import { Button } from "~/components/ui/button";
import { NativeSelect, NativeSelectOption } from "~/components/ui/native-select";
import { textHandler } from "~/lib/form-props";
import { cn } from "~/lib/utils";
import { useSeriesOrganizer } from "./hooks/use-series-organizer";
import { SeriesCharacterLibrary } from "./SeriesCharacterLibrary";

type SeriesOrganizerProps = {
  /** 当前项目 id（来自 workspace 的活跃项目）。提供时展示「本项目归属」并支持一键归入某集。 */
  projectId?: string;
};

export function SeriesOrganizer({ projectId }: SeriesOrganizerProps) {
  const c = useSeriesOrganizer(projectId);
  const [newSeries, setNewSeries] = useState("");
  const [newSeason, setNewSeason] = useState("");
  const [newEpisode, setNewEpisode] = useState("");
  const [genWorkflow, setGenWorkflow] = useState("");

  const ep = c.currentEp;
  const progressById = new Map((c.seasonProgress ?? []).map((p) => [p.episodeId, p]));

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="u-title">系列 / 季 / 集</h2>
        <span className="text-ink-faint text-xs">把项目归入系列层级（FR-SR：多剧集组织）</span>
      </div>

      {/* ── 本项目当前归属 ─────────────────────────── */}
      {projectId !== undefined && projectId !== "" && (
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
              className={cn(
                "group flex items-center gap-2 rounded-lg border px-2 py-1.5",
                c.seriesId === s.id ? "border-border-strong bg-surface-2" : "border-border",
              )}
              key={s.id}
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
                className="h-7 px-2 text-xs"
                onClick={() => {
                  c.selectSeries(c.seriesId === s.id ? null : s.id);
                }}
                variant="ghost"
              >
                {c.seriesId === s.id ? "收起" : "展开"}
              </Button>
              <Button
                className="text-destructive h-7 px-2 text-xs"
                onClick={() => {
                  c.deleteSeries(s.id);
                }}
                variant="ghost"
              >
                删除
              </Button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            className="border-border bg-surface-1 flex-1 rounded-lg border px-2 py-1 text-sm outline-none"
            onChange={textHandler(setNewSeries)}
            placeholder="新系列名称"
            value={newSeries}
          />
          <Button
            className="h-8"
            disabled={!newSeries.trim() || c.seriesList === undefined}
            onClick={() => {
              c.createSeries(newSeries.trim());
              setNewSeries("");
            }}
            variant="primary-solid"
          >
            新建系列
          </Button>
        </div>
      </div>

      {/* ── 季（选中系列后）─────────────────────────── */}
      {c.seriesId !== null && c.seriesId !== "" && (
        <div className="border-border flex flex-col gap-2 border-l-2 pl-3">
          <div className="text-ink-muted text-sm font-medium">季</div>
          <div className="flex flex-col gap-1.5">
            {c.seasons?.map((se) => (
              <div
                className={cn(
                  "group flex items-center gap-2 rounded-lg border px-2 py-1.5",
                  c.seasonId === se.id ? "border-border-strong bg-surface-2" : "border-border",
                )}
                key={se.id}
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
                  className="h-7 px-2 text-xs"
                  onClick={() => {
                    c.selectSeason(c.seasonId === se.id ? null : se.id);
                  }}
                  variant="ghost"
                >
                  {c.seasonId === se.id ? "收起" : "展开"}
                </Button>
                <Button
                  className="text-destructive h-7 px-2 text-xs"
                  onClick={() => {
                    c.deleteSeason(se.id);
                  }}
                  variant="ghost"
                >
                  删除
                </Button>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              className="border-border bg-surface-1 flex-1 rounded-lg border px-2 py-1 text-sm outline-none"
              onChange={textHandler(setNewSeason)}
              placeholder="新季名称（可空）"
              value={newSeason}
            />
            <Button
              className="h-8"
              disabled={c.seasons === undefined}
              onClick={() => {
                if (c.seriesId === null || c.seriesId === "") {
                  return;
                }
                c.createSeason(c.seriesId, newSeason.trim());
                setNewSeason("");
              }}
              variant="primary-solid"
            >
              新建季
            </Button>
          </div>
        </div>
      )}

      {/* ── 集（选中季后）───────────────────────────── */}
      {c.seasonId !== null && c.seasonId !== "" && (
        <div className="border-border flex flex-col gap-2 border-l-2 pl-3">
          <div className="text-ink-muted text-sm font-medium">集</div>
          <div className="flex flex-col gap-1.5">
            {c.episodes?.map((e) => (
              <div
                className={cn(
                  "group flex items-center gap-2 rounded-lg border px-2 py-1.5",
                  c.episodeId === e.id ? "border-border-strong bg-surface-2" : "border-border",
                )}
                key={e.id}
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
                {(() => {
                  const p = progressById.get(e.id);
                  if (!p) {
                    return null;
                  }
                  return (
                    <span className="text-ink-faint text-xs whitespace-nowrap">
                      {p.total === 0
                        ? "无镜"
                        : `生成 ${p.done}/${p.total}${p.failed ? ` · 失败 ${p.failed}` : ""}`}
                    </span>
                  );
                })()}
                {projectId !== undefined && projectId !== "" && (
                  <Button
                    className="h-7 px-2 text-xs"
                    onClick={() => {
                      c.selectEpisode(c.episodeId === e.id ? null : e.id);
                    }}
                    variant="ghost"
                  >
                    {c.episodeId === e.id ? "已选" : "选定"}
                  </Button>
                )}
                <Button
                  className="text-destructive h-7 px-2 text-xs"
                  onClick={() => {
                    c.deleteEpisode(e.id);
                  }}
                  variant="ghost"
                >
                  删除
                </Button>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              className="border-border bg-surface-1 flex-1 rounded-lg border px-2 py-1 text-sm outline-none"
              onChange={textHandler(setNewEpisode)}
              placeholder="新集标题（可空）"
              value={newEpisode}
            />
            <Button
              className="h-8"
              disabled={c.episodes === undefined}
              onClick={() => {
                if (c.seasonId === null || c.seasonId === "") {
                  return;
                }
                c.createEpisode(c.seasonId, newEpisode.trim());
                setNewEpisode("");
              }}
              variant="primary-solid"
            >
              新建集
            </Button>
          </div>
          {projectId !== undefined &&
            projectId !== "" &&
            c.episodeId !== null &&
            c.episodeId !== "" && (
              <Button
                className="mt-1 h-8"
                onClick={() => {
                  if (c.episodeId !== null && c.episodeId !== "") {
                    c.assignCurrentProject(c.episodeId);
                  }
                }}
                variant="primary-solid"
              >
                把当前项目归入此集
              </Button>
            )}

          {/* ── 整季生成（FR-SR-04）────────────────────── */}
          {projectId !== undefined && projectId !== "" && (
            <div className="border-border flex flex-col gap-2 border-l-2 pl-3">
              <div className="text-ink-muted text-sm font-medium">整季生成（FR-SR-04）</div>
              <div className="flex items-center gap-2">
                <NativeSelect
                  className="flex-1"
                  onChange={(e) => {
                    setGenWorkflow(e.target.value);
                  }}
                  value={genWorkflow}
                >
                  <NativeSelectOption value="">选择工作流…</NativeSelectOption>
                  {(c.workflows ?? []).map((w) => (
                    <NativeSelectOption key={w.id} value={w.id}>
                      {w.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <Button
                  className="h-8"
                  disabled={!genWorkflow || c.batchGenerating}
                  onClick={() => {
                    if (genWorkflow) {
                      c.batchGenerateSeason(genWorkflow);
                    }
                  }}
                  variant="primary-solid"
                >
                  {c.batchGenerating ? "提交中…" : "整季生成"}
                </Button>
              </div>
              <span className="text-ink-faint text-xs">
                一次提交本季所有未完成的镜；已完成的镜不会重排（断点续跑）。
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── 系列角色库（选中系列后）────────────────────── */}
      {c.seriesId !== null && c.seriesId !== "" && (
        <div className="border-border flex flex-col gap-2 border-l-2 pl-3">
          <SeriesCharacterLibrary c={c} projectId={projectId} />
        </div>
      )}
    </section>
  );
}
