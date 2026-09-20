"use client";

// ── 成片工作室：业务逻辑层（规范 17 §17.2 第②层）────────────────────────────
// 承载表单状态、成片轮询、一键成片/取消/重新合成三个动作与 BGM 上传。
// FilmStudio 视图只消费本 hook 返回的 controller，不再出现 vanillaApi / fetch。
//
// 时间轴编辑（镜头列表、播放态、播放头）是纯视觉状态、不产生网络请求，
// 按规范留在视图层——下沉反而要透传一堆 prop。

import { useCallback, useEffect, useMemo, useState } from "react";

import { runAsyncAction, type ActionReport } from "~/lib/async-action";
import { beginStaleRun } from "~/lib/stale-run";
import { uploadBgm } from "~/lib/film/bgm-client";
import type { SizeSpec } from "~/lib/media/size-presets";
import { vanillaApi } from "~/trpc/vanilla";

import { useToast } from "../ToastProvider";
import { useInterval } from "~/components/ui/use-interval";
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

  /* 反馈通道适配：这一批里**每条动作的成功通道本来就不同**（「已启动」
   * 与「已上传」走 `success`、「已取消」走 `info`），失败一律 `toastError`
   * —— 收口前这三条接法散在四个动作里各写一遍（规范 16 §16.2.4.30：
   * 通道是调用处的选择，出口只负责「什么时候报、报什么」）。 */
  const reportSuccess = useCallback<ActionReport>(
    (kind, detail) => (kind === "ok" ? success(detail) : toastError(detail)),
    [success, toastError],
  );
  const reportInfo = useCallback<ActionReport>(
    (kind, detail) => (kind === "ok" ? info(detail) : toastError(detail)),
    [info, toastError],
  );

  const [title] = useState(FILM_TITLE);
  const [type] = useState(FILM_TYPE);
  const [styleSlug] = useState("");
  const [size] = useState<SizeSpec>(FILM_SIZE);
  const [fps] = useState(FILM_FPS);
  const [frames] = useState(FILM_FRAMES_PER_SHOT);

  const [script, setScript] = useState(DEFAULT_SCRIPT);
  const [videoWorkflows, setVideoWorkflows] = useState<
    { id: string; name: string }[]
  >([]);
  const [videoWorkflowId, setVideoWorkflowId] = useState("");
  const [imageWorkflows, setImageWorkflows] = useState<
    { id: string; name: string }[]
  >([]);
  const [imageWorkflowId, setImageWorkflowId] = useState("");
  const [subtitleOn, setSubtitleOn] = useState(true);
  const [bgmName, setBgmName] = useState<string | null>(null);
  const [ffmpegAvailable, setFfmpegAvailable] = useState(true);

  const [film, setFilm] = useState<Film | null>(null);
  const [loading, setLoading] = useState(false);
  /** 未消费的技能列表：先取回来用于后续开放风格选择，暂不渲染。 */
  const [, setSkills] = useState<{ slug: string; name: string }[]>([]);
  const [, setRecent] = useState<
    { id: string; title: string; status: string }[]
  >([]);

  /* 拉一次详情。轮询本身由 `useInterval` 按「是否在跑」驱动，这里不再自己
   * 起停定时器（规范 16 §16.2.4.15）—— 此前 `fetchDetail` 里 `??= setInterval`
   * 自启、跑完再 `stopPoll()` 自停，是「一个异步动作自己管自己的取消」。 */
  const fetchDetail = useCallback(async (id: string) => {
    try {
      // /api/film/[id] 返回原始 Prisma FilmProject 行（status/logs/shots 比本地
      // `Film` 视图类型更宽，shape 由路由固定）；经 unknown 收窄为 UI 视图类型。
      const data = await vanillaApi.film.detail.query({ id });
      setFilm(data.film as unknown as Film);
    } catch {
      /* 拉详情失败静默忽略，下一次轮询会重试 */
    }
  }, []);

  /* 挂载时拉一次技能与近期成片（defer 出 effect body，React 19 规则） */
  useEffect(() => {
    /* 这一轮的作废守卫（规范 16 §16.2.4.34）：卸载时旧轮次的元信息结论
     * 一律不落地。 */
    const guard = beginStaleRun();
    const t = setTimeout(() => {
      void (async () => {
        try {
          const [sData, fData, wData] = await Promise.all([
            vanillaApi.skill.list.query(),
            vanillaApi.film.list.query(),
            vanillaApi.workflow.list.query({}),
          ]);
          /* 工作流库列表：按内容类别分栏，逐镜生成只能选视频工作流、
           * 合成首帧只能选图类工作流（内置模板已移除）。 */
          const rawWorkflows: unknown = wData;
          const wfRows = Array.isArray(rawWorkflows) ? rawWorkflows : [];
          const pick = (category: "video" | "image") =>
            wfRows.flatMap((raw) => {
              if (typeof raw !== "object" || raw === null) return [];
              const wf = raw as Record<string, unknown>;
              if (typeof wf.id !== "string" || typeof wf.name !== "string")
                return [];
              return wf.typeCategory === category
                ? [{ id: wf.id, name: wf.name }]
                : [];
            });
          // skill.list 返回 `{...record, tags}` 行（router 的 spread 丢了索引签名），
          // 故按 record 视图读 slug/name；断言而非强转，畸形负载的行为与原先一致。
          const rawList: unknown = sData.skills;
          const list = Array.isArray(rawList) ? rawList : [];
          guard.commit(() => {
            setVideoWorkflows(pick("video"));
            setImageWorkflows(pick("image"));
            setSkills(
              list.map((raw) => {
                const s = raw as Record<string, unknown>;
                return { slug: s.slug as string, name: s.name as string };
              }),
            );
            setFfmpegAvailable(!!fData.ffmpegAvailable);
            setRecent(fData.films ?? []);
          });
        } catch {
          /* 元信息拉取失败不影响成片生成，静默忽略 */
        }
      })();
    }, 0);
    return () => {
      guard.dispose();
      clearTimeout(t);
    };
  }, []);

  const create = useCallback(async () => {
    if (!script.trim()) {
      toastError("请先输入剧本或创意");
      return;
    }
    setLoading(true);
    await runAsyncAction(
      async () => {
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
      },
      {
        report: reportSuccess,
        failureText: "启动失败",
        successText: "已启动一键成片，正在逐镜生成…",
      },
    );
    setLoading(false);
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
    fetchDetail,
    reportSuccess,
    toastError,
  ]);

  const cancel = useCallback(async () => {
    if (!film) return;
    await runAsyncAction(
      async () => {
        await vanillaApi.film.cancel.mutate({ id: film.id });
        await fetchDetail(film.id);
      },
      { report: reportInfo, failureText: "取消失败", successText: "已取消" },
    );
  }, [film, fetchDetail, reportInfo]);

  const recompose = useCallback(async () => {
    if (!film) return;
    setLoading(true);
    /* 成功静默：合成本身要几分钟，界面有进度与产物，多一句 toast 反而是噪声。 */
    await runAsyncAction(
      async () => {
        await vanillaApi.film.compose.mutate({ id: film.id });
        await fetchDetail(film.id);
      },
      { report: reportInfo, failureText: "重新合成失败" },
    );
    setLoading(false);
  }, [film, fetchDetail, reportInfo]);

  const uploadBgmFile = useCallback(
    async (file: File) => {
      /* 这一处成功走 `success`（明确的完成）而不是 `info` —— 上传是用户
       * 点下去要结果的短动作，值得一句「已上传」。文件名（动作的产物）在
       * `action` 里顺手写进 state，不由反馈通道承担。 */
      await runAsyncAction(
        async () => {
          setBgmName(await uploadBgm(file));
        },
        {
          report: reportSuccess,
          failureText: "BGM 上传失败",
          successText: "背景音乐已上传",
        },
      );
    },
    [reportSuccess],
  );

  const running = useMemo(() => !!film && isFilmRunning(film.status), [film]);

  /* 成片在跑时按 `FILM_POLL_MS` 轮询详情，跑完自动停 —— 「要不要轮询」由
   * `running` 决定，不再由 `fetchDetail` 自己起停定时器。`immediate: false`：
   * 进 running 那一次详情**已经由 `create` / `cancel` / `recompose` 显式拉过**
   * （它们都 `await fetchDetail(...)`），这里再补一次只会把刚拿到的状态多刷
   * 一遍、也让首个间隔的语义说不清。`useInterval` 每次渲染把回调搬进 ref，
   * 所以下面的闭包始终读到最新的 `film.id`。 */
  const pollId = film?.id ?? null;
  useInterval(
    () => {
      if (pollId) void fetchDetail(pollId);
    },
    { ms: running ? FILM_POLL_MS : null, immediate: false },
  );

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
