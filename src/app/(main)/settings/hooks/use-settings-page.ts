"use client";

/**
 * 设置页业务逻辑层（规范 17 §17.2 第②层）：LLM/偏好草稿播种+编辑、Ollama 探测启动、
 * ComfyUI 启动与状态刷新、保存与提示条。视图只消费返回的 controller，不碰 tRPC/fetch。
 */

import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { useFlashLatch } from "~/components/ui/use-flash-state";
import { useExternalAction } from "~/components/ui/use-external-action";

/* 默认端口从 `~/lib/endpoints` 取（零依赖常量层）：它同时被设置页视图消费，
 * 而 `app-settings.ts` 顶层 import fs —— 走那条路会让设置页整页 500（ISSUE #282/#317）。 */
import { COMFYUI_DEFAULT_PORT } from "~/lib/endpoints";
import { splitExtraModels } from "~/lib/llm/types";
import { useTRPC } from "~/trpc/react";

import { useSettingsComfy } from "./use-settings-page-comfy";
import { useSettingsSave } from "./use-settings-page-save";
import { useSettingsLoadStatus } from "./use-settings-page-load-status";
import { useSettingsRemoteModels } from "./use-settings-page-remote-models";
import { useSettingsAppUpdate } from "./use-settings-page-app-update";
import { useSettingsBackup } from "./use-settings-page-backup";
import { useSettingsDbStudio } from "./use-settings-page-db-studio";
import { useSettingsOllama } from "./use-settings-page-ollama";

/* 类型与共享叶子（`use-settings-page-types`）拆到独立文件,消费者 `from
 * "./use-settings-page"` 的路径**完全不变**（§12.18 复用优先）。 */
import type {
  FlashMessage,
  LlmConfig,
  QueryLlmConfig,
  Section,
  Settings,
  SettingsPageController,
} from "./use-settings-page-types";
/* 分区白名单是**值**（不是类型），`export *` 不会把它带进本文件作用域，
 * 跳转落点的收敛要用到它，所以单独再值导入一条。 */
import { SETTINGS_SECTIONS } from "./use-settings-page-types";

export * from "./use-settings-page-types";

/** 提示条停留时长。 */
const FLASH_MS = 3500;

/* 「没有提示」的空载荷：模块级常量，身份稳定（`useFlashLatch` 的依赖）。 */
const NO_FLASH: FlashMessage | null = null;

/* 配置读取的兜底缓存（ISSUE #360）：两份读（`setting.get` / `llm.configGet`）是服务端
 * 最脆弱的两跳，重启/编译/迁移的几秒里查询会失败。兜底值 = 最后一次成功读到的配置
 * （会话内 `lastGood` + sessionStorage 快照 `readSettingsCache`）。只放配置不放密钥类
 * 输入态；写失败（隐私模式/配额）静默忽略。 */
const SETTINGS_CACHE_KEY = "settingsPage.lastGoodConfig.v1";

