"use client";

/**
 * 系列 / 季 / 集 / 角色库 组织者的逻辑层（FR-SR-01/02/03，#2508）。
 *
 * 规范 17（UI 与逻辑分离）+ 硬闸 S3：视图层不得直接调 tRPC 取数，必须经由
 * controller hook 暴露数据。本文件即该 controller —— `SeriesOrganizer.tsx`
 * 只消费这里返回的字段与动作，不再出现 `useQuery(trpc.series…)`。
 *
 * 同时本文件集中消费 `series.*` 全部分支 procedure（list/create/update/delete +
 * seasons/createSeason/updateSeason/deleteSeason + episodes/createEpisode/
 * updateEpisode/deleteEpisode + byProject/assignProject + 角色库全部分支：
 * characters/createCharacter/updateCharacter/deleteCharacter + episodeCharacters/
 * linkCharacter/unlinkCharacter + promoteFromProduction/injectToProduction），
 * 满足 `tests/trpc-surface-executors.test.ts` 的消费方判据。
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC, type RouterOutputs } from "~/trpc/react";

type Series = RouterOutputs["series"]["list"][number];
type Season = RouterOutputs["series"]["seasons"][number];
type Episode = NonNullable<RouterOutputs["series"]["byProject"]>;
type CharacterEntity = RouterOutputs["series"]["characters"][number];
type EpisodeCharacterLink = RouterOutputs["series"]["episodeCharacters"][number];
/** 反向：某角色被哪些集引用（FR-SR-03 ②）。 */
type CharacterEpisodeRef = RouterOutputs["series"]["characterEpisodes"][number];

/** 角色可改字段（UI 编辑面）。params / portraits 由生产侧/导入携带，UI 不直编。 */
export type CharacterPatch = Partial<{
  ageGender: string;
  appearance: string;
  costume: string;
  name: string;
  negativePrompt: string;
  personality: string;
  portraitUrl: string | undefined;
  positivePrompt: string;
  skillSlug: string | undefined;
  styleTags: Array<string>;
  temperament: string;
}>;

export type SeriesOrganizerController = {
  assignCurrentProject: (episodeId: string) => void;
  /** 反向：当前正在查看的角色被哪些集引用（FR-SR-03 ②）。 */
  characterEpisodes?: Array<CharacterEpisodeRef>;
  /** 当前选中系列下的角色库列表。 */
  characters?: Array<CharacterEntity>;
  clearInspectedCharacter: () => void;
  /** 角色库：建 / 改 / 删。 */
  createCharacter: (seriesId: string, name: string) => void;
  createEpisode: (seasonId: string, title: string) => void;
  createSeason: (seriesId: string, title: string) => void;
  createSeries: (title: string) => void;

  /** 当前项目归属的集（无归属为 null）。 */
  currentEp?: Episode | null;
  deleteCharacter: (id: string) => void;
  deleteEpisode: (id: string) => void;
  deleteSeason: (id: string) => void;
  deleteSeries: (id: string) => void;
  /** 当前选中集已关联的角色（含定位 role）。 */
  episodeCharacters?: Array<EpisodeCharacterLink>;

  episodeId: string | null;
  /** 当前选中季下的集列表。 */
  episodes?: Array<Episode>;
  injectToProduction: (projectId: string) => void;
  /** 反向查询：查看某角色被哪些集引用（FR-SR-03 ②）。 */
  inspectCharacterEpisodes: (characterId: string) => void;
  /** 正在查看引用集的角色 id（null = 没在查看）。 */
  inspectedCharacterId: string | null;
  /** 集 ↔ 角色关联。 */
  linkCharacter: (episodeId: string, characterId: string) => void;
  /** 双向同步：把项目角色提升进系列库 / 把系列库角色注入项目。 */
  promoteFromProduction: (projectId: string) => void;
  renameEpisode: (id: string, title: string) => void;
  renameSeason: (id: string, title: string) => void;
  renameSeries: (id: string, title: string) => void;

  seasonId: string | null;
  /** 当前选中系列下的季列表。 */
  seasons?: Array<Season>;
  selectEpisode: (id: string | null) => void;
  selectSeason: (id: string | null) => void;
  selectSeries: (id: string | null) => void;
  seriesId: string | null;
  /** 系列列表。 */
  seriesList?: Array<Series>;
  unlinkCharacter: (episodeId: string, characterId: string) => void;
  updateCharacter: (id: string, patch: CharacterPatch) => void;
};

