"use client";

// 工坊管线的全部业务逻辑：状态、草稿持久化、资源拉取、生图流程、派生进度。
// 视图层只消费这里返回的 controller，不持有任何业务规则。

import React from "react";

import type { ApiChannelsView } from "~/lib/workshop/api-channel-shared";
import {
  fetchApiChannels,
  startLocalGenerate,
  watchTask,
  type GenerateInput,
} from "~/lib/workshop/generation-client";
import type {
  Character,
  ProjectMeta,
  Scene,
  Shot,
  StyleRef,
} from "~/lib/workshop/types";
import {
  buildGridShots,
  buildMissingSummary,
  computeProgressPct,
  computeStageRatios,
  stagePrereq,
  STAGE_DEFS,
  STAGE_TITLES,
  type GridShot,
  type MissingItem,
  type StageRatios,
  type StageViewContext,
  type Tab,
} from "~/components/workshop/stage-config";

/** 工坊草稿在 localStorage 的键（单草稿：该页面即一个未命名项目流）。 */
const WORKSHOP_DRAFT_KEY = "comfyapp.workshop.draft.v1";

const DEFAULT_META: ProjectMeta = {
  title: "未命名项目",
  type: "short_video",
  tone: "",
  logline: "",
};

/** 自动保存的工坊状态（恢复时逐字段校验类型，损坏则按全新状态继续）。 */
interface WorkshopDraft {
  meta: ProjectMeta;
  outline: string;
  scriptMarkdown: string;
  scenes: Scene[];
  characters: Character[];
  shots: Shot[];
  checkpoint: string;
}

/** 读取本机草稿；损坏/不可用返回 null（SSR 与隐私模式下同样安全）。 */
function loadWorkshopDraft(): WorkshopDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(WORKSHOP_DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as Partial<WorkshopDraft>;
    return {
      meta: draft.meta ?? DEFAULT_META,
      outline: typeof draft.outline === "string" ? draft.outline : "",
      scriptMarkdown:
        typeof draft.scriptMarkdown === "string" ? draft.scriptMarkdown : "",
      scenes: Array.isArray(draft.scenes) ? draft.scenes : [],
      characters: Array.isArray(draft.characters) ? draft.characters : [],
      shots: Array.isArray(draft.shots) ? draft.shots : [],
      checkpoint: typeof draft.checkpoint === "string" ? draft.checkpoint : "",
    };
  } catch {
    return null;
  }
}

/** 页面加载期间只读一次 localStorage（多个 state 惰性初始化器共用）。 */
let workshopDraftCache: WorkshopDraft | null | undefined;
function loadWorkshopDraftOnce(): WorkshopDraft | null {
  workshopDraftCache ??= loadWorkshopDraft();
  return workshopDraftCache;
}

/** /api/skills 返回 payload：用于在 fetch 边界收窄，消除 any 散落。 */
type SkillsApiResponse = {
  skills?: Array<{
    slug: string;
    name: string;
    icon: string;
    promptTemplate: string;
    negativePrompt?: string | null;
    defaultParams?: Record<string, unknown> | null;
  }>;
};

/** /api/models?type=CHECKPOINT 返回 payload。 */
type ModelsApiResponse = { models?: Array<{ fileName: string }> };

/** 安全读取 Shot 参数：对象/数组等会被拒绝，返回 fallback。 */
function paramString(value: unknown, fallback: string): string {
  return typeof value === "string" && value ? value : fallback;
}
function paramNumber(value: unknown, fallback: number): number {
  const num =
    typeof value === "string"
      ? Number(value)
      : typeof value === "number"
        ? value
        : NaN;
  return Number.isFinite(num) ? num : fallback;
}

/** catch 抛出值（unknown）→ 消息提取：带 string message 的对象取 message。 */
function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return fallback;
}

/** 每个镜头节点的实时生成进度（pct + 当前 ComfyUI 节点类别）。 */
export type ShotProgressMap = Record<string, { pct: number; label?: string }>;