function readSettingsCache(): { llm?: QueryLlmConfig; settings?: Settings } {
  try {
    const raw = sessionStorage.getItem(SETTINGS_CACHE_KEY);
    if (raw === null || raw === "") {
      return {};
    }
    /* SAFETY: 类型断言已复核 */
    const parsed = JSON.parse(raw) as {
      llm?: QueryLlmConfig;
      settings?: Settings;
    };
    return Boolean(parsed) && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeSettingsCache(value: { llm?: QueryLlmConfig; settings?: Settings }): void {
  try {
    sessionStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(value));
  } catch {
    /* 隐私模式 / 配额超限：放弃持久化，兜底退化为「仅本次会话有效」 */
  }
}

/** 目标分区（来自跳转载荷）的合法性收敛：不在白名单里就当作没给。 */
function readInitialSection(raw: string | null | undefined): Section | null {
  /* SAFETY: 类型断言已复核 */
  return SETTINGS_SECTIONS.some((item) => item.id === raw) ? (raw as Section) : null;
}

/** 设置页全部状态与动作 —— 见文件头注释的分层说明。 */
export function useSettingsPage(options?: {
  /** 跳转要求直接停驻的分区 id（一次性载荷，来自 `workspace:navigate`）。 */
  initialSection?: string | null;
  /** 目标分区落定后的回调：容器据此清空一次性载荷，避免下次进设置还落在它上面。 */
  onConsumeInitialSection?: () => void;
}): SettingsPageController {
  const { initialSection, onConsumeInitialSection } = options ?? {};
  const trpc = useTRPC();
  const [section, setSection] = useState<Section>(
    () => readInitialSection(initialSection) ?? "llmLocal",
  );
  /* 尚未落定的跳转目标，与 `section`（导航高亮）分开：落点要等外壳真的滚过去才算
   * 完成（加载/失败壳没有分区节，滚不动）。刻意不在挂载时消费载荷——首帧还在 loading
   * 时清掉会丢目标——留到外壳命中锚点后调 `ackJumpSection` 为止。 */
  const [pendingJump, setPendingJump] = useState<Section | null>(() =>
    readInitialSection(initialSection),
  );
  useEffect(() => {
    const requested = readInitialSection(initialSection);
    if (!requested) {
      return;
    }
    /* 设置是**瞬时页签**（切走即退场），通常挂载时的初值就够。这一条 effect 只
     * 覆盖「设置已挂载时又跳进来一次」：登记待落定的目标，仍不在这里消费。 */
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPendingJump(requested);
    setSection(requested);
  }, [initialSection]);
  /** 外壳把跳转目标真的滚过去之后调它：清空待落定目标 + 回调容器清载荷。 */
  const ackJumpSection = useCallback(() => {
    setPendingJump(null);
    onConsumeInitialSection?.();
  }, [onConsumeInitialSection]);
  const { theme, setTheme } = useTheme();
  const [saving, setSaving] = useState(false);

  /* 应用自更新：检测 / 下载安装 / 重启的三个动作与其全部暂态沉在
   * `./use-settings-page-app-update` sub-hook 里；主 hook 只调一次、把
   * 返回值直接接进 controller 的 `appUpdate / checkAppUpdate /
   * installAppUpdate / relaunchApp` 四个字段。 */
  const { appUpdate, checkAppUpdate, installAppUpdate, relaunchApp } = useSettingsAppUpdate();

  const [llmApiKey, setLlmApiKey] = useState("");
  const [llmDraft, setLlmDraft] = useState<LlmConfig | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<Settings | null>(null);
  const settingsQ = useQuery(trpc.setting.get.queryOptions());
  const llmQ = useQuery(trpc.llm.configGet.queryOptions());
  /* 两份查询的「最后一次成功结果」，读取失败时兜底播种草稿（ISSUE #360）：避免把
   * 「一次刷新失败」当成「整页不可用」。只在真的有过成功结果时生效——首次启动就失败
   * 仍走全页降级。 */
  /* 缓存的是服务端下发的形状（`extraModels` 是字符串|对象混合清单，播种时再拆成草稿的
   * `LlmConfig`）。用 state 而非 ref：播种与失败兜底都在渲染期读它，React 19
   * `react-hooks/refs` 禁止渲染期读写 ref；state 首值取自 sessionStorage。 */
  const [lastGood, setLastGood] = useState<{
    llm?: QueryLlmConfig;
    settings?: Settings;
  }>(() => (typeof globalThis === "undefined" ? {} : readSettingsCache()));
  const saveSetting = useMutation(trpc.setting.save.mutationOptions());
  const saveLlmCfg = useMutation(trpc.llm.configSave.mutationOptions());
  /* ComfyUI / Drizzle Studio 状态探测延后到首屏两份配置就绪后再发：
   * comfyStatus 在 ComfyUI 未运行时要对连续端口段做超时探测（秒级），
   * 同挂载触发会被 httpBatchLink 并进首屏同一批请求，而批量响应不分块
   * 流式返回 —— 首屏只需要的 get/configGet 会被迫等整批结束，页面
   * 多停在加载态数秒。 */
  const statusQueriesEnabled = !!settingsQ.data && !!llmQ.data;
  /* 轮询间隔：默认 5s（外部/命令行启动的 ComfyUI 能被及时认出来）；窗口聚焦
   * 时隔更短，让「切回设置页」几乎立刻看到真实状态（ISSUE #339 的「打开界面
   * 要等一会才显示在运行」）。服务端有进程级快照 + HTTP 探测兜底，间隔收紧
   * 不会把压力转成卡顿。 */
  /* 安装形态：**不 gate 在 statusQueriesEnabled 上**，与首屏的 get/configGet 同批
   * 发出 —— 它是 fs-only 的毫秒级判据，跟着 comfyStatus 一起等秒级探测就白拆了。
   * 改路径 / 启动参数后由 savePrefs、startComfy 手动 refetch（形态依赖路径）。 */
  /* ComfyUI 的状态查询 / 启动关闭打开动作 / 运行时日志整体沉在
   * `./use-settings-page-comfy`（与 ollama / db-studio 同族的 sub-hook）。 */
  const openExternalM = useMutation(trpc.setting.openExternal.mutationOptions());

  /* 设置页的整页提示条：亮起 3.5s 自动收起。定时器管理（连点清旧、
   * 卸载清掉）由 `useFlashLatch` 收口 —— 此前这里是手写的 `flashTimerRef`，
   * 与全库另一处（`logs/SaveExportButton`）逐行同款、各写一份。 */
  const flashLatch = useFlashLatch(FLASH_MS, NO_FLASH);
  const showFlash = useCallback(
    (kind: "ok" | "err", text: string) => {
      flashLatch.flash({ kind, text });
    },
    [flashLatch],
  );

  /* ── 从查询结果播种草稿 ─────────────────────────────────────
   * 「渲染期对比上一次引用 → setState」是 React 官方推荐的 derived-state 写法，
   * 比 useEffect 少一次多余渲染，也不会闪旧值。 */
  const llmConfig = llmQ.data?.config ?? null;
  /* 每次拿到成功结果就更新缓存（供下次打开/下次失败时兜底）。与下面的播种同属
   * 「从查询结果派生草稿」的一步（渲染期对比上一次引用 → setState 是 React 官方
   * 推荐的 derived-state 写法，比 useEffect 少一次多余渲染）。 */
  if (llmConfig && lastGood.llm !== llmConfig) {
    setLastGood((prev) => ({ ...prev, llm: llmConfig }));
  }
  const [prevLlmConfig, setPrevLlmConfig] = useState(llmConfig);
  /* 播种条件：数据引用变化（保存后 refetch 回写）时重新播种；或数据已就绪
   * 而草稿仍为空（含首次挂载即命中 tRPC 缓存的场景）时播种。若只用引用对比，
   * 关闭再打开时 prev 初值被缓存命中，分支永不触发，草稿一直为空，页面
   * 会落到「配置数据未就绪」。 */
  const llmChanged = llmConfig !== prevLlmConfig;
  if (llmChanged) {
    setPrevLlmConfig(llmConfig);
  }
  if (llmConfig && (llmChanged || !llmDraft)) {
    const split = splitExtraModels(llmConfig.extraModels);
    setLlmDraft({
      ...llmConfig,
      apiKey: null,
      /* 本地候选（字符串）与远端独立模型（对象）从同一下发清单里拆开存，互不混写 */
      localCandidates: split.localNames.filter((n) => n !== llmConfig.model),
      extraModels: split.remoteEntries.filter((e) => e.name !== llmConfig.model),
      temperatureByTask: llmConfig.temperatureByTask ?? undefined,
    });
  }
  const settingsData = settingsQ.data?.settings ?? null;
  if (settingsData && lastGood.settings !== settingsData) {
    setLastGood((prev) => ({ ...prev, settings: settingsData }));
  }
  const [prevSettingsData, setPrevSettingsData] = useState(settingsData);
  /* 同 llm 播种：缓存命中 / refetch 两种情形都要能落到草稿，避免落到降级 UI。 */
  const settingsChanged = settingsData !== prevSettingsData;
  if (settingsChanged) {
    setPrevSettingsData(settingsData);
  }
  if (settingsData && (settingsChanged || !settingsDraft)) {
    setSettingsDraft(settingsData);
  }

  /* 读取失败时的兜底播种（ISSUE #360）：查询真的失败（不是还在加载）且草稿为空时，
   * 用 lastGood 播回草稿，失败原因经 `serveState` 以非阻塞提示条呈现。加载中（首帧）
   * 不播种，避免先闪旧值。 */
  if (llmDraft === null && llmQ.isError && lastGood.llm) {
    const cached = lastGood.llm;
    const split = splitExtraModels(cached.extraModels);
    setLlmDraft({
      ...cached,
      apiKey: cached.apiKey ?? null,
      localCandidates: split.localNames.filter((n) => n !== cached.model),
      extraModels: split.remoteEntries.filter((e) => e.name !== cached.model),
      temperatureByTask: cached.temperatureByTask ?? undefined,
    });
  }
  if (settingsDraft === null && settingsQ.isError && lastGood.settings) {
    setSettingsDraft(lastGood.settings);
  }
  /* 快照写回 sessionStorage：跨整页刷新（dev server 重启会让页面重新加载）后
   * 仍能兜底。只在确有内容时写，避免把空对象盖掉上一份有效快照。
   * 写外部存储是**副作用**，必须留在 effect 里（P2 渲染期副作用）：放在渲染体
   * 会让每次 render 都写一遍，StrictMode 双渲染下重复写。 */
  useEffect(() => {
    if (lastGood.llm ?? lastGood.settings) {
      writeSettingsCache(lastGood);
    }
  }, [lastGood]);

  /* ── Ollama 探测 / 拉起 / 关闭 / 运行时日志（沉在 sub-hook）────────
   * baseUrl 与 provider 从 llmDraft 里取出传入；sub-hook 不碰草稿的编辑与
   * 持久化——那是主 hook 的边界。status / models / starting / stopping / log
   * 与两个动作（startOllama / stopOllama）逐字段展开到 controller。 */
  const llmBaseUrl = llmDraft?.baseUrl ?? "";
  const {
    ollamaStatus,
    ollamaModels,
    ollamaStarting,
    ollamaStopping,
    ollamaLog,
    startOllama,
    stopOllama,
  } = useSettingsOllama({
    llmBaseUrl,
    providerIsLocal: llmDraft?.provider === "local",
    showFlash,
  });

  /* ── ComfyUI 配置侧的两份只读派生（沉在 sub-hook）────────────────
   * 自 ISSUE #1900 起这一分区**只剩配置**：安装形态（路径配没配、桌面版还是
   * 便携版）与桌面实例的六个存储目录。运行态、启动 / 关闭 / 打开与启动日志
   * 整块搬去了侧栏「ComfyUI」页（`~/components/studio/comfyui`）——两件事各有
   * 自己的屏之后，改路径的人不必等秒级探测、看日志的人不必滚过一屏输入框。 */
  const { comfyInstance, comfyStorage, refetchComfyInstance, refetchComfyStorage } =
    useSettingsComfy({ statusQueriesEnabled });

  /* ── Drizzle Studio：状态查询 + 启动 / 关闭 / 打开 + 运行时日志 ──
   * 状态与动作沉在 sub-hook；enabled 门控与 comfyStatus 同口径（首屏两份配置
   * 就绪前不发探测）。返回形状逐字段展开到 controller。 */
  const {
    dbStudioStatus,
    dbStudioStarting,
    dbStudioStopping,
    dbStudioOpening,
    dbStudioLog,
    startDbStudio,
    stopDbStudio,
    openDbStudio,
  } = useSettingsDbStudio({ statusQueriesEnabled, showFlash });

  /* ── 数据库备份 / 恢复（D6）：清单 + 手动备份 + 登记恢复 ──
   * 与 Drizzle Studio 同一门控；「恢复」是两步（写标记 → 下次启动换文件），
   * 所以产出里有一个 `pending` 供视图说清「重启后生效」。 */
  const {
    backups,
    pending: pendingRestore,
    loading: backupListLoading,
    backupBusy,
    restoreBusy,
    createBackupNow,
    restoreFrom,
  } = useSettingsBackup({ statusQueriesEnabled, showFlash });

  /** 用系统默认浏览器打开生成的远程资源（视频 / 公网图片等）。
   *  桌面壳内 target=_blank 外链打不开，统一走服务端 openExternal。 */
  const openExternalAction = useExternalAction({
    target: "browser",
    report: showFlash,
  });
  const openExternalUrl = useCallback(
    async (url: string) => {
      await openExternalAction.runWithTarget(url, (target) =>
        openExternalM.mutateAsync({ url: target }),
      );
    },
    [openExternalAction, openExternalM],
  );

  /* ── 保存（沉在 sub-hook）──────────────────────────────────
   * LLM 落库（含远程模型的即时保存出口）、偏好落库，以及落库后连带重取的
   * 实例元数据（安装形态 + 桌面实例的六个存储目录）。注入的是两份草稿、保存
   * 指示器与反馈通道 —— 与 ComfyUI / DbStudio 的运行态无共享 state。 */
  const { persistLlmDraft, saveLlm, savePrefs } = useSettingsSave({
    settingsDraft,
    llmDraft,
    llmApiKey,
    setSaving,
    setLlmApiKey,
    showFlash,
    saveSettingM: saveSetting,
    settingsQ,
    saveLlmCfgM: saveLlmCfg,
    llmQ,
    refetchComfyInstance,
    refetchComfyStorage,
  });

  /* ── 按任务温度 ─────────────────────────────────────────── */
  const patchLlm = useCallback((patch: Partial<LlmConfig>) => {
    setLlmDraft((draft) => (draft ? { ...draft, ...patch } : draft));
  }, []);

  const patchSettings = useCallback((patch: Partial<Settings>) => {
    setSettingsDraft((draft) => (draft ? { ...draft, ...patch } : draft));
  }, []);

  /* ── 远端模型管理 / 本地候选勾选 / 按任务温度（沉在 sub-hook）──────
   * 这一块只依赖「当前 llm 草稿 + 草稿编辑 + 即时落库出口」，与 ComfyUI /
   * DbStudio / Ollama 无任何共享 state。返回形状与原 controller 逐字段一致。 */
  const {
    toggleExtraModel,
    remoteModelList,
    addRemoteModel,
    updateRemoteModel,
    removeRemoteModel,
    probeRemote,
    testModelUsage: testModelUsageFn,
    queryUsageTask: queryUsageTaskFn,
    setTaskTemperature,
  } = useSettingsRemoteModels({
    llmDraft,
    setLlmDraft,
    patchLlm,
    persistLlmDraft,
  });

  /* 加载失败判定与补记日志（沉在 sub-hook；说明见其文件头）。 */
  const { queryFailed, isInitialLoad, errorText } = useSettingsLoadStatus();

  const retry = useCallback(() => {
    void settingsQ.refetch();
    void llmQ.refetch();
  }, [settingsQ, llmQ]);

  /* 两份草稿齐了才算「可渲染表单」；只有一份时仍走错误/加载态，避免
   * 半份草稿导致视图里到处判空。 */
  const drafts = llmDraft && settingsDraft ? { llm: llmDraft, settings: settingsDraft } : null;

  return {
    /* ComfyUI 默认端口（未配置端口时的兜底）。视图的 placeholder 与说明文案
     * 直接用它，避免把 8188 在文案里再写一遍（规范 §12.14：默认端口单点定义）。 */
    comfyDefaultPort: COMFYUI_DEFAULT_PORT,
    section,
    setSection,
    pendingJump,
    ackJumpSection,
    theme: theme === "light" ? "light" : "dark",
    setTheme: (value: "light" | "dark") => {
      setTheme(value);
    },
    isInitialLoad: isInitialLoad && !queryFailed && !settingsQ.data && !llmQ.data,
    hasError: queryFailed && !drafts,
    /* 既没在加载、也没失败，草稿却仍为空——正常状态机不可达。视图据此给
     * 可操作出口（重试 + 日志面板），不再渲染冻住用户的死胡同文案。 */
    notReady: !drafts && !queryFailed && !isInitialLoad,
    errorText,
    retry,
    /* 有草稿可用时，失败不再等价于「打不开」：界面照常渲染，只把原因放在一条
     * 非阻塞提示里。用户真正被冻住的场景（草稿也没有）仍走 hasError 全页降级。 */
    serveState: queryFailed && drafts ? { errorText } : null,
    drafts,
    patchLlm,
    patchSettings,
    toggleExtraModel,
    remoteModelList,
    addRemoteModel,
    updateRemoteModel,
    removeRemoteModel,
    probeRemote,
    testModelUsage: testModelUsageFn,
    queryUsageTask: queryUsageTaskFn,
    llmApiKey,
    setLlmApiKey,
    ollamaStatus,
    ollamaModels,
    ollamaStarting,
    startOllama,
    comfyInstance,
    comfyStorage,
    dbStudioStatus,
    dbStudioStarting,
    dbStudioStopping,
    dbStudioOpening,
    startDbStudio,
    stopDbStudio,
    openDbStudio,
    backups,
    pendingRestore,
    backupListLoading,
    backupBusy,
    restoreBusy,
    createBackupNow,
    restoreFrom,
    openExternalUrl,
    dbStudioLog,
    ollamaLog,
    ollamaStopping,
    stopOllama,
    saving,
    saveLlm,
    savePrefs,
    flash: flashLatch.value,
    dismissFlash: flashLatch.reset,
    setTaskTemperature,
    appUpdate,
    checkAppUpdate,
    installAppUpdate,
    relaunchApp,
  };
}

/** 侧边栏分区 —— 纯配置，视图直接消费。本地 / 远程模型各自独立成页。 */
