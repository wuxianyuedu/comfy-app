"use client";

// 工坊管线的全部业务逻辑：状态、草稿持久化、资源拉取、生图流程、派生进度。
// 视图层只消费这里返回的 controller，不持有任何业务规则。

import React from "react";
import { emitAppEvent } from "~/lib/app-events";
import { getActiveId } from "~/lib/project-canvas/canvas-store";

import type { ApiChannelsView } from "~/lib/workshop/api-channel-shared";
import { cancelLocalTask } from "~/lib/workshop/generation-client";
import { pushServerDraft } from "~/lib/workshop/draft-sync-client";
import { fetchProductionProgress, pushProduction } from "~/lib/production/production-client";
import { buildProductionPayload } from "~/lib/production/payload";
import { errorMessage } from "~/lib/error-message";
import { beginStaleRun } from "~/lib/stale-run";
import {
  useWorkshopBootstrapData,
  useWorkshopDraftRestore,
  useWorkshopTaskRecovery,
} from "./use-workshop-pipeline-effects";
import {
  DEFAULT_META,
  draftModelSelections,
  emptyWorkshopDraft,
  readWorkshopDraft as readDraft,
  writeWorkshopDraft as writeDraft,
  type WorkshopDraft,
  type WorkshopModelSelection,
  type WorkshopModelSelections,
} from "~/lib/workshop/draft-store";
import { auditDraftElements, type DraftElementIssue } from "~/lib/workshop/draft-integrity";
import { workflowIdFromCandidateValue } from "../model-test-config";
import type { Character, ProjectMeta, Scene, Shot, StyleRef } from "~/lib/workshop/types";
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
import { useWorkshopGeneration, type ShotProgressMap } from "./use-workshop-generation";
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

/** 页面加载期间只读一次 localStorage（多个 state 惰性初始化器共用）。
 *  工坊当前项目 = 画布活跃 proj_*（getActiveId）；Phase 1 闸门保证进入工坊时
 *  已有活跃项目，异常无活跃项目时返回 null，state 落默认值。 */
let workshopDraftCache: WorkshopDraft | null | undefined;
function loadWorkshopDraftOnce(): WorkshopDraft | null {
  /* invalidateDraftCache() 卸载时把缓存置 null 标记「需从 localStorage 重读」，
   * 这里须用 ??=（null / undefined 都重读），否则重挂载读回旧缓存 → 切页签丢内容。 */
  const pid = getActiveId();
  if (pid === null || pid === "") {
    return null;
  }
  workshopDraftCache ??= readDraft(pid);
  return workshopDraftCache;
}

/* 进度类型随生成逻辑一起住在 `use-workshop-generation`；这里再导出一次，
   保持主管线的对外类型面不变（消费方仍从本文件取）。 */
export type { ShotProgressMap };

/** 工坊「从剧本提取」/工具类会话的界面状态。
 *  提取是长耗时异步流程：切走页签只卸载 stage 组件、controller 常驻，故
 *  busy/progress/status/error/channel/执行日志统一收在 controller 层 ——
 *  提取中切页签再切回，进度与日志不丢。 */
export type ExtractSession = {
  busy: boolean;
  /** 模型下拉完整选项值（tool | local::<model> | remote::<model>） */
  channelValue: string;
  error: string;
  /** 结构化执行日志（输入/输出/结果/错误），跑完仍保留展示 */
  log: Array<ExtractLogEntry>;
  /** 模型通道的实时流式提取过程（token 累积） */
  progress: string;
  /** 成功 / 结果提示文案 */
  status: string;
};

/** 提取会话更新动作：patch 更新普通字段，appendLog / resetLog 维护日志。
 *  阶段组件卸载期间后台 async 仍可调用（controller 常驻），故能跨页签续传。 */
export type ExtractSessionActions = {
  /** 追加一条结构化执行日志 */
  appendLog: (entry: ExtractLogEntry) => void;
  /** 向实时 process 追加一段文本（流式 token 累积用） */
  appendProgress: (text: string) => void;
  /** 合并更新普通字段（通道 / busy / status / progress / error） */
  patch: (
    p:
      | Partial<Pick<ExtractSession, "channelValue" | "busy" | "status" | "progress" | "error">>
      | ((
          prev: ExtractSession,
        ) => Partial<
          Pick<ExtractSession, "channelValue" | "busy" | "status" | "progress" | "error">
        >),
  ) => void;
  /** 以给定数组整体替换执行日志（新一次提取重置时用） */
  setLog: (entries: Array<ExtractLogEntry>) => void;
};

