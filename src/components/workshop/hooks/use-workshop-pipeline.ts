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

/* ── 工坊项目存储层（单草稿 → 多项目可切换） ──
 *
 *  索引（项目列表 + 当前项目 id）单独存一个键，每个项目的正文按 id 各存一个键。
 *  这样切换项目只读当前那份草稿，不必把全部项目正文都解析一遍。
 *  旧版只有一个固定键的单草稿，首次升级时会被收编成项目 #1，老用户不丢内容。 */
const PROJECTS_INDEX_KEY = "comfyapp.workshop.projects.v1";
const LEGACY_DRAFT_KEY = "comfyapp.workshop.draft.v1";

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

/** 项目摘要：切换器只需要这几个字段，正文按 id 另读。 */
export interface WorkshopProjectSummary {
  id: string;
  title: string;
  updatedAt: string;
}
interface WorkshopProjectsIndex {
  activeId: string;
  items: WorkshopProjectSummary[];
}

function emptyDraft(): WorkshopDraft {
  return {
    meta: DEFAULT_META,
    outline: "",
    scriptMarkdown: "",
    scenes: [],
    characters: [],
    shots: [],
    checkpoint: "",
  };
}

function draftKeyFor(id: string): string {
  return `comfyapp.workshop.draft.${id}.v1`;
}

