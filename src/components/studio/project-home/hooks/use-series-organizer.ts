"use client";

/**
 * 系列 / 季 / 集 组织者的逻辑层（FR-SR-01/02，#2508）。
 *
 * 规范 17（UI 与逻辑分离）+ 硬闸 S3：视图层不得直接调 tRPC 取数，必须经由
 * controller hook 暴露数据。本文件即该 controller —— `SeriesOrganizer.tsx`
 * 只消费这里返回的字段与动作，不再出现 `useQuery(trpc.series…)`。
 *
 * 同时本文件集中消费 `series.*` 全部分支 procedure（list/create/update/delete +
 * seasons/createSeason/updateSeason/deleteSeason + episodes/createEpisode/
 * updateEpisode/deleteEpisode + byProject/assignProject），满足
 * `tests/trpc-surface-executors.test.ts` 的消费方判据。
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC, type RouterOutputs } from "~/trpc/react";

type Series = RouterOutputs["series"]["list"][number];
type Season = RouterOutputs["series"]["seasons"][number];
type Episode = NonNullable<RouterOutputs["series"]["byProject"]>;

export interface SeriesOrganizerController {
  /** 系列列表。 */
  seriesList?: Series[];
  /** 当前选中系列下的季列表。 */
  seasons?: Season[];
  /** 当前选中季下的集列表。 */
  episodes?: Episode[];
  /** 当前项目归属的集（无归属为 null）。 */
  currentEp?: Episode | null;

  seriesId: string | null;
  seasonId: string | null;
  episodeId: string | null;
  selectSeries: (id: string | null) => void;
  selectSeason: (id: string | null) => void;
  selectEpisode: (id: string | null) => void;

  createSeries: (title: string) => void;
  renameSeries: (id: string, title: string) => void;
  deleteSeries: (id: string) => void;
  createSeason: (seriesId: string, title: string) => void;
  renameSeason: (id: string, title: string) => void;
  deleteSeason: (id: string) => void;
  createEpisode: (seasonId: string, title: string) => void;
  renameEpisode: (id: string, title: string) => void;
  deleteEpisode: (id: string) => void;
  assignCurrentProject: (episodeId: string) => void;
}

export function useSeriesOrganizer(projectId?: string): SeriesOrganizerController {
  const trpc = useTRPC();
  const qc = useQueryClient();

  const [seriesId, setSeriesId] = useState<string | null>(null);
  const [seasonId, setSeasonId] = useState<string | null>(null);
  const [episodeId, setEpisodeId] = useState<string | null>(null);

  const seriesList = useQuery(trpc.series.list.queryOptions());
  const seasons = useQuery(
    trpc.series.seasons.queryOptions(
      { seriesId: seriesId ?? "" },
      { enabled: !!seriesId },
    ),
  );
  const episodes = useQuery(
    trpc.series.episodes.queryOptions(
      { seasonId: seasonId ?? "" },
      { enabled: !!seasonId },
    ),
  );
  const currentEp = useQuery(
    trpc.series.byProject.queryOptions(
      { projectId: projectId ?? "" },
      { enabled: !!projectId },
    ),
  );

  const invalidateSeries = () => void qc.invalidateQueries(trpc.series.list.queryFilter());
  const invalidateSeasons = (sid: string) =>
    void qc.invalidateQueries(trpc.series.seasons.queryFilter({ seriesId: sid }));
  const invalidateEpisodes = (sid: string) =>
    void qc.invalidateQueries(trpc.series.episodes.queryFilter({ seasonId: sid }));
  const invalidateCurrent = () => {
    if (projectId) void qc.invalidateQueries(trpc.series.byProject.queryFilter({ projectId }));
  };

  const createSeries = useMutation(
    trpc.series.create.mutationOptions({ onSuccess: invalidateSeries }),
  );
  const updateSeries = useMutation(
    trpc.series.update.mutationOptions({ onSuccess: invalidateSeries }),
  );
  const deleteSeries = useMutation(
    trpc.series.delete.mutationOptions({
      onSuccess: () => {
        invalidateSeries();
        setSeriesId(null);
        setSeasonId(null);
      },
    }),
  );

  const createSeason = useMutation(
    trpc.series.createSeason.mutationOptions({
      onSuccess: () => {
        if (seriesId) invalidateSeasons(seriesId);
      },
    }),
  );
  const updateSeason = useMutation(
    trpc.series.updateSeason.mutationOptions({
      onSuccess: () => {
        if (seriesId) invalidateSeasons(seriesId);
      },
    }),
  );
  const deleteSeason = useMutation(
    trpc.series.deleteSeason.mutationOptions({
      onSuccess: () => {
        if (seriesId) invalidateSeasons(seriesId);
        setSeasonId(null);
      },
    }),
  );

  const createEpisode = useMutation(
    trpc.series.createEpisode.mutationOptions({
      onSuccess: () => {
        if (seasonId) invalidateEpisodes(seasonId);
      },
    }),
  );
  const updateEpisode = useMutation(
    trpc.series.updateEpisode.mutationOptions({
      onSuccess: () => {
        if (seasonId) invalidateEpisodes(seasonId);
      },
    }),
  );
  const deleteEpisode = useMutation(
    trpc.series.deleteEpisode.mutationOptions({
      onSuccess: () => {
        if (seasonId) invalidateEpisodes(seasonId);
        setEpisodeId(null);
      },
    }),
  );

  const assignProject = useMutation(
    trpc.series.assignProject.mutationOptions({ onSuccess: invalidateCurrent }),
  );

  return {
    seriesList: seriesList.data,
    seasons: seasons.data,
    episodes: episodes.data,
    currentEp: currentEp.data,
    seriesId,
    seasonId,
    episodeId,
    selectSeries: (id) => {
      setSeriesId(id);
      setSeasonId(null);
      setEpisodeId(null);
    },
    selectSeason: (id) => {
      setSeasonId(id);
      setEpisodeId(null);
    },
    selectEpisode: (id) => setEpisodeId(id),
    createSeries: (title) => createSeries.mutate({ title }),
    renameSeries: (id, title) => updateSeries.mutate({ id, title }),
    deleteSeries: (id) => deleteSeries.mutate({ id }),
    createSeason: (sid, title) => createSeason.mutate({ seriesId: sid, title }),
    renameSeason: (id, title) => updateSeason.mutate({ id, title }),
    deleteSeason: (id) => deleteSeason.mutate({ id }),
    createEpisode: (sid, title) => createEpisode.mutate({ seasonId: sid, title }),
    renameEpisode: (id, title) => updateEpisode.mutate({ id, title }),
    deleteEpisode: (id) => deleteEpisode.mutate({ id }),
    assignCurrentProject: (epid) => {
      if (!projectId) return;
      assignProject.mutate({ episodeId: epid, projectId });
    },
  };
}