export type WorkshopPipelineController = {
  /* ── 所在项目（Phase 2：并入统一 proj_*，工坊不再自建多项目） ── */
  activeProjectId: string;
  apiChannels: ApiChannelsView | null;
  /** 取消一个进行中的本机任务（生图 / 视频通用）：调 task.cancel 后由观察
   *  循环收到 CANCELLED 终态收尾。API 直连任务没有本机任务 id，取消不了。 */
  cancelShotTask: (shot: Shot, target: "image" | "video") => Promise<void>;
  // ── 提取会话（角色卡 / 分镜）：busy / progress / 日志 收归 controller ──
  characterExtract: ExtractSession;
  characterExtractActions: ExtractSessionActions;
  /** 角色定妆照：生成 / 导入的进度与日志（跨页签常驻） */
  characterPortrait: PortraitSession;
  characterPortraitActions: PortraitSessionActions;
  characters: Array<Character>;
  clipDoneCount: number;
  closeScriptEditor: () => void;
  dismissNotice: () => void;

  // ── 动作
  generateShot: (shot: Shot) => Promise<void>;
  // ── 交互态
  generating: boolean;
  /** 切到「成片」视图页签（广播 `workspace:navigate`，与 `openModelAdapters`
   *  同一条通道）：阶段⑥导出合成清单后，把用户送到真出 MP4 的成片工坊。
   *  成片工坊已能从活跃项目读镜头并一键成片（`createFromProject`），这条出口
   *  就是让阶段⑥不再「导个清单就当做完」（ISSUE #2476）。 */
  goToFilm: () => void;
  handleApiChannelsSaved: (channels: ApiChannelsView) => void;
  /** 六段的健康度快照（唯一一份进度账；「还差几段」由它派生）。 */
  health: Array<HealthRow>;
  imageDoneCount: number;
  /** 草稿里形状不认识但已原样保留的元素（台账 F13″）：视图据此标「需要修复」。 */
  integrity: Array<DraftElementIssue>;
  isScriptEditorOpen: boolean;
  markRendered: () => void;
  // ── 数据
  meta: ProjectMeta;
  missing: Array<MissingItem>;
  /** 各生成入口按「测试模型」级联选中的模型（#4834）。 */
  modelSelections: WorkshopModelSelections;
  /** 需要引起用户注意的失败/阻断文案（替代 alert，由视图决定怎么渲染）。 */
  notice: string | null;
  /** 「API 直连未配置 → 去配置」这类就近提示的出口：**切到全局的模型适配视图页签**
   *  （广播 `workspace:navigate`，与工坊右栏「在资源库中打开」同一条通道）。
   *  此前它是 `openApiSettings` + 一个 `apiSettingsOpen` 布尔 + 工坊内部一层弹窗 ——
   *  同一件事现在只有页签那一个落点。 */
  openModelAdapters: () => void;
  openScriptEditor: () => void;
  prereq: { go: Tab; text: string } | null;
  progressPct: number;
  rendered: boolean;
  saveScriptEditor: () => void;
  scenes: Array<Scene>;

  scriptMarkdown: string;
  setCharacters: React.Dispatch<React.SetStateAction<Array<Character>>>;
  setMeta: React.Dispatch<React.SetStateAction<ProjectMeta>>;
  /** 某个生成入口的模型选择（#4834：统一为测试模型级联的取值空间）。 */
  setModelSelection: (key: keyof WorkshopModelSelections, next: WorkshopModelSelection) => void;
  setScenes: React.Dispatch<React.SetStateAction<Array<Scene>>>;

  setScriptMarkdown: (value: string) => void;
  setShots: React.Dispatch<React.SetStateAction<Array<Shot>>>;
  setTab: (tab: Tab) => void;
  shotProgress: ShotProgressMap;
  shots: Array<Shot>;

  /** 写一条用户可见的提示（错误 / 门禁 / 未生效警告）：stage 组件内部的
   *  降级路径（如文件导入失败）经它上屏，不在视图里自建第二条提示通道。 */
  showNotice: (message: string) => void;
  stageDesc: string;
  stageIndex: number;
  stageRatios: StageRatios;
  stageTitle: string;
  storyboardExtract: ExtractSession;
  storyboardExtractActions: ExtractSessionActions;
  styles: Array<StyleRef>;
  // ── 阶段
  tab: Tab;
  /** 视频入口选定的本地工作流 id（从模型选择派生，空串 = 未选本地工作流）。
   *  兼容读数：Agent 一键成片等旧消费方仍认工作流 id。 */
  videoWorkflowId: string;
  viewContext: StageViewContext;
  /** 镜头生图入口选定的本地工作流 id（从模型选择派生，空串 = 未选本地工作流）。
   *  兼容读数：旧消费方仍认工作流 id。 */
  workflowId: string;
};

