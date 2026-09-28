"use client";

// 工坊管线的全部业务逻辑：状态、草稿持久化、资源拉取、生图流程、派生进度。
// 视图层只消费这里返回的 controller，不持有任何业务规则。

import React from "react";
import { getActiveId } from "~/lib/project-canvas/canvas-store";

import type { ApiChannelsView } from "~/lib/workshop/api-channel-shared";
import {
  cancelLocalTask,
  fetchApiChannels,
  fetchTaskSnapshot,
  fetchWorkshopWorkflows,
  type WorkshopWorkflowOption,
} from "~/lib/workshop/generation-client";
import {
  fetchServerDraft,
  pushServerDraft,
} from "~/lib/workshop/draft-sync-client";
import {
  fetchProductionProgress,
  pushProduction,
} from "~/lib/production/production-client";
import { buildProductionPayload } from "~/lib/production/payload";
import { errorMessage } from "~/lib/error-message";
import { beginStaleRun } from "~/lib/stale-run";
import {
  DEFAULT_META,
  readWorkshopDraft as readDraft,
  writeWorkshopDraft as writeDraft,
  type WorkshopDraft,
} from "~/lib/workshop/draft-store";
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
  buildHealthSnapshot,
  buildMissingSummary,
  computeProgressPct,
  computeStageRatios,
  stagePrereq,
  STAGE_DEFS,
  STAGE_TITLES,
  type HealthRow,
  type MissingItem,
  type StageRatios,
  type StageViewContext,
  type Tab,
} from "~/components/workshop/stage-config";

import type { ExtractLogEntry } from "~/lib/workshop/extraction-log";
import { persistGenerationLogs } from "~/lib/workshop/generation-log-client";
import type { GenerationLogStage } from "~/lib/workshop/generation-log";
import {
  useWorkshopGeneration,
  type ShotProgressMap,
} from "./use-workshop-generation";
import {
  useCharacterPortrait,
  type PortraitSession,
  type PortraitSessionActions,
} from "./use-character-portrait";

/* ── 工坊草稿存储层（Phase 2：并入统一 proj_* 项目） ──
 *
 *  工坊不再是独立的多项目体系：当前项目 = 画布活跃 proj_*（getActiveId），
 *  草稿按 proj_* 各存一个键，服务端镜像 workshopDraft 也以 proj_* 为主键。
 *  项目的新建 / 切换 / 删除统一在首页（canvas-store）发生，工坊只跟随所在项目。 */

/* 工坊草稿的存储原语（WorkshopDraft 类型 / DEFAULT_META / readDraft / writeDraft /
 *  parseDraft / draftKeyFor / buildProductionPayload）已下沉到
 *  `~/lib/workshop/draft-store` 与 `~/lib/production/payload`——画布生成态回写
 *  （Phase 3c-2b）要写同一份按 proj_* 存的草稿，两侧必须共用同一套键规则与组装
 *  口径（§12.12 去重、§12.18 复用优先）。这里只留工坊恢复专用的两个本地转换。 */

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

/** 页面加载期间只读一次 localStorage（多个 state 惰性初始化器共用）。
 *  工坊当前项目 = 画布活跃 proj_*（getActiveId）；Phase 1 闸门保证进入工坊时
 *  已有活跃项目，异常无活跃项目时返回 null，state 落默认值。 */
let workshopDraftCache: WorkshopDraft | null | undefined;
function loadWorkshopDraftOnce(): WorkshopDraft | null {
  /* invalidateDraftCache() 卸载时把缓存置 null 标记「需从 localStorage 重读」，
   * 这里须用 ??=（null / undefined 都重读），否则重挂载读回旧缓存 → 切页签丢内容。 */
  const pid = getActiveId();
  if (!pid) return null;
  workshopDraftCache ??= readDraft(pid);
  return workshopDraftCache;
}

