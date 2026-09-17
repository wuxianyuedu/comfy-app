"use client";

// 工坊管线的全部业务逻辑：状态、草稿持久化、资源拉取、生图流程、派生进度。
// 视图层只消费这里返回的 controller，不持有任何业务规则。

import React from "react";

import type { ApiChannelsView } from "~/lib/workshop/api-channel-shared";
import {
  buildLibraryWorkflowInput,
  fetchApiChannels,
  fetchWorkshopWorkflows,
  startLocalGenerate,
  watchTask,
  type GenerateInput,
  type WorkshopWorkflowOption,
} from "~/lib/workshop/generation-client";
import {
  fetchServerDraft,
  fetchServerDraftList,
  pushServerDraft,
  deleteServerDraft,
} from "~/lib/workshop/draft-sync-client";
import {
  draftHasContent,
  type WorkshopDraftDto,
} from "~/lib/workshop/draft-sync-shared";
import type {
  Character,
  ProjectMeta,
  Scene,
  Shot,
  StyleRef,
} from "~/lib/workshop/types";
import {
  buildMissingSummary,
  computeProgressPct,
  computeStageRatios,
  stagePrereq,
  STAGE_DEFS,
  STAGE_TITLES,
  type MissingItem,
  type StageRatios,
  type StageViewContext,
  type Tab,
} from "~/components/workshop/stage-config";

import { parseShotSize } from "~/components/workshop/shot-size-config";
import type { ExtractLogEntry } from "~/lib/workshop/extraction-log";
import { persistGenerationLogs } from "~/lib/workshop/generation-log-client";
import type { GenerationLogStage } from "~/lib/workshop/generation-log";
import { errorMessage } from "~/lib/error-message";
import {
  useCharacterPortrait,
  type PortraitSession,
  type PortraitSessionActions,
} from "./use-character-portrait";

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
  scriptMarkdown: string;
  scenes: Scene[];
  characters: Character[];
  shots: Shot[];
  /** 工坊「生图」阶段选定用来生成的「工作流库工作流」id（ISSUE #145）。
   *  仅本地持久化（服务端镜像不含此字段）。 */
  workflowId: string;
  /** 工坊「视频」阶段选定的「工作流库工作流」id。
   *  字段与生图分开 —— 两类工作流的对外参数口径不同（生图无首帧、视频有），
   *  共用一个 id 会互相串味。 */
  videoWorkflowId: string;
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
    scriptMarkdown: "",
    scenes: [],
    characters: [],
    shots: [],
    workflowId: "",
    videoWorkflowId: "",
  };
}

/** 服务端 DTO → 内部草稿（字段完全同构，显式构造避免隐式 cast 告警）。 */
function dtoToDraft(dto: WorkshopDraftDto): WorkshopDraft {
  return {
    meta: dto.meta,
    scriptMarkdown: dto.scriptMarkdown ?? "",
    scenes: dto.scenes ?? [],
    characters: dto.characters ?? [],
    shots: dto.shots ?? [],
    workflowId: "",
    videoWorkflowId: "",
  };
}

/** 内部草稿是否为「空」——仅空时才值得用服务端镜像覆盖（避免覆盖进行中的编辑）。 */
function draftIsEmpty(draft: WorkshopDraft): boolean {
  return (
    !draft.scriptMarkdown &&
    draft.scenes.length === 0 &&
    draft.characters.length === 0 &&
    draft.shots.length === 0
  );
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
      scriptMarkdown:
        typeof draft.scriptMarkdown === "string" ? draft.scriptMarkdown : "",
      scenes: Array.isArray(draft.scenes) ? draft.scenes : [],
      characters: Array.isArray(draft.characters) ? draft.characters : [],
      shots: Array.isArray(draft.shots) ? draft.shots : [],
      workflowId: typeof draft.workflowId === "string" ? draft.workflowId : "",
      videoWorkflowId:
        typeof draft.videoWorkflowId === "string" ? draft.videoWorkflowId : "",
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
    window.localStorage.setItem(
      draftKeyFor(id),
      JSON.stringify({ v: 1, ...draft }),
    );
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
      return freshIndex(
        parseDraft(window.localStorage.getItem(LEGACY_DRAFT_KEY)),
      );
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
  /* invalidateDraftCache() 卸载/切项目时把缓存置 null 标记“需从 localStorage 重读”。
   * 这里须用 ??=（null / undefined 都重读），若原先 === undefined 的判空，置 null 后的
   * 重挂载会跳过重读直接返回 null → 剧本内容恢复成空（切页签即丢）。 */
  workshopDraftCache ??= readDraft(loadProjectsOnce().activeId);
  return workshopDraftCache;
}