function newProjectId(): string {
  return `wsp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 解析并补全一份草稿：逐字段校验类型，损坏则回退成空草稿。 */
function parseDraft(raw: string | null): WorkshopDraft {
  if (!raw) return emptyDraft();
  try {
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
    return emptyDraft();
  }
}

/** SSR / 隐私模式下同样安全：读不到就当作空草稿。 */
function readDraft(id: string): WorkshopDraft {
  if (typeof window === "undefined") return emptyDraft();
  try {
    return parseDraft(window.localStorage.getItem(draftKeyFor(id)));
  } catch {
    return emptyDraft();
  }
}

function writeDraft(id: string, draft: WorkshopDraft): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(draftKeyFor(id), JSON.stringify({ v: 1, ...draft }));
  } catch {
    /* 存储满 / 隐私模式：静默失败，不影响编辑 */
  }
}

function saveProjectsIndex(index: WorkshopProjectsIndex): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PROJECTS_INDEX_KEY, JSON.stringify(index));
  } catch {
    /* 存储满 / 隐私模式：静默失败 */
  }
}

/** 读取项目索引。索引不存在时把旧版单草稿迁移为第一个项目。 */
function loadProjectsIndex(): WorkshopProjectsIndex {
  const freshIndex = (draft: WorkshopDraft): WorkshopProjectsIndex => {
    const id = newProjectId();
    writeDraft(id, draft);
    const index: WorkshopProjectsIndex = {
      activeId: id,
      items: [
        { id, title: draft.meta.title, updatedAt: new Date().toISOString() },
      ],
    };
    saveProjectsIndex(index);
    return index;
  };
  if (typeof window === "undefined") return freshIndex(emptyDraft());
  try {
    const raw = window.localStorage.getItem(PROJECTS_INDEX_KEY);
    if (!raw) {
      /* 首次升级：旧单草稿收编成项目 #1 —— 老用户不会丢内容。 */
      return freshIndex(parseDraft(window.localStorage.getItem(LEGACY_DRAFT_KEY)));
    }
    const parsed = JSON.parse(raw) as Partial<WorkshopProjectsIndex>;
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    if (items.length === 0) return freshIndex(emptyDraft());
    const activeId = items.some((item) => item.id === parsed.activeId)
      ? parsed.activeId!
      : items[0]!.id;
    return { activeId, items };
  } catch {
    return freshIndex(emptyDraft());
  }
}

/** 页面加载期间只读一次 localStorage（多个 state 惰性初始化器共用）。 */
let projectsCache: WorkshopProjectsIndex | undefined;
function loadProjectsOnce(): WorkshopProjectsIndex {
  projectsCache ??= loadProjectsIndex();
  return projectsCache;
}
let workshopDraftCache: WorkshopDraft | null | undefined;
function loadWorkshopDraftOnce(): WorkshopDraft | null {
  if (workshopDraftCache === undefined) {
    workshopDraftCache = readDraft(loadProjectsOnce().activeId);
  }
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
  /* ── 多项目：工坊可在多个项目间切换 ── */
  projects: WorkshopProjectSummary[];
  activeProjectId: string;
  switchProject: (id: string) => void;
  createProject: (title?: string) => void;
  renameProject: (id: string, title: string) => void;
  deleteProject: (id: string) => void;
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

  // 剧本内容此前是纯内存 state（刷新即丢），且大纲默认塞了
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

  /* ── 多项目：索引与当前项目 id ── */
  const [projectsIndex, setProjectsIndex] = React.useState<WorkshopProjectsIndex>(
    () => loadProjectsOnce(),
  );
  const [activeProjectId, setActiveProjectId] = React.useState<string>(
    () => loadProjectsOnce().activeId,
  );

  /** 当前全部可持久化内容（落盘、切换前保存都用它）。 */
  const currentDraft = React.useCallback(
    (): WorkshopDraft => ({
      meta,
      outline,
      scriptMarkdown,
      scenes,
      characters,
      shots,
      checkpoint,
    }),
    [meta, outline, scriptMarkdown, scenes, characters, shots, checkpoint],
  );

  /** 把一份草稿灌进所有受管 state（切换 / 删除项目后接手时调用）。 */
  const applyDraft = React.useCallback((draft: WorkshopDraft) => {
    setMeta(draft.meta);
    setScenes(draft.scenes);
    setCharacters(draft.characters);
    setShots(draft.shots);
    setCheckpoint(draft.checkpoint);
    setOutline(draft.outline);
    setScriptMarkdown(draft.scriptMarkdown);
  }, []);

  /** 切换 / 增删项目后：让模块级缓存失效，避免组件重挂载时读回旧的当前项目。 */
  const invalidateDraftCache = () => {
    workshopDraftCache = null;
    projectsCache = undefined;
  };

  /** 把当前项目的标题与更新时间快照进索引（切换、新建前调用）。 */
  const snapshotActiveInto = React.useCallback(
    (items: WorkshopProjectSummary[]): WorkshopProjectSummary[] =>
      items.map((item) =>
        item.id === activeProjectId
          ? { ...item, title: meta.title, updatedAt: new Date().toISOString() }
          : item,
      ),
    [activeProjectId, meta.title],
  );

  const switchProject = React.useCallback(
    (id: string) => {
      if (id === activeProjectId) return;
      /* 先把当前内容同步落盘：否则防抖中的定时器醒来会把旧内容写到新项目上。 */
      writeDraft(activeProjectId, currentDraft());
      const next: WorkshopProjectsIndex = {
        activeId: id,
        items: snapshotActiveInto(projectsIndex.items),
      };
      saveProjectsIndex(next);
      setProjectsIndex(next);
      setActiveProjectId(id);
      invalidateDraftCache();
      applyDraft(readDraft(id));
    },
    [
      activeProjectId,
      currentDraft,
      projectsIndex.items,
      snapshotActiveInto,
      applyDraft,
    ],
  );

  const createProject = React.useCallback(
    (title?: string) => {
      writeDraft(activeProjectId, currentDraft());
      const id = newProjectId();
      const trimmed = title?.trim();
      const projectTitle =
        trimmed && trimmed.length > 0 ? trimmed : DEFAULT_META.title;
      const draft: WorkshopDraft = {
        ...emptyDraft(),
        meta: { ...DEFAULT_META, title: projectTitle },
      };
      writeDraft(id, draft);
      const next: WorkshopProjectsIndex = {
        activeId: id,
        items: [
          ...snapshotActiveInto(projectsIndex.items),
          { id, title: draft.meta.title, updatedAt: new Date().toISOString() },
        ],
      };
      saveProjectsIndex(next);
      setProjectsIndex(next);
      setActiveProjectId(id);
      invalidateDraftCache();
      applyDraft(draft);
    },
    [
      activeProjectId,
      currentDraft,
      projectsIndex.items,
      snapshotActiveInto,
      applyDraft,
    ],
  );

  const renameProject = React.useCallback(
    (id: string, title: string) => {
      const nextTitle = title.trim();
      if (!nextTitle) return;
      const next: WorkshopProjectsIndex = {
        ...projectsIndex,
        items: projectsIndex.items.map((item) =>
          item.id === id ? { ...item, title: nextTitle } : item,
        ),
      };
      saveProjectsIndex(next);
      setProjectsIndex(next);
      /* 改的是当前项目时，正文里的标题也要跟着变。 */
      if (id === activeProjectId) setMeta((m) => ({ ...m, title: nextTitle }));
    },
    [projectsIndex, activeProjectId],
  );

  const deleteProject = React.useCallback(
    (id: string) => {
      /* 至少保留一个项目，避免工坊变成没有可编辑对象的空壳。 */
      if (projectsIndex.items.length <= 1) return;
      const items = projectsIndex.items.filter((item) => item.id !== id);
      let activeId = projectsIndex.activeId;
      if (activeId === id) {
        activeId = items[0]!.id;
        applyDraft(readDraft(activeId));
        setActiveProjectId(activeId);
      }
      try {
        window.localStorage.removeItem(draftKeyFor(id));
      } catch {
        /* 隐私模式下可能直接抛错，忽略 */
      }
      const next: WorkshopProjectsIndex = { activeId, items };
      saveProjectsIndex(next);
      setProjectsIndex(next);
      invalidateDraftCache();
    },
    [projectsIndex, applyDraft],
  );

  /* 自动保存只写当前项目的键；索引里的标题在切换 / 新建时快照，
   * 因此这里不需要动 React state，也就不会自触发形成回环。 */
  React.useEffect(() => {
    const timer = setTimeout(() => {
      writeDraft(activeProjectId, currentDraft());
      setDraftSavedAt(new Date());
    }, 600);
    return () => clearTimeout(timer);
  }, [activeProjectId, currentDraft]);

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
    projects: projectsIndex.items,
    activeProjectId,
    switchProject,
    createProject,
    renameProject,
    deleteProject,
  };
}
