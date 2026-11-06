"use client";

/**
 * 设置页「远端模型管理」分区的 sub-hook（`use-settings-page` 的拆分件）。
 * 只做配置：本地候选勾选 + 远端条目增删改 / 测试连接，不区分「当前生效」（由工坊运行时定）；
 * 增删改即时落库，连通性走服务端代理（apiKey 不直接打远端），返回形状与主 hook 一致。
 */
import { useCallback, type Dispatch, type SetStateAction } from "react";

import { probeRemoteApi } from "~/lib/llm/browser";
import {
  queryUsageTask,
  testModelUsage,
  type UsageTaskQueryInput,
  type UsageTestInput,
} from "~/lib/llm/usage-test-client";
import { TASK_TYPES, type RemoteModelEntry, type TaskType } from "~/lib/llm/types";
/* 条目形状的唯一出处：controller 收的那一枚，就是 lib 里那座草稿→条目桥产出的那枚。 */
import type { RemoteModelDraftEntry } from "~/lib/llm/remote-model-schema";

import type { LlmConfig } from "./use-settings-page-types";

/** 设置页的 llm 草稿编辑口（主 hook 的 `setLlmDraft` 原样传入）。 */
type LlmDraftSetter = Dispatch<SetStateAction<LlmConfig | null>>;

/**
 * 合并候选模型：主模型 + 勾选的多选，按首次出现去重。
 * 主模型永远在列（本地 Ollama 当前生效模型）；查询结果相同时返回原引用，
 * 避免「主模型切换 → 勾选列表重算」引发受控组件输入抖动。
 */
function mergeExtraModels(current: Array<string>, model: string, toggled: string): Array<string> {
  const next = model.trim() === "" ? [...current] : [model, ...current.filter((m) => m !== model)];
  if (!toggled.trim()) {
    return next;
  }
  if (next.includes(toggled)) {
    // 取消勾选：主模型不可移除
    if (toggled === model) {
      return next;
    }
    return next.filter((m) => m !== toggled);
  }
  return [...next, toggled];
}

/** 只把「全部键都在白名单、值都是数字」的字典收窄成温度覆盖表。 */
function isTaskTemperatureRecord(v: Record<string, unknown>): v is Record<TaskType, number> {
  const entries = Object.entries(v);
  return (
    entries.length > 0 &&
    entries.every(([key, value]) => Object.hasOwn(TASK_TYPES, key) && typeof value === "number")
  );
}