/** 结构化执行日志保留上限（P2：只追加不裁剪会随长流程无限增长）。 */
const EXTRACT_LOG_MAX_ENTRIES = 2000;

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
        | Partial<Pick<ExtractSession, "channelValue" | "busy" | "status" | "progress" | "error">>
        | ((
            prev: ExtractSession,
          ) => Partial<
            Pick<ExtractSession, "channelValue" | "busy" | "status" | "progress" | "error">
          >),
    ) => {
      setSession((prev) => ({
        ...prev,
        ...(typeof p === "function" ? p(prev) : p),
      }));
    },
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
      if (stage) {
        persistGenerationLogs(stage, [entry]);
      }
    },
    [stage],
  );
  const setLog = React.useCallback((entries: Array<ExtractLogEntry>) => {
    setSession((prev) => ({ ...prev, log: entries }));
  }, []);
  return [session, { patch, appendProgress, appendLog, setLog }];
}

/** 工坊管线的接管方式（ISSUE #4765）：
 *  - **自治**（不传任何项）：独立 /workshop 路由用 —— 阶段游标由工坊自己管理，
 *    挂载时按 production.progress 恢复「上次做到哪」。
 *  - **受控**（传 `controlledTab`）：项目页内嵌用 —— 六阶段已是项目页左侧列表的
 *    六个分区，游标由外层驱动；这里只负责把阶段变化上报回去，不再自行改游标
 *   （用户点明「剧本」却被恢复逻辑拽去「视频」是越权）。 */
export type UseWorkshopPipelineOptions = {
  controlledTab?: Tab;
  onControlledTabChange?: (tab: Tab) => void;
};

/** 阶段游标的接管（自治 / 受控双模，ISSUE #4765）：游标状态与「最新 setTab /
 *  接管方式」的 ref 镜像都收在这里 —— 主管线只消费；只跑一次的挂载回填 effect
 *  经 ref 读当次值，不把受控位拖进依赖数组。 */
function useWorkshopStageCursor(options: UseWorkshopPipelineOptions): {
  controlledTabRef: React.RefObject<Tab | undefined>;
  setTab: (next: Tab) => void;
  setTabRef: React.RefObject<(next: Tab) => void>;
  tab: Tab;
} {
  const { controlledTab, onControlledTabChange } = options;
  const [internalTab, setInternalTab] = React.useState<Tab>("script");
  /* 受控优先：外层给了游标就全听外层的；自治模式用内部状态。 */
  const tab = controlledTab ?? internalTab;
  const setTab = React.useCallback(
    (next: Tab) => {
      setInternalTab(next);
      onControlledTabChange?.(next);
    },
    [onControlledTabChange],
  );
  const setTabRef = React.useRef(setTab);
  const controlledTabRef = React.useRef(controlledTab);
  React.useEffect(() => {
    setTabRef.current = setTab;
    controlledTabRef.current = controlledTab;
  });
  return { controlledTabRef, setTab, setTabRef, tab };
}