/** 本浏览器会话内已做过一次「服务端镜像回填」的项目集合（避免热重挂载反复拉取）。 */
const serverRecoveredIds = new Set<string>();
/** 是否已把服务端项目列表并回本地索引（会话级只做一次）。 */
let serverListRecovered = false;

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

/** 每个镜头节点的实时生成进度（pct + 当前 ComfyUI 节点类别）。 */
export type ShotProgressMap = Record<string, { pct: number; label?: string }>;

/** 工坊「从剧本提取」/工具类会话的界面状态。
 *
 *  角色卡 / 分镜的提取是长耗时异步流程：切走页签只卸载 stage 组件，
 *  controller 仍常驻，故把 busy/progress/status/error/channel/执行日志统一
 *  收在 controller 层 —— 提取中切页签再切回，进度与日志不丢（取代原先
 *  散落在各组件里的会话级模块缓存）。
 */
export interface ExtractSession {
  /** 模型下拉完整选项值（tool | local::<model> | remote::<model>） */
  channelValue: string;
  busy: boolean;
  /** 成功 / 结果提示文案 */
  status: string;
  /** 模型通道的实时流式提取过程（token 累积） */
  progress: string;
  error: string;
  /** 结构化执行日志（输入/输出/结果/错误），跑完仍保留展示 */
  log: ExtractLogEntry[];
}

/** 提取会话更新动作：patch 更新普通字段，appendLog / resetLog 维护日志。
 *  阶段组件卸载期间后台 async 仍可调用（controller 常驻），故能跨页签续传。 */
export interface ExtractSessionActions {
  /** 合并更新普通字段（通道 / busy / status / progress / error） */
  patch: (
    p:
      | Partial<
          Pick<
            ExtractSession,
            "channelValue" | "busy" | "status" | "progress" | "error"
          >
        >
      | ((
          prev: ExtractSession,
        ) => Partial<
          Pick<
            ExtractSession,
            "channelValue" | "busy" | "status" | "progress" | "error"
          >
        >),
  ) => void;
  /** 向实时 process 追加一段文本（流式 token 累积用） */
  appendProgress: (text: string) => void;
  /** 追加一条结构化执行日志 */
  appendLog: (entry: ExtractLogEntry) => void;
  /** 以给定数组整体替换执行日志（新一次提取重置时用） */
  setLog: (entries: ExtractLogEntry[]) => void;
}

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
  missing: MissingItem[];

  // ── 数据
  meta: ProjectMeta;
  setMeta: React.Dispatch<React.SetStateAction<ProjectMeta>>;
  scriptMarkdown: string;
  setScriptMarkdown: (value: string) => void;
  scenes: Scene[];
  setScenes: React.Dispatch<React.SetStateAction<Scene[]>>;
  characters: Character[];
  setCharacters: React.Dispatch<React.SetStateAction<Character[]>>;
  shots: Shot[];
  setShots: React.Dispatch<React.SetStateAction<Shot[]>>;
  styles: StyleRef[];
  /** 工作流库里的可选工作流（ISSUE #145）。 */
  workflowOptions: WorkshopWorkflowOption[];
  /** 生图阶段选定的工作流 id（本地链路唯一来源，空串 = 未选）。 */
  workflowId: string;
  setWorkflowId: (value: string) => void;
  /** 视频阶段选定的工作流 id（空串 = 未选）。 */
  videoWorkflowId: string;
  setVideoWorkflowId: (value: string) => void;
  apiChannels: ApiChannelsView | null;
  imageDoneCount: number;
  clipDoneCount: number;
  rendered: boolean;

  // ── 交互态
  generating: boolean;
  shotProgress: ShotProgressMap;
  isScriptEditorOpen: boolean;
  apiSettingsOpen: boolean;
  /** 「模式契约」弹窗开关（与 apiSettingsOpen 并列的独立入口）。 */
  modeContractOpen: boolean;
  /** 需要引起用户注意的失败/阻断文案（替代 alert，由视图决定怎么渲染）。 */
  notice: string | null;

  // ── 提取会话（角色卡 / 分镜）：busy / progress / 日志 收归 controller ──
  characterExtract: ExtractSession;
  characterExtractActions: ExtractSessionActions;
  storyboardExtract: ExtractSession;
  storyboardExtractActions: ExtractSessionActions;
  /** 角色定妆照：生成 / 导入的进度与日志（跨页签常驻） */
  characterPortrait: PortraitSession;
  characterPortraitActions: PortraitSessionActions;

  // ── 动作
  generateShot: (shot: Shot) => Promise<void>;
  openScriptEditor: () => void;
  closeScriptEditor: () => void;
  saveScriptEditor: () => void;
  openApiSettings: () => void;
  closeApiSettings: () => void;
  openModeContract: () => void;
  closeModeContract: () => void;
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