export function useSettingsRemoteModels(input: {
  llmDraft: LlmConfig | null;
  patchLlm: (patch: Partial<LlmConfig>) => void;
  /** 增删改的即时落库出口（主 hook 的 `persistLlmDraft` 原样传入）。 */
  persistLlmDraft: (draft: LlmConfig) => Promise<{ error?: string; ok: boolean }>;
  setLlmDraft: LlmDraftSetter;
}) {
  const { llmDraft, setLlmDraft, patchLlm, persistLlmDraft } = input;

  /** 勾选/取消一个本地候选模型（多选集 = 主模型 + 勾选项）。
   *  option C：本地候选只存名字（字符串、无 apiKey），与远端独立模型(extraModels)
   *  彻底分开，不写进 remoteModel。 */
  const toggleExtraModel = useCallback(
    (name: string) => {
      setLlmDraft((draft) => {
        if (!draft) {
          return draft;
        }
        const nextNames = mergeExtraModels(draft.localCandidates, draft.model, name);
        const unchanged =
          nextNames.length === draft.localCandidates.length &&
          nextNames.every((n, i) => n === draft.localCandidates[i]);
        return unchanged ? draft : { ...draft, localCandidates: nextNames };
      });
    },
    [setLlmDraft],
  );

  /* ── 远端模型管理 ──
   * 设置页只做「配置」：条目的增删改 + 测试连接，不区分「当前生效」——
   * 实际用哪个模型由工坊运行时切换（configSave.model）。
   * 增删改即时落库（无需再点保存按钮），失败时提示条给出可读错误。
   * 连通性 / 实际调用测试走服务端代理（apiKey 不直接打远端）。 */
  const addRemoteModel = useCallback(
    async (entry: RemoteModelDraftEntry): Promise<{ error?: string; ok: boolean }> => {
      if (!llmDraft) {
        return { ok: false, error: "配置未就绪，请稍后重试" };
      }
      const name = entry.name.trim();
      if (!name) {
        return { ok: false, error: "请填写模型名称" };
      }
      if (llmDraft.extraModels.some((e) => e.name === name)) {
        return { ok: false, error: `模型「${name}」已在列表中` };
      }
      const trimmedBaseUrl = entry.baseUrl?.trim();
      const trimmedApiKey = entry.apiKey?.trim();
      const cleaned: RemoteModelEntry = {
        name,
        baseUrl: trimmedBaseUrl !== undefined && trimmedBaseUrl !== "" ? trimmedBaseUrl : null,
        apiKey: trimmedApiKey !== undefined && trimmedApiKey !== "" ? trimmedApiKey : null,
        kind: entry.kind ?? null,
      };
      const nextDraft = {
        ...llmDraft,
        extraModels: [...llmDraft.extraModels, cleaned],
      };
      setLlmDraft(nextDraft);
      return persistLlmDraft(nextDraft);
    },
    [llmDraft, persistLlmDraft, setLlmDraft],
  );

  const removeRemoteModel = useCallback(
    async (name: string): Promise<{ error?: string; ok: boolean }> => {
      if (!llmDraft) {
        return { ok: false, error: "配置未就绪，请稍后重试" };
      }
      const next = llmDraft.extraModels.filter((e) => e.name !== name);
      if (next.length === llmDraft.extraModels.length) {
        return { ok: true };
      }
      const nextDraft = { ...llmDraft, extraModels: next };
      setLlmDraft(nextDraft);
      return persistLlmDraft(nextDraft);
    },
    [llmDraft, persistLlmDraft, setLlmDraft],
  );

  /** 编辑既有条目（只作用于已配置条目）；改名时若当前生效模型引用的是旧名，
   *  同步改 draft.model —— 工坊按名字引用模型，不同步会指向不存在的名字。 */
  const updateRemoteModel = useCallback(
    async (
      name: string,
      patch: Partial<RemoteModelDraftEntry>,
    ): Promise<{ error?: string; ok: boolean }> => {
      if (!llmDraft) {
        return { ok: false, error: "配置未就绪，请稍后重试" };
      }
      const nextName = (patch.name ?? name).trim();
      if (!nextName) {
        return { ok: false, error: "请填写模型名称" };
      }
      const existing = llmDraft.extraModels.find((e) => e.name === name);
      if (!existing) {
        return { ok: false, error: `模型「${name}」不存在，请刷新后重试` };
      }
      if (nextName !== name && llmDraft.extraModels.some((e) => e.name === nextName)) {
        return { ok: false, error: `模型「${nextName}」已在列表中` };
      }
      const typedKey = patch.apiKey?.trim();
      const updated: RemoteModelEntry = {
        name: nextName,
        baseUrl: patch.baseUrl === undefined ? (existing.baseUrl ?? null) : patch.baseUrl,
        /* `apiKey` 三态（台账 A11 客户端这一半）：重填 → 新值；勾「清除密钥」→ `null`；
         * 未动 → 省略键。不能用 `existing?.apiKey ?? null`：existing 来自服务端脱敏清单
         * （永不带值），折成 null 后 replaceAll 会按覆盖语义清掉库里的密钥。 */
        ...(typedKey !== undefined && typedKey !== ""
          ? { apiKey: typedKey }
          : patch.clearApiKey === true
            ? { apiKey: null }
            : {}),
        kind: patch.kind === undefined ? (existing.kind ?? null) : patch.kind,
      };
      const nextDraft = {
        ...llmDraft,
        model: llmDraft.model === name ? nextName : llmDraft.model,
        extraModels: llmDraft.extraModels.map((e) => (e.name === name ? updated : e)),
      };
      setLlmDraft(nextDraft);
      return persistLlmDraft(nextDraft);
    },
    [llmDraft, persistLlmDraft, setLlmDraft],
  );

  const probeRemote = useCallback(
    async (input: { apiKey?: string; baseUrl?: string; model?: string }) => probeRemoteApi(input),
    [],
  );

  /** 模型「实际使用」测试（chat / 生图 / 生视频各一次真实调用）。
   *  网络封装在 lib/llm/usage-test-client，密钥解析在服务端完成。 */
  const testModelUsageFn = useCallback(async (input: UsageTestInput) => testModelUsage(input), []);

  /** 「继续等待」已提交的异步视频任务（同一条目连接参数 + taskId，只查不重交）。
   *  网络封装在 lib/llm/usage-test-client，密钥解析在服务端完成。 */
  const queryUsageTaskFn = useCallback(
    async (input: UsageTaskQueryInput) => queryUsageTask(input),
    [],
  );

  /** 远端候选模型列表（配置视图，按保存顺序）——设置页不区分「当前生效」，
   *  用哪个模型由工坊运行时切换。 */
  const remoteModelList: Array<RemoteModelEntry> = llmDraft?.extraModels ?? [];

  const setTaskTemperature = useCallback(
    (task: TaskType, raw: string) => {
      if (!llmDraft) {
        return;
      }
      const base = llmDraft.temperatureByTask ?? {};
      /* 清空输入框 = 删掉该 key（而不是写入 undefined），否则「已覆盖」徽标
       * 会一直亮着，且保存时会把 undefined 一并发给后端。 */
      const next =
        raw === ""
          ? Object.fromEntries(Object.entries(base).filter(([key]) => key !== task))
          : { ...base, [task]: Number(raw) };
      patchLlm({
        temperatureByTask: isTaskTemperatureRecord(next) ? next : undefined,
      });
    },
    [llmDraft, patchLlm],
  );

  return {
    toggleExtraModel,
    remoteModelList,
    addRemoteModel,
    updateRemoteModel,
    removeRemoteModel,
    probeRemote,
    testModelUsage: testModelUsageFn,
    queryUsageTask: queryUsageTaskFn,
    setTaskTemperature,
  };
}