export interface WorkshopPipelineController {
  // ── 阶段
  tab: Tab;
  setTab: (tab: Tab) => void;
  stageIndex: number;
  stageTitle: string;
  stageDesc: string;
  stageRatios: StageRatios;
  progressPct: number;
  prereq: { text: string; go: Tab } | null;
  pendingCategories: number;
  viewContext: StageViewContext;
  gridShots: GridShot[];
  missing: MissingItem[];

  // ── 数据
  meta: ProjectMeta;
  setMeta: React.Dispatch<React.SetStateAction<ProjectMeta>>;
  outline: string;
  scriptMarkdown: string;
  setScriptMarkdown: (value: string) => void;
  scenes: Scene[];
  setScenes: React.Dispatch<React.SetStateAction<Scene[]>>;
  characters: Character[];
  setCharacters: React.Dispatch<React.SetStateAction<Character[]>>;
  shots: Shot[];
  setShots: React.Dispatch<React.SetStateAction<Shot[]>>;
  styles: StyleRef[];
  checkpoints: string[];
  checkpoint: string;
  setCheckpoint: (value: string) => void;
  apiChannels: ApiChannelsView | null;
  imageDoneCount: number;
  clipDoneCount: number;
  rendered: boolean;

  // ── 交互态
  generating: boolean;
  shotProgress: ShotProgressMap;
  draftSavedAt: Date | null;
  editingOutline: boolean;
  draftOutline: string;
  isScriptEditorOpen: boolean;
  apiSettingsOpen: boolean;
  /** 需要引起用户注意的失败/阻断文案（替代 alert，由视图决定怎么渲染）。 */
  notice: string | null;

  // ── 动作
  generateShot: (shot: Shot) => Promise<void>;
  beginOutlineEdit: () => void;
  cancelOutlineEdit: () => void;
  saveOutline: () => void;
  setDraftOutline: (value: string) => void;
  openScriptEditor: () => void;
  closeScriptEditor: () => void;
  saveScriptEditor: () => void;
  openApiSettings: () => void;
  closeApiSettings: () => void;
  handleApiChannelsSaved: (channels: ApiChannelsView) => void;
  dismissNotice: () => void;
  markRendered: () => void;
}

