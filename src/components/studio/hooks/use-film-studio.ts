"use client";

// ── 成片工作室：业务逻辑层（规范 17 §17.2 第②层）────────────────────────────
// 承载表单状态、成片轮询、一键成片/取消/重新合成三个动作与 BGM 上传。
// FilmStudio 视图只消费本 hook 返回的 controller，不再出现 vanillaApi / fetch。
//
// 时间轴编辑（镜头列表、播放态、播放头）是纯视觉状态、不产生网络请求，
// 按规范留在视图层——下沉反而要透传一堆 prop。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { uploadBgm } from "~/lib/film/bgm-client";
import { errorMessage } from "~/lib/error-message";
import type { SizeSpec } from "@/lib/size-presets";
import { vanillaApi } from "~/trpc/vanilla";

import { useToast } from "../ToastProvider";
import {
  DEFAULT_SCRIPT,
  FILM_FPS,
  FILM_FRAMES_PER_SHOT,
  FILM_POLL_MS,
  FILM_SIZE,
  FILM_TITLE,
  FILM_TYPE,
  type Film,
  isFilmRunning,
} from "../film-studio-config";

export interface FilmStudioController {
  /* 成片参数（目前为常量，保留 setter 以便后续开放编辑） */
  title: string;
  /** 工作流库里可选的视频工作流（逐镜生成用；本地链路唯一来源）。 */
  videoWorkflows: { id: string; name: string }[];
  videoWorkflowId: string;
  setVideoWorkflowId: (value: string) => void;
  /** 工作流库里可选的图类工作流（文生视频镜头合成首帧用；可选）。 */
  imageWorkflows: { id: string; name: string }[];
  imageWorkflowId: string;
  setImageWorkflowId: (value: string) => void;
  /** 成片画幅（尺寸表达：比例 + 分辨率 / 比例 + 百万像素 + 倍数）。 */
  size: SizeSpec;
  /** 预览区展示的帧率。 */
  fps: number;
  script: string;
  setScript: (value: string) => void;
  subtitleOn: boolean;
  setSubtitleOn: (value: boolean) => void;
  bgmName: string | null;
  /** ffmpeg 不可用时的降级提示（逐镜可生成，但无法拼接成片）。 */
  ffmpegAvailable: boolean;
  /* 成片状态 */
  film: Film | null;
  running: boolean;
  loading: boolean;
  /* 动作 */
  create: () => Promise<void>;
  cancel: () => Promise<void>;
  recompose: () => Promise<void>;
  uploadBgmFile: (file: File) => Promise<void>;
}

/**
 * 拉取成片详情并在进行中时启动轮询。
 * 轮询器写成局部函数而非 `useCallback` 自引用——自引用会让 React Compiler
 * 无法校验 memo 化（rh/preserve-manual-memoization），局部函数语义等价。
 */