/** 本浏览器会话内已做过一次「服务端镜像回填」的项目集合（避免热重挂载反复拉取）。 */
const serverRecoveredIds = new Set<string>();

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

/* 进度类型随生成逻辑一起住在 `use-workshop-generation`；这里再导出一次，
   保持主管线的对外类型面不变（消费方仍从本文件取）。 */
export type { ShotProgressMap };

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
  /** 六段的健康度快照（唯一一份进度账；「还差几段」由它派生）。 */
  health: HealthRow[];
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
  /** 取消一个进行中的本机任务（生图 / 视频通用）：调 task.cancel 后由观察
   *  循环收到 CANCELLED 终态收尾。API 直连任务没有本机任务 id，取消不了。 */
  cancelShotTask: (shot: Shot, target: "image" | "video") => Promise<void>;
  openScriptEditor: () => void;
  closeScriptEditor: () => void;
  saveScriptEditor: () => void;
  openApiSettings: () => void;
  closeApiSettings: () => void;
  openModeContract: () => void;
  closeModeContract: () => void;
  handleApiChannelsSaved: (channels: ApiChannelsView) => void;
  dismissNotice: () => void;
  /** 写一条用户可见的提示（错误 / 门禁 / 未生效警告）：stage 组件内部的
   *  降级路径（如文件导入失败）经它上屏，不在视图里自建第二条提示通道。 */
  showNotice: (message: string) => void;
  markRendered: () => void;
  /* ── 所在项目（Phase 2：并入统一 proj_*，工坊不再自建多项目） ── */
  activeProjectId: string;
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
      /* 结构化日志只追加不裁剪会随长流程无限增长（P2）；保留最近一段即可。 */
      setSession((prev) => ({
        ...prev,
        log: [...prev.log, entry].slice(-EXTRACT_LOG_MAX_ENTRIES),
      }));
      if (stage) persistGenerationLogs(stage, [entry]);
    },
    [stage],
  );
  const setLog = React.useCallback((entries: ExtractLogEntry[]) => {
    setSession((prev) => ({ ...prev, log: entries }));
  }, []);
  return [session, { patch, appendProgress, appendLog, setLog }];
}