/** 创建一个收在 controller 的提取会话（state + 稳定动作）。
 *  在工坊控制器内调用两次（角色卡 / 分镜），动作经 useCallback 保持稳定，
 *  即使阶段组件卸载期间后台 async 仍能安全调用更新。 */
export function useExtractSession(
  defaultChannel: string,
  /** 传了环节名（character / storyboard）就把每条执行日志异步落盘到
   *  log/workshop/（fire-and-forget），刷新 / 重启后可在「历史」里回看。 */
  stage?: GenerationLogStage,
): [ExtractSession, ExtractSessionActions] {
  const [session, setSession] = React.useState<ExtractSession>(() => ({
    channelValue: defaultChannel,
    busy: false,
    status: "",
    progress: "",
    error: "",
    log: [],
  }));
  const patch = React.useCallback(
    (
      p:
        | Partial<
            Pick<
              ExtractSession,
              "channelValue" | "busy" | "status" | "progress" | "error"
            >
          >
        | ((
            prev: ExtractSession,
          ) => Partial<
            Pick<
              ExtractSession,
              "channelValue" | "busy" | "status" | "progress" | "error"
            >
          >),
    ) =>
      setSession((prev) => ({
        ...prev,
        ...(typeof p === "function" ? p(prev) : p),
      })),
    [],
  );
  const appendProgress = React.useCallback((text: string) => {
    setSession((prev) => ({ ...prev, progress: prev.progress + text }));
  }, []);
  const appendLog = React.useCallback(
    (entry: ExtractLogEntry) => {
      setSession((prev) => ({ ...prev, log: [...prev.log, entry] }));
      if (stage) persistGenerationLogs(stage, [entry]);
    },
    [stage],
  );
  const setLog = React.useCallback((entries: ExtractLogEntry[]) => {
    setSession((prev) => ({ ...prev, log: entries }));
  }, []);
  return [session, { patch, appendProgress, appendLog, setLog }];
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
  /* 工坊可用的工作流库工作流 + 当前选择（ISSUE #145）：本地通道的唯一来源。 */
  const [workflowOptions, setWorkflowOptions] = React.useState<
    WorkshopWorkflowOption[]
  >([]);
  const [workflowId, setWorkflowId] = React.useState(
    () => loadWorkshopDraftOnce()?.workflowId ?? "",
  );
  const [videoWorkflowId, setVideoWorkflowId] = React.useState(
    () => loadWorkshopDraftOnce()?.videoWorkflowId ?? "",
  );
  const [generating, setGenerating] = React.useState(false);
  const [shotProgress, setShotProgress] = React.useState<ShotProgressMap>({});
  const [rendered, setRendered] = React.useState(false);
  const [apiChannels, setApiChannels] = React.useState<ApiChannelsView | null>(
    null,
  );
  const [apiSettingsOpen, setApiSettingsOpen] = React.useState(false);
  /* 模式契约是与模型适配并列的独立界面（ISSUE #597）：两个开关、两个弹窗。 */
  const [modeContractOpen, setModeContractOpen] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);

  // ── 提取会话收归 controller：切页签卸载只丢 stage 组件，此处常驻 ──
  const [characterExtract, characterExtractActions] = useExtractSession(
    "tool",
    "character",
  );
  const [storyboardExtract, storyboardExtractActions] = useExtractSession(
    "tool",
    "storyboard",
  );

  // 剧本内容默认为空，全部内容经 localStorage 草稿持久化
  // （防抖自动保存，挂载时惰性恢复）。
  const [scriptMarkdown, setScriptMarkdown] = React.useState(
    () => loadWorkshopDraftOnce()?.scriptMarkdown ?? "",
  );
  const [isScriptEditorOpen, setIsScriptEditorOpen] = React.useState(false);

  /* ── 多项目：索引与当前项目 id ── */
  const [projectsIndex, setProjectsIndex] =
    React.useState<WorkshopProjectsIndex>(() => loadProjectsOnce());
  const [activeProjectId, setActiveProjectId] = React.useState<string>(
    () => loadProjectsOnce().activeId,
  );

  // ── 角色定妆照会话（同提取会话：由 controller 常驻，切页签不丢进度；
  //    候选写在角色对象上，随草稿持久化）──
  const [characterPortrait, characterPortraitActions] = useCharacterPortrait({
    setCharacters,
    projectId: activeProjectId,
  });

  /** 定妆照任务期间禁止换项目。
   *
   *  换项目会用目标项目的草稿替换 `characters`，发起时那张角色卡已不在列表里，
   *  在途的结果只能丢弃 —— 而一次本机定妆照要跑几分钟，白跑不可接受。故拦下并
   *  给出可见出口（notice），而不是让项目切换器无声失效。
   *  返回 true 表示已拦下（调用方直接 return）。 */
  const blockedByPortraitTask = React.useCallback((): boolean => {
    if (!characterPortrait.busy && !characterPortrait.importing) return false;
    setNotice("定妆照正在生成，请等这一次跑完再切换项目");
    return true;
  }, [characterPortrait.busy, characterPortrait.importing]);

  /** 当前全部可持久化内容（落盘、切换前保存都用它）。 */
  const currentDraft = React.useCallback(
    (): WorkshopDraft => ({
      meta,
      scriptMarkdown,
      scenes,
      characters,
      shots,
      workflowId,
      videoWorkflowId,
    }),
    [
      meta,
      scriptMarkdown,
      scenes,
      characters,
      shots,
      workflowId,
      videoWorkflowId,
    ],
  );

  /** 把一份草稿灌进所有受管 state（切换 / 删除项目后接手时调用）。 */
  const applyDraft = React.useCallback((draft: WorkshopDraft) => {
    setMeta(draft.meta);
    setScenes(draft.scenes);
    setCharacters(draft.characters);
    setShots(draft.shots);
    setWorkflowId(draft.workflowId ?? "");
    setVideoWorkflowId(draft.videoWorkflowId ?? "");
    setScriptMarkdown(draft.scriptMarkdown);
  }, []);

  /* 最新项目 id / 草稿的 ref：供卸载兜底与异步服务端回填读取最新值（避免闭包捕获陈旧 state）。 */
  const activeProjectRef = React.useRef(activeProjectId);
  const latestDraftRef = React.useRef<WorkshopDraft>(currentDraft());
  const projectsIndexRef = React.useRef(projectsIndex);
  React.useEffect(() => {
    activeProjectRef.current = activeProjectId;
    latestDraftRef.current = currentDraft();
    projectsIndexRef.current = projectsIndex;
  });

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
      if (blockedByPortraitTask()) return;
      /* 先把当前内容同步落盘（localStorage + 服务端）：否则防抖中的定时器醒来会把
       * 旧内容写到新项目上，且切走前最后一改若未及服务端可能在崩溃时丢失。 */
      const outgoing = currentDraft();
      writeDraft(activeProjectId, outgoing);
      void pushServerDraft(activeProjectId, outgoing);
      const next: WorkshopProjectsIndex = {
        activeId: id,
        items: snapshotActiveInto(projectsIndex.items),
      };
      saveProjectsIndex(next);
      setProjectsIndex(next);
      setActiveProjectId(id);
      invalidateDraftCache();
      const localDraft = readDraft(id);
      applyDraft(localDraft);
      /* 目标项目本地为空但服务端有镜像（例如清缓存后重建的项目）→ 异步回填。 */
      if (draftIsEmpty(localDraft) && !serverRecoveredIds.has(id)) {
        serverRecoveredIds.add(id);
        void fetchServerDraft(id).then((serverDraft) => {
          if (serverDraft && draftHasContent(serverDraft)) {
            const draft = dtoToDraft(serverDraft);
            writeDraft(id, draft);
            workshopDraftCache = draft;
            // 仅当仍停留在该项目时才应用，避免把用户刚切走后的内容覆盖。
            if (activeProjectRef.current === id) applyDraft(draft);
          }
        });
      }
    },
    [
      activeProjectId,
      currentDraft,
      projectsIndex.items,
      snapshotActiveInto,
      applyDraft,
      blockedByPortraitTask,
    ],
  );

  const createProject = React.useCallback(
    (title?: string) => {
      /* 新建项目同样会把 activeId 切到新项目（见 blockedByPortraitTask）。 */
      if (blockedByPortraitTask()) return;
      const outgoing = currentDraft();
      writeDraft(activeProjectId, outgoing);
      void pushServerDraft(activeProjectId, outgoing);
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
      blockedByPortraitTask,
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
      /* 删掉的若是当前项目，activeId 会跳到别的项目（同样替换 characters）：
       * 与切换同口径拦下；删别的项目不动当前项目，不必拦。 */
      if (id === projectsIndex.activeId && blockedByPortraitTask()) return;
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
      void deleteServerDraft(id);
      const next: WorkshopProjectsIndex = { activeId, items };
      saveProjectsIndex(next);
      setProjectsIndex(next);
      invalidateDraftCache();
    },
    [projectsIndex, applyDraft, blockedByPortraitTask],
  );

  /* 自动保存只写当前项目的键；索引里的标题在切换 / 新建时快照，
   * 因此这里不需要动 React state，也就不会自触发形成回环。 */
  React.useEffect(() => {
    const timer = setTimeout(() => {
      const draft = currentDraft();
      // localStorage 为即时缓存；同时写穿一份到本地 db.sqlite（防缓存被清丢失）。
      writeDraft(activeProjectId, draft);
      void pushServerDraft(activeProjectId, draft);
    }, 600);
    return () => clearTimeout(timer);
  }, [activeProjectId, currentDraft]);

  /* 卸载兜底保存 —— 工坊常作为 workspace 的一个页签渲染，切走其它页签时本组件
   * 会被卸载。若只靠上面的 600ms 防抖，用户在编辑/导入剧本后立刻切走，卸载时
   * 定时器被 clear 掉还来不及落盘；更关键的是模块级草稿缓存(workshopDraftCache)
   * 只在首次挂载读一次，重挂载时会读到首挂载那份旧缓存草稿，而不是刚写进
   * localStorage 的新内容 —— 两处叠加正是「切页签后剧本内容丢失」的根因。
   * 卸载时：立即把最新草稿落盘 + 让模块级缓存失效，下次挂载重新读 localStorage。
   * ref 在每次渲染后同步最新值，卸载 cleanup 经 ref 取值，避免闭包捕获旧草稿。 */
  React.useEffect(() => {
    return () => {
      const draft = latestDraftRef.current;
      writeDraft(activeProjectRef.current, draft);
      void pushServerDraft(activeProjectRef.current, draft);
      invalidateDraftCache();
    };
    // 仅在卸载时执行一次
  }, []);

  /* 挂载回填：把服务端 db.sqlite 里的项目镜像找回来，防 localStorage 被清后丢内容。
   * 只做两件事，都不覆盖用户进行中的编辑：
   *  1) 本地索引缺的云端项目补进索引（清空 localStorage 后仍能找到旧项目）；
   *  2) 当前项目本地为空但云端有内容时，用云端内容恢复当前项目。
   * 同会话只执行一次（热重挂载由上面的卸载兜底保存保住了 localStorage）。 */
  React.useEffect(() => {
    void (async () => {
      const activeId = activeProjectRef.current;
      try {
        const summaries = await fetchServerDraftList();
        if (summaries.length > 0 && !serverListRecovered) {
          serverListRecovered = true;
          // 基于最新已提交的索引(经 ref 读,避免闭包陈旧 state)做纯合并,
          // 副作用(落盘/缓存)留在 setState 之外——updater 必须是纯函数,
          // 渲染期写 localStorage / 外部缓存会触发 "update during render" 告警。
          const prev = projectsIndexRef.current;
          const known = new Set(prev.items.map((i) => i.id));
          const missing = summaries.filter((d) => !known.has(d.id));
          if (missing.length > 0) {
            const next: WorkshopProjectsIndex = {
              activeId: prev.activeId,
              items: [
                ...prev.items,
                ...missing.map((d) => ({
                  id: d.id,
                  title: d.title,
                  updatedAt: d.updatedAt,
                })),
              ],
            };
            saveProjectsIndex(next);
            projectsCache = next;
            setProjectsIndex(next);
          }
        }
      } catch {
        /* 服务不可用：保持纯本地 */
      }

      if (serverRecoveredIds.has(activeId)) return;
      serverRecoveredIds.add(activeId);

      const localEmpty = draftIsEmpty(latestDraftRef.current);
      if (!localEmpty) return;
      const serverDraft = await fetchServerDraft(activeId);
      if (serverDraft && draftHasContent(serverDraft)) {
        const draft = dtoToDraft(serverDraft);
        writeDraft(activeId, draft);
        applyDraft(draft);
        // 让模块级草稿缓存也指向恢复后的内容，避免再次重挂载读到旧空草稿。
        workshopDraftCache = draft;
      }
    })();
    // 仅首挂载执行一次；闭包读取经 ref / 函数式 set，避免陈旧 state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    // API 直连通道(生图/视频)的脱敏配置视图;失败按未配置处理。
    void fetchApiChannels().then(setApiChannels);
    // 工作流库列表：工坊「生成资源」里可选择用哪个工作流生成（ISSUE #145）。
    void fetchWorkshopWorkflows()
      .then(setWorkflowOptions)
      .catch(() => undefined);
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
  /** 单镜生成请求的封装：本地通道一律走工作流库工作流（内置模板已移除），
   *  按 ISSUE #145 只暴露 提示词 / 尺寸 / 参考图，其余走工作流默认值。
   *
   *  尺寸只表达一次（比例 + 分辨率 或 比例 + 百万像素 + 倍数）：整块交给封装层
   *  （宽高由 size-presets 按场景现算）。 */
  const buildShotInput = React.useCallback(
    async (shot: Shot): Promise<GenerateInput> => {
      /* 草稿里存的是尺寸表达（老数据可能是 "832x1216" 字符串，回读时归一）。 */
      const sizeSpec = parseShotSize(shot.params.size);
      const { input } = await buildLibraryWorkflowInput(workflowId, {
        prompt: shot.prompt,
        negativePrompt: shot.negativePrompt || undefined,
        size: sizeSpec,
      });
      return input;
    },
    [workflowId],
  );

  const generateShot = React.useCallback(
    async (shot: Shot) => {
      // 本地通道没有内置模板可回落：必须先选好一个工作流库生图工作流。
      if (!workflowId) {
        setNotice("请先在右侧「生成资源」选择一个生图工作流（工作流库）");
        return;
      }
      setGenerating(true);
      setShots((prev) =>
        prev.map((item) =>
          item.id === shot.id ? { ...item, status: "running" } : item,
        ),
      );
      try {
        const input = await buildShotInput(shot);
        const taskId = await startLocalGenerate(input);
        setShots((prev) =>
          prev.map((item) =>
            item.id === shot.id ? { ...item, taskId } : item,
          ),
        );
        await new Promise<void>((resolve) => {
          watchTask(taskId, {
            onProgress: (pct, node) => {
              setShotProgress((prev) => ({
                ...prev,
                [shot.id]: {
                  pct,
                  ...(node?.label ? { label: node.label } : {}),
                },
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
    [workflowId, buildShotInput],
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
  const closeApiSettings = React.useCallback(
    () => setApiSettingsOpen(false),
    [],
  );
  const openModeContract = React.useCallback(
    () => setModeContractOpen(true),
    [],
  );
  const closeModeContract = React.useCallback(
    () => setModeContractOpen(false),
    [],
  );

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
    missing,

    meta,
    setMeta,
    scriptMarkdown,
    setScriptMarkdown,
    scenes,
    setScenes,
    characters,
    setCharacters,
    shots,
    setShots,
    styles,
    workflowOptions,
    workflowId,
    setWorkflowId,
    videoWorkflowId,
    setVideoWorkflowId,
    apiChannels,
    imageDoneCount,
    clipDoneCount,
    rendered,

    generating,
    shotProgress,
    isScriptEditorOpen,
    apiSettingsOpen,
    modeContractOpen,
    notice,

    characterExtract,
    characterExtractActions,
    storyboardExtract,
    storyboardExtractActions,
    characterPortrait,
    characterPortraitActions,

    generateShot,
    openScriptEditor,
    closeScriptEditor,
    saveScriptEditor,
    openApiSettings,
    closeApiSettings,
    openModeContract,
    closeModeContract,
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