export function useFilmStudio(): FilmStudioController {
  const { success, error: toastError, info } = useToast();

  const [title] = useState(FILM_TITLE);
  const [type] = useState(FILM_TYPE);
  const [styleSlug] = useState("");
  const [size] = useState<SizeSpec>(FILM_SIZE);
  const [fps] = useState(FILM_FPS);
  const [frames] = useState(FILM_FRAMES_PER_SHOT);

  const [script, setScript] = useState(DEFAULT_SCRIPT);
  const [videoWorkflows, setVideoWorkflows] = useState<{ id: string; name: string }[]>([]);
  const [videoWorkflowId, setVideoWorkflowId] = useState("");
  const [imageWorkflows, setImageWorkflows] = useState<{ id: string; name: string }[]>([]);
  const [imageWorkflowId, setImageWorkflowId] = useState("");
  const [subtitleOn, setSubtitleOn] = useState(true);
  const [bgmName, setBgmName] = useState<string | null>(null);
  const [ffmpegAvailable, setFfmpegAvailable] = useState(true);

  const [film, setFilm] = useState<Film | null>(null);
  const [loading, setLoading] = useState(false);
  /** 未消费的技能列表：先取回来用于后续开放风格选择，暂不渲染。 */
  const [, setSkills] = useState<{ slug: string; name: string }[]>([]);
  const [, setRecent] = useState<{ id: string; title: string; status: string }[]>([]);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const fetchDetail = useCallback(
    async (id: string) => {
      const poll = async (tid: string): Promise<void> => {
        try {
          // /api/film/[id] 返回原始 Prisma FilmProject 行（status/logs/shots 比本地
          // `Film` 视图类型更宽，shape 由路由固定）；经 unknown 收窄为 UI 视图类型。
          const data = await vanillaApi.film.detail.query({ id: tid });
          const f = data.film as unknown as Film;
          setFilm(f);
          if (isFilmRunning(f.status)) {
            pollRef.current ??= setInterval(() => void poll(tid), FILM_POLL_MS);
          } else {
            stopPoll();
          }
        } catch {
          /* 轮询失败静默忽略，下一次 interval 会重试 */
        }
      };
      await poll(id);
    },
    [stopPoll],
  );

  /* 挂载时拉一次技能与近期成片（defer 出 effect body，React 19 规则） */
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      void (async () => {
        try {
          const [sData, fData, wData] = await Promise.all([
            vanillaApi.skill.list.query(),
            vanillaApi.film.list.query(),
            vanillaApi.workflow.list.query({}),
          ]);
          if (cancelled) return;
          /* 工作流库列表：按内容类别分栏，逐镜生成只能选视频工作流、
           * 合成首帧只能选图类工作流（内置模板已移除）。 */
          const rawWorkflows: unknown = wData;
          const wfRows = Array.isArray(rawWorkflows) ? rawWorkflows : [];
          const pick = (category: "video" | "image") =>
            wfRows.flatMap((raw) => {
              if (typeof raw !== "object" || raw === null) return [];
              const wf = raw as Record<string, unknown>;
              if (typeof wf.id !== "string" || typeof wf.name !== "string") return [];
              return wf.typeCategory === category ? [{ id: wf.id, name: wf.name }] : [];
            });
          setVideoWorkflows(pick("video"));
          setImageWorkflows(pick("image"));
          // skill.list 返回 `{...record, tags}` 行（router 的 spread 丢了索引签名），
          // 故按 record 视图读 slug/name；断言而非强转，畸形负载的行为与原先一致。
          const rawList: unknown = sData.skills;
          const list = Array.isArray(rawList) ? rawList : [];
          setSkills(
            list.map((raw) => {
              const s = raw as Record<string, unknown>;
              return { slug: s.slug as string, name: s.name as string };
            }),
          );
          setFfmpegAvailable(!!fData.ffmpegAvailable);
          setRecent(fData.films ?? []);
        } catch {
          /* 元信息拉取失败不影响成片生成，静默忽略 */
        }
      })();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, []);

  useEffect(() => () => stopPoll(), [stopPoll]);

  const create = useCallback(async () => {
    if (!script.trim()) {
      toastError("请先输入剧本或创意");
      return;
    }
    setLoading(true);
    try {
      stopPoll();
      const { id } = await vanillaApi.film.create.mutate({
        title,
        script,
        type,
        styleSlug: styleSlug || null,
        size,
        fps,
        framesPerShot: frames,
        subtitleOn,
        bgmName,
        ...(videoWorkflowId ? { videoWorkflowId } : {}),
        ...(imageWorkflowId ? { imageWorkflowId } : {}),
      });
      await vanillaApi.film.start.mutate({ id });
      await fetchDetail(id);
      success("已启动一键成片，正在逐镜生成…");
    } catch (e) {
      toastError(errorMessage(e, "启动失败"));
    } finally {
      setLoading(false);
    }
  }, [
    script,
    title,
    type,
    styleSlug,
    size,
    fps,
    frames,
    subtitleOn,
    bgmName,
    videoWorkflowId,
    imageWorkflowId,
    stopPoll,
    fetchDetail,
    toastError,
    success,
  ]);

  const cancel = useCallback(async () => {
    if (!film) return;
    try {
      await vanillaApi.film.cancel.mutate({ id: film.id });
      stopPoll();
      await fetchDetail(film.id);
      info("已取消");
    } catch (e) {
      toastError(errorMessage(e, "取消失败"));
    }
  }, [film, stopPoll, fetchDetail, info, toastError]);

  const recompose = useCallback(async () => {
    if (!film) return;
    setLoading(true);
    try {
      await vanillaApi.film.compose.mutate({ id: film.id });
      await fetchDetail(film.id);
    } catch (e) {
      toastError(errorMessage(e, "重新合成失败"));
    } finally {
      setLoading(false);
    }
  }, [film, fetchDetail, toastError]);

  const uploadBgmFile = useCallback(
    async (file: File) => {
      try {
        setBgmName(await uploadBgm(file));
        success("背景音乐已上传");
      } catch (e) {
        toastError(errorMessage(e, "BGM 上传失败"));
      }
    },
    [success, toastError],
  );

  const running = useMemo(() => !!film && isFilmRunning(film.status), [film]);

  return {
    title,
    videoWorkflows,
    videoWorkflowId,
    setVideoWorkflowId,
    imageWorkflows,
    imageWorkflowId,
    setImageWorkflowId,
    size,
    fps,
    script,
    setScript,
    subtitleOn,
    setSubtitleOn,
    bgmName,
    ffmpegAvailable,
    film,
    running,
    loading,
    create,
    cancel,
    recompose,
    uploadBgmFile,
  };
}