export function useSeriesOrganizer(projectId?: string): SeriesOrganizerController {
  const trpc = useTRPC();
  const qc = useQueryClient();

  const [seriesId, setSeriesId] = useState<string | null>(null);
  const [seasonId, setSeasonId] = useState<string | null>(null);
  const [episodeId, setEpisodeId] = useState<string | null>(null);
  const [inspectedCharacterId, setInspectedCharacterId] = useState<string | null>(null);

  const seriesList = useQuery(trpc.series.list.queryOptions());
  const seasons = useQuery(
    trpc.series.seasons.queryOptions({ seriesId: seriesId ?? "" }, { enabled: !!seriesId }),
  );
  const episodes = useQuery(
    trpc.series.episodes.queryOptions({ seasonId: seasonId ?? "" }, { enabled: !!seasonId }),
  );
  const currentEp = useQuery(
    trpc.series.byProject.queryOptions({ projectId: projectId ?? "" }, { enabled: !!projectId }),
  );
  const characterList = useQuery(
    trpc.series.characters.queryOptions({ seriesId: seriesId ?? "" }, { enabled: !!seriesId }),
  );
  const episodeChars = useQuery(
    trpc.series.episodeCharacters.queryOptions(
      { episodeId: episodeId ?? "" },
      { enabled: !!episodeId },
    ),
  );
  const charEpisodes = useQuery(
    trpc.series.characterEpisodes.queryOptions(
      { characterId: inspectedCharacterId ?? "" },
      { enabled: !!inspectedCharacterId },
    ),
  );

  const invalidateSeries = () => void qc.invalidateQueries(trpc.series.list.queryFilter());
  const invalidateSeasons = (sid: string) =>
    void qc.invalidateQueries(trpc.series.seasons.queryFilter({ seriesId: sid }));
  const invalidateEpisodes = (sid: string) =>
    void qc.invalidateQueries(trpc.series.episodes.queryFilter({ seasonId: sid }));
  const invalidateCurrent = () => {
    if (projectId) {
      void qc.invalidateQueries(trpc.series.byProject.queryFilter({ projectId }));
    }
  };
  const invalidateCharacters = (sid: string) =>
    void qc.invalidateQueries(trpc.series.characters.queryFilter({ seriesId: sid }));
  const invalidateEpisodeChars = (eid: string) =>
    void qc.invalidateQueries(trpc.series.episodeCharacters.queryFilter({ episodeId: eid }));
  const invalidateCharacterEpisodes = (cid: string) =>
    void qc.invalidateQueries(trpc.series.characterEpisodes.queryFilter({ characterId: cid }));

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
        if (seriesId) {
          invalidateSeasons(seriesId);
        }
      },
    }),
  );
  const updateSeason = useMutation(
    trpc.series.updateSeason.mutationOptions({
      onSuccess: () => {
        if (seriesId) {
          invalidateSeasons(seriesId);
        }
      },
    }),
  );
  const deleteSeason = useMutation(
    trpc.series.deleteSeason.mutationOptions({
      onSuccess: () => {
        if (seriesId) {
          invalidateSeasons(seriesId);
        }
        setSeasonId(null);
      },
    }),
  );

  const createEpisode = useMutation(
    trpc.series.createEpisode.mutationOptions({
      onSuccess: () => {
        if (seasonId) {
          invalidateEpisodes(seasonId);
        }
      },
    }),
  );
  const updateEpisode = useMutation(
    trpc.series.updateEpisode.mutationOptions({
      onSuccess: () => {
        if (seasonId) {
          invalidateEpisodes(seasonId);
        }
      },
    }),
  );
  const deleteEpisode = useMutation(
    trpc.series.deleteEpisode.mutationOptions({
      onSuccess: () => {
        if (seasonId) {
          invalidateEpisodes(seasonId);
        }
        setEpisodeId(null);
      },
    }),
  );

  const assignProject = useMutation(
    trpc.series.assignProject.mutationOptions({ onSuccess: invalidateCurrent }),
  );

  // ── 系列角色库（FR-SR-03）──────────────────────────────
  const createCharacterMut = useMutation(
    trpc.series.createCharacter.mutationOptions({
      onSuccess: () => {
        if (seriesId) {
          invalidateCharacters(seriesId);
        }
      },
    }),
  );
  const updateCharacterMut = useMutation(
    trpc.series.updateCharacter.mutationOptions({
      onSuccess: () => {
        if (seriesId) {
          invalidateCharacters(seriesId);
        }
      },
    }),
  );
  const deleteCharacterMut = useMutation(
    trpc.series.deleteCharacter.mutationOptions({
      onSuccess: () => {
        if (seriesId) {
          invalidateCharacters(seriesId);
        }
        if (episodeId) {
          invalidateEpisodeChars(episodeId);
        }
      },
    }),
  );
  const linkCharacterMut = useMutation(
    trpc.series.linkCharacter.mutationOptions({
      onSuccess: (_data, vars) => {
        if (episodeId) {
          invalidateEpisodeChars(episodeId);
        }
        invalidateCharacterEpisodes(vars.characterId);
      },
    }),
  );
  const unlinkCharacterMut = useMutation(
    trpc.series.unlinkCharacter.mutationOptions({
      onSuccess: (_data, vars) => {
        if (episodeId) {
          invalidateEpisodeChars(episodeId);
        }
        invalidateCharacterEpisodes(vars.characterId);
      },
    }),
  );
  const promoteMut = useMutation(
    trpc.series.promoteFromProduction.mutationOptions({
      onSuccess: () => {
        if (seriesId) {
          invalidateCharacters(seriesId);
        }
        if (episodeId) {
          invalidateEpisodeChars(episodeId);
        }
      },
    }),
  );
  const injectMut = useMutation(
    trpc.series.injectToProduction.mutationOptions({ onSuccess: invalidateCurrent }),
  );

  return {
    assignCurrentProject: (epid) => {
      if (!projectId) {
        return;
      }
      assignProject.mutate({ episodeId: epid, projectId });
    },
    characterEpisodes: charEpisodes.data,
    characters: characterList.data,
    clearInspectedCharacter: () => setInspectedCharacterId(null),
    createCharacter: (sid, name) => createCharacterMut.mutate({ name, seriesId: sid }),
    createEpisode: (sid, title) => createEpisode.mutate({ seasonId: sid, title }),
    createSeason: (sid, title) => createSeason.mutate({ seriesId: sid, title }),
    createSeries: (title) => createSeries.mutate({ title }),
    currentEp: currentEp.data,
    deleteCharacter: (id) => deleteCharacterMut.mutate({ id }),
    deleteEpisode: (id) => deleteEpisode.mutate({ id }),
    deleteSeason: (id) => deleteSeason.mutate({ id }),
    deleteSeries: (id) => deleteSeries.mutate({ id }),
    episodeCharacters: episodeChars.data,
    episodeId,
    episodes: episodes.data,
    injectToProduction: (pid) => injectMut.mutate({ projectId: pid }),
    inspectCharacterEpisodes: (cid) => setInspectedCharacterId(cid),
    inspectedCharacterId,
    linkCharacter: (epid, cid) => linkCharacterMut.mutate({ characterId: cid, episodeId: epid }),
    promoteFromProduction: (pid) => promoteMut.mutate({ projectId: pid }),
    renameEpisode: (id, title) => updateEpisode.mutate({ id, title }),
    renameSeason: (id, title) => updateSeason.mutate({ id, title }),
    renameSeries: (id, title) => updateSeries.mutate({ id, title }),
    seasonId,
    seasons: seasons.data,
    selectEpisode: (id) => setEpisodeId(id),
    selectSeason: (id) => {
      setSeasonId(id);
      setEpisodeId(null);
    },
    selectSeries: (id) => {
      setSeriesId(id);
      setSeasonId(null);
      setEpisodeId(null);
    },
    seriesId,
    seriesList: seriesList.data,
    unlinkCharacter: (epid, cid) =>
      unlinkCharacterMut.mutate({ characterId: cid, episodeId: epid }),
    updateCharacter: (id, patch) => updateCharacterMut.mutate({ id, ...patch }),
  };
}