export function useWorkshopPipeline(
  options: UseWorkshopPipelineOptions = {},
): WorkshopPipelineController {
  const { tab, setTab, setTabRef, controlledTabRef } = useWorkshopStageCursor(options);
  const [meta, setMeta] = React.useState<ProjectMeta>(
    () => loadWorkshopDraftOnce()?.meta ?? DEFAULT_META,
  );
  const [scenes, setScenes] = React.useState<Array<Scene>>(
    () => loadWorkshopDraftOnce()?.scenes ?? [],
  );
  const [characters, setCharacters] = React.useState<Array<Character>>(
    () => loadWorkshopDraftOnce()?.characters ?? [],
  );
  const [shots, setShots] = React.useState<Array<Shot>>(() => loadWorkshopDraftOnce()?.shots ?? []);
  const [styles, setStyles] = React.useState<Array<StyleRef>>([]);
  /* 各生成入口的模型选择（#4834）：统一为测试模型级联的取值空间，随草稿持久化。
   * 旧草稿只有 workflowId / videoWorkflowId ⇒ 经 draftModelSelections 映射成
   * `wf::<id>` 的本地模型选择，恢复不丢。 */
  const [modelSelections, setModelSelections] = React.useState<WorkshopModelSelections>(() =>
    draftModelSelections(loadWorkshopDraftOnce() ?? emptyWorkshopDraft()),
  );
  /* 旧读数兼容：本地工作流候选（`wf::<id>`）派生成工作流 id，供 Agent 一键成片
   * 等仍认工作流 id 的消费方无感使用；选中远端模型时为空串（走 API 直连通道）。 */
  const workflowId = React.useMemo(
    () => workflowIdFromCandidateValue(modelSelections.shot?.model ?? ""),
    [modelSelections],
  );
  const videoWorkflowId = React.useMemo(
    () => workflowIdFromCandidateValue(modelSelections.video?.model ?? ""),
    [modelSelections],
  );
  /* 镜头进度的节流闸门（见 `~/components/ui/use-throttled-progress`）。 */
  const [rendered, setRendered] = React.useState(false);
  const [apiChannels, setApiChannels] = React.useState<ApiChannelsView | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  // ── 提取会话收归 controller：切页签卸载只丢 stage 组件，此处常驻 ──
  const [characterExtract, characterExtractActions] = useExtractSession("local", "character");
  const [storyboardExtract, storyboardExtractActions] = useExtractSession("local", "storyboard");

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

  /** 当前全部可持久化内容（落盘、切换前保存都用它）。workflowId / videoWorkflowId
   *  是模型选择的派生兼容读数（本地工作流候选才非空），照旧落盘供旧读数。 */
  const currentDraft = React.useCallback(
    (): WorkshopDraft => ({
      meta,
      scriptMarkdown,
      scenes,
      characters,
      shots,
      workflowId,
      videoWorkflowId,
      modelSelections,
    }),
    [meta, scriptMarkdown, scenes, characters, shots, workflowId, videoWorkflowId, modelSelections],
  );

  /** 把一份草稿灌进所有受管 state（切换 / 删除项目后接手时调用）。 */
  const applyDraft = React.useCallback((draft: WorkshopDraft) => {
    setMeta(draft.meta);
    setScenes(draft.scenes);
    setCharacters(draft.characters);
    setShots(draft.shots);
    setModelSelections(draftModelSelections(draft));
    setScriptMarkdown(draft.scriptMarkdown);
  }, []);

  /* 最新项目 id / 草稿 / 阶段 / rendered 的 ref：供卸载兜底与异步服务端回填读取最新值（避免闭包捕获陈旧 state）。
   * `setTabRef` / `controlledTabRef` 同理：挂载回填那一条 effect 只跑一次，经 ref 读到当次的 setTab 与接管方式。 */
  const activeProjectRef = React.useRef(activeProjectId);
  const latestDraftRef = React.useRef<WorkshopDraft>(currentDraft());
  const tabRef = React.useRef(tab);
  const renderedRef = React.useRef(rendered);
  /* 服务端镜像对账是否已落定（#4023）：落定前不放行自动保存 / 卸载兜底的写穿，
   * 否则挂载即 PUT 会把本机较旧的 localStorage 草稿盖到服务端较新镜像上。 */
  const restoreSettledRef = React.useRef(false);
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
    /* 对账未落定不放行（#4023）：先等服务端比完「谁新」，再开始写穿。 */
    if (!restoreSettledRef.current) {
      return;
    }
    const timer = setTimeout(() => {
      const draft = currentDraft();
      /* 盖版本戳（#4023）：本地与服务端镜像各留一份写入时刻，恢复时取较新一侧、
       * 服务端 PUT 带 ifNewer 拒绝更旧的迟到写。 */
      const stamped: WorkshopDraft = { ...draft, updatedAt: Date.now() };
      // localStorage 为即时缓存；同时写穿一份到本地 db.sqlite（防缓存被清丢失）。
      writeDraft(activeProjectId, stamped);
      void pushServerDraft(activeProjectId, stamped);
      // Phase 3b-2：额外写穿一份「生产数据」到 production 表，供画布读取物化（3c）。
      void pushProduction(activeProjectId, buildProductionPayload(stamped, tab, rendered));
    }, 600);
    return () => {
      clearTimeout(timer);
    };
  }, [activeProjectId, currentDraft, tab, rendered]);

  /* 卸载兜底保存：只靠 600ms 防抖，编辑后立刻切页签时定时器被 clear 来不及落盘；
   * 且模块级草稿缓存只在首次挂载读一次，重挂载会读到旧缓存 —— 两处叠加正是
   *「切页签后剧本内容丢失」的根因。卸载时立即落盘 + 让缓存失效；cleanup 经 ref
   * 取最新值，避免闭包捕获旧草稿。服务端写穿（pushServerDraft / pushProduction）
   * 在对账未落定时不发（#4023）：此时本地尚未与服务端比过新旧，迟到 PUT 会把
   * 本机旧值盖过服务端较新镜像；本地 localStorage **照常落盘**（即时缓存，
   * 内容未变时与存量相同，不会丢）。 */
  React.useEffect(() => {
    return () => {
      const draft = latestDraftRef.current;
      writeDraft(activeProjectRef.current, draft);
      if (!restoreSettledRef.current) {
        invalidateDraftCache();
        return;
      }
      const stamped: WorkshopDraft = { ...draft, updatedAt: Date.now() };
      void pushServerDraft(activeProjectRef.current, stamped);
      void pushProduction(
        activeProjectRef.current,
        buildProductionPayload(stamped, tabRef.current, renderedRef.current),
      );
      invalidateDraftCache();
    };
    // 仅在卸载时执行一次
  }, []);

  /* 挂载回填的对账（#4023）沉在 `./use-workshop-pipeline-effects` 的
   * `useWorkshopDraftRestore`：本地为空、或服务端镜像比本地**新**（版本对账）时
   * 采用服务端内容；对账落定前不放行自动保存 / 卸载兜底的服务端写穿。 */
  useWorkshopDraftRestore({
    activeProjectRef,
    latestDraftRef,
    onAdopt: (draft) => {
      writeDraft(activeProjectRef.current, draft);
      applyDraft(draft);
      // 让模块级草稿缓存也指向恢复后的内容，避免再次重挂载读到旧空草稿。
      workshopDraftCache = draft;
    },
    onSettled: () => {
      restoreSettledRef.current = true;
    },
  });

  /* Phase 4（设计 §7）：完成状态以 production 表的 progress 为单一持久来源。
   * 挂载时从持久化 progress 恢复 rendered —— 修「rendered 只在 React state、刷新即丢」；
   * 并在用户尚未导航（tab 仍是默认 script）时一并恢复阶段游标。服务端 progress 是本组件
   * 自己 push 上去的权威值，恢复不会覆盖进内容编辑；作废守卫用 beginStaleRun（规范 16 §16.2.4.34），
   * 卸载即 dispose、结论不落地。 */
  React.useEffect(() => {
    const activeId = activeProjectRef.current;
    if (!activeId) {
      return;
    }
    const guard = beginStaleRun();
    void (async () => {
      const progress = await fetchProductionProgress(activeId);
      if (!progress) {
        return;
      }
      guard.commit(() => {
        setRendered(progress.rendered);
        /* 游标恢复只属于自治模式：受控模式（项目页左列表）里用户点的是哪段
         * 就停在哪段，不由持久化进度把界面拽去别处（ISSUE #4765）。 */
        if (controlledTabRef.current === undefined && tabRef.current === "script") {
          setTabRef.current(progress.stage);
        }
      });
    })();
    return () => {
      guard.dispose();
    };
    /* 两个 ref 恒稳（镜像在 useWorkshopStageCursor 里逐帧更新），列进来只为
     * 过 exhaustive-deps：effect 仍只在挂载时跑一次。 */
  }, [controlledTabRef, setTabRef]);

  /* 首挂载三路拉取（技能列表 / API 通道 / 工作流库清单）——沉在
   * `./use-workshop-pipeline-effects` 的 `useWorkshopBootstrapData`。 */
  useWorkshopBootstrapData({ setStyles, setApiChannels });

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
  const shotTarget = scenes.reduce((sum, scene) => sum + Math.max(1, scene.shotCount), 0);

  /** 取消一个进行中的本机任务（生图 / 视频通用）。真正把界面收尾的是观察
   *  循环：task.cancel 把任务置 CANCELLED，SSE 的终态帧随后落定 —— 状态回
   *  failed、提示「已取消，可重新生成」。这里只负责发起取消并把失败原因
   *  说清（任务可能恰好已结束）。 */
  const cancelShotTask = React.useCallback(async (shot: Shot, target: "image" | "video") => {
    const taskId = target === "video" ? shot.clipTaskId : shot.taskId;
    if (taskId === undefined || taskId === "") {
      setNotice("该任务无法取消（非本机任务，或已经结束）");
      return;
    }
    try {
      await cancelLocalTask(taskId);
      setNotice("已发送取消请求，正在等待任务停止…");
    } catch (error: unknown) {
      setNotice(errorMessage(error, "取消失败（任务可能已经结束）"));
    }
  }, []);

  /* 恢复失联任务（刷新 / 切走页签后重挂载）——沉在
   * `./use-workshop-pipeline-effects` 的 `useWorkshopTaskRecovery`：查 task 表
   * 真值决定「直接回写产物 / 重订阅等终态 / 如实按失败收尾」。 */
  useWorkshopTaskRecovery({
    latestDraftRef,
    setShots,
    setNotice,
    watchShotTask: generation.watchShotTask,
  });

  const imageDoneCount = shots.filter(
    (item) => item.imageUrl !== undefined && item.imageUrl !== "",
  ).length;
  const clipDoneCount = shots.filter(
    (item) => item.clipUrl !== undefined && item.clipUrl !== "",
  ).length;
  const scriptReady = !!scriptMarkdown.trim() || scenes.length > 0;

  /* 草稿里「形状不认识但仍要留着」的那些元素（台账 F13″）。
   * 结论是**读时派生**的：`workshopDraft` 表一列一字段，DTO 上加个标记字段没有落库的家
   * （写进去就在下一次读时消失），而派生还顺带保证了「数据修好了标记就没了」不会失配。
   * 判据本体在 `~/lib/workshop/draft-integrity`（服务端镜像与本地缓存两扇门共用一份）。 */
  const integrity = React.useMemo(
    () => auditDraftElements({ scenes, characters, shots }),
    [scenes, characters, shots],
  );

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

  const missing = React.useMemo(() => buildMissingSummary(viewContext), [viewContext]);

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

  /* 切到全局的「模型适配」视图页签。走 `workspace:navigate` 这条已收口的广播
     （与 `WorkshopAside` 的「在资源库中打开」同一条、同一份载荷类型），不在这里
     穿两层 props 去够 workspace 的 `navigateTo`。 */
  const openModelAdapters = React.useCallback(() => {
    emitAppEvent("workspace:navigate", { view: "model-adapters" });
  }, []);

  /* 阶段⑥「去成片合成 MP4」出口：复用上一条广播，view 换成 "film"。 */
  const goToFilm = React.useCallback(() => {
    emitAppEvent("workspace:navigate", { view: "film" });
  }, []);

  const handleApiChannelsSaved = React.useCallback((channels: ApiChannelsView) => {
    setApiChannels(channels);
  }, []);

  const dismissNotice = React.useCallback(() => {
    setNotice(null);
  }, []);
  const showNotice = React.useCallback((message: string) => {
    setNotice(message);
  }, []);
  const markRendered = React.useCallback(() => {
    setRendered(true);
  }, []);

  /** 某个生成入口的模型选择（#4834）：统一走测试模型级联的取值空间。 */
  const setModelSelection = React.useCallback(
    (key: keyof WorkshopModelSelections, next: WorkshopModelSelection) => {
      setModelSelections((prev) => ({ ...prev, [key]: next }));
    },
    [],
  );

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
    modelSelections,
    setModelSelection,
    workflowId,
    videoWorkflowId,
    apiChannels,
    imageDoneCount,
    clipDoneCount,
    rendered,

    generating: generation.generating,
    shotProgress: generation.shotProgress,
    isScriptEditorOpen,
    notice,
    integrity,

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
    openModelAdapters,
    handleApiChannelsSaved,
    dismissNotice,
    showNotice,
    markRendered,
    goToFilm,
    activeProjectId,
  };
}