export function useWorkshopPipeline(): WorkshopPipelineController {
  const [tab, setTab] = React.useState<Tab>("script");
  const [meta, setMeta] = React.useState<ProjectMeta>(
    () => loadWorkshopDraftOnce()?.meta ?? DEFAULT_META,
  );
  const [scenes, setScenes] = React.useState<Scene[]>(
    () => loadWorkshopDraftOnce()?.scenes ?? [],
  );
  const [characters, setCharacters] = React.useState<Character[]>(
    () => loadWorkshopDraftOnce()?.characters ?? [],
  );
  const [shots, setShots] = React.useState<Shot[]>(
    () => loadWorkshopDraftOnce()?.shots ?? [],
  );
  const [styles, setStyles] = React.useState<StyleRef[]>([]);
  const [checkpoints, setCheckpoints] = React.useState<string[]>([]);
  const [checkpoint, setCheckpoint] = React.useState(
    () => loadWorkshopDraftOnce()?.checkpoint ?? "",
  );
  const [generating, setGenerating] = React.useState(false);
  const [shotProgress, setShotProgress] = React.useState<ShotProgressMap>({});
  const [rendered, setRendered] = React.useState(false);
  const [apiChannels, setApiChannels] =
    React.useState<ApiChannelsView | null>(null);
  const [apiSettingsOpen, setApiSettingsOpen] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);

  // 2026-09-02: 剧本内容此前是纯内存 state（刷新即丢），且大纲默认塞了
  // 一段硬编码示例文案。现在大纲/剧本默认为空，全部内容经 localStorage
  // 草稿持久化（防抖自动保存，挂载时惰性恢复）。
  const [outline, setOutline] = React.useState(
    () => loadWorkshopDraftOnce()?.outline ?? "",
  );
  const [scriptMarkdown, setScriptMarkdown] = React.useState(
    () => loadWorkshopDraftOnce()?.scriptMarkdown ?? "",
  );
  const [isScriptEditorOpen, setIsScriptEditorOpen] = React.useState(false);
  const [editingOutline, setEditingOutline] = React.useState(false);
  const [draftOutline, setDraftOutline] = React.useState("");
  const [draftSavedAt, setDraftSavedAt] = React.useState<Date | null>(null);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const draft: WorkshopDraft = {
          meta,
          outline,
          scriptMarkdown,
          scenes,
          characters,
          shots,
          checkpoint,
        };
        window.localStorage.setItem(
          WORKSHOP_DRAFT_KEY,
          JSON.stringify({ v: 1, ...draft }),
        );
        setDraftSavedAt(new Date());
      } catch {
        /* 存储满/隐私模式：静默失败，不影响编辑 */
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [meta, outline, scriptMarkdown, scenes, characters, shots, checkpoint]);

  React.useEffect(() => {
    fetch("/api/skills")
      .then((res) => res.json())
      .then((data: SkillsApiResponse) => {
        const list: StyleRef[] = (data.skills ?? []).map((skill) => ({
          slug: skill.slug,
          name: skill.name,
          icon: skill.icon,
          promptTemplate: skill.promptTemplate,
          negativePrompt: skill.negativePrompt ?? undefined,
          defaultParams: skill.defaultParams ?? undefined,
        }));
        setStyles(list);
      })
      .catch(() => undefined);
    fetch("/api/models?type=CHECKPOINT")
      .then((res) => res.json())
      .then((data: ModelsApiResponse) => {
        const names: string[] = (data.models ?? []).map(
          (model) => model.fileName,
        );
        setCheckpoints(names);
        const first = names[0];
        if (first) setCheckpoint(first);
      })
      .catch(() => undefined);
    // API 直连通道(生图/视频)的脱敏配置视图;失败按未配置处理。
    void fetchApiChannels().then(setApiChannels);
  }, []);

  /** 提示条自动消失，避免需要用户手动关闭的瞬时噪声。 */
  React.useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  /**
   * 分镜阶段的单镜生图(StoryboardPlanner 的 onGenerate 契约不变):
   * 走与画布一致的本地 ComfyUI 链路(tRPC generate → SSE 任务流),
   * 结果回写 Shot.imageUrl / status,镜头生图阶段自动继承。
   */
  const generateShot = React.useCallback(
    async (shot: Shot) => {
      if (!checkpoint) {
        setNotice("请先在右侧「生成资源」选择一个本地 Checkpoint");
        return;
      }
      setGenerating(true);
      setShots((prev) =>
        prev.map((item) =>
          item.id === shot.id ? { ...item, status: "running" } : item,
        ),
      );
      try {
        const input: GenerateInput = {
          workflow: "txt2img",
          prompt: shot.prompt,
          negative: shot.negativePrompt || undefined,
          checkpoint,
          steps: Math.round(paramNumber(shot.params.steps, 28)),
          cfg: paramNumber(shot.params.cfg, 7),
          sampler: paramString(shot.params.sampler, "euler_ancestral"),
          scheduler: paramString(shot.params.scheduler, "normal"),
          size: paramString(shot.params.size, "832x1216"),
          count: 1,
        };
        const taskId = await startLocalGenerate(input);
        setShots((prev) =>
          prev.map((item) => (item.id === shot.id ? { ...item, taskId } : item)),
        );
        await new Promise<void>((resolve) => {
          watchTask(taskId, {
            onProgress: (pct, node) => {
              setShotProgress((prev) => ({
                ...prev,
                [shot.id]: { pct, ...(node?.label ? { label: node.label } : {}) },
              }));
            },
            onOutput: (out) => {
              if (out.kind !== "video") {
                setShots((prev) =>
                  prev.map((item) =>
                    item.id === shot.id ? { ...item, imageUrl: out.url } : item,
                  ),
                );
              }
            },
            onSettled: (result) => {
              setShotProgress((prev) => {
                const next = { ...prev };
                delete next[shot.id];
                return next;
              });
              setShots((prev) =>
                prev.map((item) =>
                  item.id === shot.id
                    ? { ...item, status: result.ok ? "done" : "failed" }
                    : item,
                ),
              );
              resolve();
            },
          });
        });
      } catch (err: unknown) {
        setShots((prev) =>
          prev.map((item) =>
            item.id === shot.id ? { ...item, status: "failed" } : item,
          ),
        );
        const message = errorMessage(err, "生成失败");
        console.error(message);
        setNotice(message);
      } finally {
        setGenerating(false);
      }
    },
    [checkpoint],
  );

  const imageDoneCount = shots.filter((item) => !!item.imageUrl).length;
  const clipDoneCount = shots.filter((item) => !!item.clipUrl).length;
  const scriptReady = !!scriptMarkdown.trim() || scenes.length > 0;

  const viewContext: StageViewContext = React.useMemo(
    () => ({
      scriptReady,
      characterCount: characters.length,
      sceneCount: scenes.length,
      shotCount: shots.length,
      imageDoneCount,
      clipDoneCount,
    }),
    [
      scriptReady,
      characters.length,
      scenes.length,
      shots.length,
      imageDoneCount,
      clipDoneCount,
    ],
  );

  const gridShots = React.useMemo(() => buildGridShots(scenes), [scenes]);
  const missing = React.useMemo(
    () => buildMissingSummary(viewContext),
    [viewContext],
  );

  const stageRatios = computeStageRatios(viewContext, rendered);
  const progressPct = computeProgressPct(stageRatios);
  const prereq = stagePrereq(tab, viewContext);
  const pendingCategories = Object.values(stageRatios).filter(
    (ratio) => ratio < 1,
  ).length;
  const { title: stageTitle, desc: stageDesc } = STAGE_TITLES[tab];
  const stageIndex = STAGE_DEFS.findIndex((stage) => stage.id === tab) + 1;

  const beginOutlineEdit = React.useCallback(() => {
    setDraftOutline(outline);
    setEditingOutline(true);
  }, [outline]);

  const cancelOutlineEdit = React.useCallback(() => {
    setEditingOutline(false);
  }, []);

  const saveOutline = React.useCallback(() => {
    setOutline(draftOutline);
    setEditingOutline(false);
  }, [draftOutline]);

  const openScriptEditor = React.useCallback(() => {
    setIsScriptEditorOpen(true);
  }, []);

  const closeScriptEditor = React.useCallback(() => {
    setIsScriptEditorOpen(false);
  }, []);

  const saveScriptEditor = React.useCallback(() => {
    setMeta((prev) => ({ ...prev, scriptMarkdown }));
    setIsScriptEditorOpen(false);
  }, [scriptMarkdown]);

  const openApiSettings = React.useCallback(() => setApiSettingsOpen(true), []);
  const closeApiSettings = React.useCallback(() => setApiSettingsOpen(false), []);

  const handleApiChannelsSaved = React.useCallback(
    (channels: ApiChannelsView) => {
      setApiChannels(channels);
      setApiSettingsOpen(false);
    },
    [],
  );

  const dismissNotice = React.useCallback(() => setNotice(null), []);
  const markRendered = React.useCallback(() => setRendered(true), []);

  return {
    tab,
    setTab,
    stageIndex,
    stageTitle,
    stageDesc,
    stageRatios,
    progressPct,
    prereq,
    pendingCategories,
    viewContext,
    gridShots,
    missing,

    meta,
    setMeta,
    outline,
    scriptMarkdown,
    setScriptMarkdown,
    scenes,
    setScenes,
    characters,
    setCharacters,
    shots,
    setShots,
    styles,
    checkpoints,
    checkpoint,
    setCheckpoint,
    apiChannels,
    imageDoneCount,
    clipDoneCount,
    rendered,

    generating,
    shotProgress,
    draftSavedAt,
    editingOutline,
    draftOutline,
    isScriptEditorOpen,
    apiSettingsOpen,
    notice,

    generateShot,
    beginOutlineEdit,
    cancelOutlineEdit,
    saveOutline,
    setDraftOutline,
    openScriptEditor,
    closeScriptEditor,
    saveScriptEditor,
    openApiSettings,
    closeApiSettings,
    handleApiChannelsSaved,
    dismissNotice,
    markRendered,
  };
}