/** 结构化执行日志保留上限（P2：只追加不裁剪会随长流程无限增长）。 */
const EXTRACT_LOG_MAX_ENTRIES = 2000;

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
  /* 镜头进度的节流闸门（见 `~/components/ui/use-throttled-progress`）。 */
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

  /* ── 所在项目：= 画布活跃 proj_*（Phase 2 并入统一项目）。工坊内不切项目，
   *  切换在首页发生 → 重挂载时按新的 getActiveId 读对应草稿。 ── */
  const [activeProjectId] = React.useState<string>(() => getActiveId() ?? "");

  // ── 角色定妆照会话（同提取会话：由 controller 常驻，切页签不丢进度；
  //    候选写在角色对象上，随草稿持久化）──
  const [characterPortrait, characterPortraitActions] = useCharacterPortrait({
    setCharacters,
    projectId: activeProjectId,
  });

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

  /* 最新项目 id / 草稿 / 阶段 / rendered 的 ref：供卸载兜底与异步服务端回填读取最新值（避免闭包捕获陈旧 state）。 */
  const activeProjectRef = React.useRef(activeProjectId);
  const latestDraftRef = React.useRef<WorkshopDraft>(currentDraft());
  const tabRef = React.useRef(tab);
  const renderedRef = React.useRef(rendered);
  React.useEffect(() => {
    activeProjectRef.current = activeProjectId;
    latestDraftRef.current = currentDraft();
    tabRef.current = tab;
    renderedRef.current = rendered;
  });

  /** 卸载时让模块级草稿缓存失效，避免组件重挂载时读回旧的当前项目草稿。 */
  const invalidateDraftCache = () => {
    workshopDraftCache = null;
  };

  /* 自动保存只写当前项目的键；因此这里不需要动 React state，也就不会自触发形成回环。 */
  React.useEffect(() => {
    const timer = setTimeout(() => {
      const draft = currentDraft();
      // localStorage 为即时缓存；同时写穿一份到本地 db.sqlite（防缓存被清丢失）。
      writeDraft(activeProjectId, draft);
      void pushServerDraft(activeProjectId, draft);
      // Phase 3b-2：额外写穿一份「生产数据」到 production 表，供画布读取物化（3c）。
      void pushProduction(
        activeProjectId,
        buildProductionPayload(draft, tab, rendered),
      );
    }, 600);
    return () => clearTimeout(timer);
  }, [activeProjectId, currentDraft, tab, rendered]);

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
      void pushProduction(
        activeProjectRef.current,
        buildProductionPayload(draft, tabRef.current, renderedRef.current),
      );
      invalidateDraftCache();
    };
    // 仅在卸载时执行一次
  }, []);

  /* 挂载回填：当前项目本地为空、但服务端 db.sqlite 有镜像（清缓存 / 换设备后）时，
   * 用云端内容恢复当前项目，不覆盖进行中的编辑。同会话只执行一次
   *（热重挂载由上面的卸载兜底保存保住了 localStorage）。 */
  React.useEffect(() => {
    void (async () => {
      const activeId = activeProjectRef.current;
      if (!activeId) return;
      if (serverRecoveredIds.has(activeId)) return;
      serverRecoveredIds.add(activeId);
      if (!draftIsEmpty(latestDraftRef.current)) return;
      try {
        const serverDraft = await fetchServerDraft(activeId);
        if (serverDraft && draftHasContent(serverDraft)) {
          const draft = dtoToDraft(serverDraft);
          writeDraft(activeId, draft);
          applyDraft(draft);
          // 让模块级草稿缓存也指向恢复后的内容，避免再次重挂载读到旧空草稿。
          workshopDraftCache = draft;
        }
      } catch {
        /* 服务不可用：保持纯本地 */
      }
    })();
    // 仅首挂载执行一次；闭包读取经 ref，避免陈旧 state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Phase 4（设计 §7）：完成状态以 production 表的 progress 为单一持久来源。
   * 挂载时从持久化 progress 恢复 rendered —— 修「rendered 只在 React state、刷新即丢」；
   * 并在用户尚未导航（tab 仍是默认 script）时一并恢复阶段游标。服务端 progress 是本组件
   * 自己 push 上去的权威值，恢复不会覆盖进内容编辑；作废守卫用 beginStaleRun（规范 16 §16.2.4.34），
   * 卸载即 dispose、结论不落地。 */
  React.useEffect(() => {
    const activeId = activeProjectRef.current;
    if (!activeId) return;
    const guard = beginStaleRun();
    void (async () => {
      const progress = await fetchProductionProgress(activeId);
      if (!progress) return;
      guard.commit(() => {
        setRendered(progress.rendered);
        if (tabRef.current === "script") setTab(progress.stage);
      });
    })();
    return () => guard.dispose();
  }, []);

  /* 卸载守卫用 beginStaleRun（规范 16 §16.2.4.34）：本 effect 里三个请求各自
   * 落地自己的 set，组件若在请求返回前卸载，写状态既白跑也让旧闭包再多活
   * 一会儿（且并发渲染下还可能与后一轮交叠）。 */
  React.useEffect(() => {
    const guard = beginStaleRun();
    void (async () => {
      // 技能列表（风格卡）；失败按「没有技能」处理，不打断其余两路。
      try {
        const res = await fetch("/api/skills");
        const data = (await res.json()) as SkillsApiResponse;
        const list: StyleRef[] = (data.skills ?? []).map((skill) => ({
          slug: skill.slug,
          name: skill.name,
          icon: skill.icon,
          promptTemplate: skill.promptTemplate,
          negativePrompt: skill.negativePrompt ?? undefined,
          defaultParams: skill.defaultParams ?? undefined,
        }));
        guard.commit(() => setStyles(list));
      } catch {
        /* 失败就是空列表，界面走各自的空态 */
      }
    })();
    // API 直连通道(生图/视频)的脱敏配置视图;失败按未配置处理。
    void fetchApiChannels()
      .then((channels) => guard.commit(() => setApiChannels(channels)))
      .catch(() => undefined);
    // 工作流库列表：工坊「生成资源」里可选择用哪个工作流生成（ISSUE #145）。
    void fetchWorkshopWorkflows()
      .then((workflows) => guard.commit(() => setWorkflowOptions(workflows)))
      .catch(() => undefined);
    return () => guard.dispose();
  }, []);

  /* 提示条不自动消失：写入 notice 的都是错误 / 门禁 / 「未生效」警告，
   * 4 秒自灭曾让失败原因来不及读（规范 10 §10.3.1 的可见出口要求）。
   * 消除走视图常驻的「关闭」按钮（dismissNotice）；新提示整条替换旧提示。 */

  /* 单镜生图的执行态与编排（generating / shotProgress / buildShotInput /
   * generateShot）已拆到 `use-workshop-generation` —— 它只服务「跑一次生成」，
   * 混在主管线里会让「草稿与六段状态」和「高频进度回写」每次改动互相碰到。 */
  const generation = useWorkshopGeneration({
    workflowId,
    characters,
    projectId: activeProjectId,
    setShots,
    notify: setNotice,
  });

  /* 镜头目标数从场景表派生（每场景至少算 1 镜，与导入时铺占位镜头的口径同源）；
   * 场景还没拆出来时它是 0 —— 此时「还差几镜」没有可信答案，清单就不报缺口。 */
  const shotTarget = scenes.reduce(
    (sum, scene) => sum + Math.max(1, scene.shotCount),
    0,
  );

  /** 取消一个进行中的本机任务（生图 / 视频通用）。真正把界面收尾的是观察
   *  循环：task.cancel 把任务置 CANCELLED，SSE 的终态帧随后落定 —— 状态回
   *  failed、提示「已取消，可重新生成」。这里只负责发起取消并把失败原因
   *  说清（任务可能恰好已结束）。 */
  const cancelShotTask = React.useCallback(
    async (shot: Shot, target: "image" | "video") => {
      const taskId = target === "video" ? shot.clipTaskId : shot.taskId;
      if (!taskId) {
        setNotice("该任务无法取消（非本机任务，或已经结束）");
        return;
      }
      try {
        await cancelLocalTask(taskId);
        setNotice("已发送取消请求，正在等待任务停止…");
      } catch (e: unknown) {
        setNotice(errorMessage(e, "取消失败（任务可能已经结束）"));
      }
    },
    [],
  );

  /* ── 恢复失联任务（刷新 / 切走页签后重挂载）───────────────────────────
   *  草稿把 status / clipStatus=running 与任务 id 一起持久化，但观察循环活在
   *  内存里 —— 重挂载后没有任何人再订阅那条 SSE，镜头会永远停在「生成中」。
   *  恢复前先查 task 表真值：SSE 对「订阅前已终态」的任务只回放日志与一条
   *  state 帧（成功终态不带产物、不发 done 帧），直接重订阅会把已成功的任务
   *  判成「连接中断」。所以：已终态 → 直接回写产物 / 失败态；仍在跑 → 重订阅
   *  等 done 帧；查无真值 → 如实按失败收尾。生图（taskId / status）与视频
   *  （clipTaskId / clipStatus）各认各的字段。 */
  const resumedRef = React.useRef(false);
  React.useEffect(() => {
    if (resumedRef.current) return;
    resumedRef.current = true;
    /** 恢复一个失联任务：查真值 → 已终态直接回写，仍在跑才重订阅。 */
    const resumeTask = (
      shotId: string,
      taskId: string,
      target: "image" | "video",
    ) => {
      void (async () => {
        const snapshot = await fetchTaskSnapshot(taskId);
        /* 恢复是异步的：期间用户可能对同一镜头重新发起（任务 id 已换）。
         * 回写只认「仍归属本任务」的镜头，不覆盖新一轮生成的状态。 */
        const patchIfOwned = (p: Partial<Shot>) =>
          setShots((prev) =>
            prev.map((item) => {
              if (item.id !== shotId) return item;
              const owned =
                target === "video"
                  ? item.clipTaskId === taskId
                  : item.taskId === taskId;
              return owned ? { ...item, ...p } : item;
            }),
          );
        const isVideo = target === "video";
        if (!snapshot) {
          patchIfOwned(
            isVideo ? { clipStatus: "failed" } : { status: "failed" },
          );
          return;
        }
        if (snapshot.status === "SUCCEEDED") {
          /* 产物以任务真值回写（SSE 重订阅拿不到已完成任务的产物）。 */
          const output = snapshot.outputs.find(
            (o) => o.kind === (isVideo ? "video" : "image"),
          );
          if (output) {
            patchIfOwned(
              isVideo
                ? { clipUrl: output.url, clipStatus: "done" }
                : { imageUrl: output.url, status: "done" },
            );
          } else {
            patchIfOwned(
              isVideo ? { clipStatus: "failed" } : { status: "failed" },
            );
            setNotice(
              isVideo
                ? "视频任务已完成但没有产出文件，请重新生成该片段"
                : "任务已完成但没有产出文件，请重新生成该镜头",
            );
          }
          return;
        }
        if (snapshot.status === "FAILED" || snapshot.status === "CANCELLED") {
          patchIfOwned(
            isVideo ? { clipStatus: "failed" } : { status: "failed" },
          );
          if (snapshot.error) {
            setNotice(
              `${isVideo ? "视频" : "镜头"}生成失败：${snapshot.error}`,
            );
          }
          return;
        }
        /* 仍在跑（RUNNING / QUEUED）：重订阅，等 live 的 done 帧回写。 */
        await generation.watchShotTask(shotId, taskId, target);
      })();
    };
    for (const shot of latestDraftRef.current.shots) {
      if (shot.status === "running" && shot.taskId) {
        resumeTask(shot.id, shot.taskId, "image");
      } else if (shot.clipStatus === "running" && shot.clipTaskId) {
        resumeTask(shot.id, shot.clipTaskId, "video");
      }
    }
    // 仅挂载执行一次；镜头列表经 ref 读取（惰性初始化在首渲染已完成）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const imageDoneCount = shots.filter((item) => !!item.imageUrl).length;
  const clipDoneCount = shots.filter((item) => !!item.clipUrl).length;
  const scriptReady = !!scriptMarkdown.trim() || scenes.length > 0;

  const viewContext: StageViewContext = React.useMemo(
    () => ({
      scriptReady,
      characterCount: characters.length,
      sceneCount: scenes.length,
      shotCount: shots.length,
      shotTarget,
      imageDoneCount,
      clipDoneCount,
    }),
    [
      scriptReady,
      characters.length,
      scenes.length,
      shots.length,
      shotTarget,
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
  const health = buildHealthSnapshot(stageRatios, viewContext);
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
  const showNotice = React.useCallback((message: string) => {
    setNotice(message);
  }, []);
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
    health,
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

    generating: generation.generating,
    shotProgress: generation.shotProgress,
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

    generateShot: generation.generateShot,
    cancelShotTask,
    openScriptEditor,
    closeScriptEditor,
    saveScriptEditor,
    openApiSettings,
    closeApiSettings,
    openModeContract,
    closeModeContract,
    handleApiChannelsSaved,
    dismissNotice,
    showNotice,
    markRendered,
    activeProjectId,
  };
}
