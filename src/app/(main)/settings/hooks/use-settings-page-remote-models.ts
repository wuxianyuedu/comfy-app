"use client";

/**
 * 设置页「远端模型管理」分区的 sub-hook（`use-settings-page` 的拆分件）。
 *
 * 设置页只做「配置」：本地候选的勾选、远端条目的增删改 + 测试连接，不区分
 * 「当前生效」——实际用哪个模型由工坊运行时切换（configSave.model）。
 * 增删改即时落库（无需再点保存按钮，经注入的 `persistLlmDraft`），失败时
 * 提示条给出可读错误；连通性 / 实际调用测试走服务端代理（apiKey 不直接打远端）。
 *
 * 拆分动机：主 hook 870+ 行；这一块只依赖「当前 llm 草稿 + 草稿编辑 +
 * 持久化」三样（经参数注入），与 ComfyUI / DbStudio / Ollama 无任何共享
 * state，是天然的可拆单元。返回形状与主 hook 原 controller 逐字段一致，
 * 视图与测试都不感知——§12.18 复用优先。
 */
import { useCallback, type Dispatch, type SetStateAction } from "react";

import { probeRemoteApi } from "~/lib/llm/browser";
import {
  queryUsageTask,
  testModelUsage,
  type UsageTaskQueryInput,
  type UsageTestInput,
} from "~/lib/llm/usage-test-client";
import {
  type RemoteModelEntry,
  type RemoteModelKind,
  type TaskType,
} from "~/lib/llm/types";

import type { LlmConfig } from "./use-settings-page-types";

/** 设置页的 llm 草稿编辑口（主 hook 的 `setLlmDraft` 原样传入）。 */
type LlmDraftSetter = Dispatch<SetStateAction<LlmConfig | null>>;

/**
 * 合并候选模型：主模型 + 勾选的多选，按首次出现去重。
 * 主模型永远在列（本地 Ollama 当前生效模型）；查询结果相同时返回原引用，
 * 避免「主模型切换 → 勾选列表重算」引发受控组件输入抖动。
 */
function mergeExtraModels(
  current: string[],
  model: string,
  toggled: string,
): string[] {
  const next =
    model.trim() !== ""
      ? [model, ...current.filter((m) => m !== model)]
      : [...current];
  if (!toggled.trim()) return next;
  if (next.includes(toggled)) {
    // 取消勾选：主模型不可移除
    if (toggled === model) return next;
    return next.filter((m) => m !== toggled);
  }
  return [...next, toggled];
}

export function useSettingsRemoteModels(input: {
  llmDraft: LlmConfig | null;
  setLlmDraft: LlmDraftSetter;
  patchLlm: (patch: Partial<LlmConfig>) => void;
  /** 增删改的即时落库出口（主 hook 的 `persistLlmDraft` 原样传入）。 */
  persistLlmDraft: (
    draft: LlmConfig,
  ) => Promise<{ ok: boolean; error?: string }>;
}) {
  const { llmDraft, setLlmDraft, patchLlm, persistLlmDraft } = input;

  /** 勾选/取消一个本地候选模型（多选集 = 主模型 + 勾选项）。
   *  option C：本地候选只存名字（字符串、无 apiKey），与远端独立模型(extraModels)
   *  彻底分开，不写进 remoteModel。 */
  const toggleExtraModel = useCallback(
    (name: string) => {
      setLlmDraft((draft) => {
        if (!draft) return draft;
        const nextNames = mergeExtraModels(
          draft.localCandidates,
          draft.model,
          name,
        );
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
    async (entry: {
      name: string;
      baseUrl?: string;
      apiKey?: string;
      kind?: RemoteModelKind;
    }): Promise<{ ok: boolean; error?: string }> => {
      if (!llmDraft) return { ok: false, error: "配置未就绪，请稍后重试" };
      const name = entry.name.trim();
      if (!name) return { ok: false, error: "请填写模型名称" };
      if (llmDraft.extraModels.some((e) => e.name === name)) {
        return { ok: false, error: `模型「${name}」已在列表中` };
      }
      const cleaned: RemoteModelEntry = {
        name,
        baseUrl: entry.baseUrl?.trim() ? entry.baseUrl.trim() : null,
        apiKey: entry.apiKey?.trim() ? entry.apiKey.trim() : null,
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
    async (name: string): Promise<{ ok: boolean; error?: string }> => {
      if (!llmDraft) return { ok: false, error: "配置未就绪，请稍后重试" };
      const next = llmDraft.extraModels.filter((e) => e.name !== name);
      if (next.length === llmDraft.extraModels.length) return { ok: true };
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
      patch: {
        name?: string;
        baseUrl?: string | null;
        apiKey?: string;
        clearApiKey?: boolean;
        kind?: RemoteModelKind | null;
      },
    ): Promise<{ ok: boolean; error?: string }> => {
      if (!llmDraft) return { ok: false, error: "配置未就绪，请稍后重试" };
      const nextName = (patch.name ?? name).trim();
      if (!nextName) return { ok: false, error: "请填写模型名称" };
      const existing = llmDraft.extraModels.find((e) => e.name === name);
      if (!existing) {
        return { ok: false, error: `模型「${name}」不存在，请刷新后重试` };
      }
      if (
        nextName !== name &&
        llmDraft.extraModels.some((e) => e.name === nextName)
      ) {
        return { ok: false, error: `模型「${nextName}」已在列表中` };
      }
      const typedKey = patch.apiKey?.trim();
      const updated: RemoteModelEntry = {
        name: nextName,
        baseUrl:
          patch.baseUrl === undefined
            ? (existing?.baseUrl ?? null)
            : patch.baseUrl,
        /* `apiKey` 三态（台账 A11 的客户端这一半）：
         *   · 用户重填了 → 新值；
         *   · 显式勾了「清除密钥」→ `null`；
         *   · 都没动 → **省略这个键**。
         * 此前这里是 `(existing?.apiKey ?? null)`，而真实场景里 `existing` 来自服务端
         * **脱敏下发**的清单（永远不带值）→ 折成 `null` → `replaceAll` 按覆盖语义把
         * 库里那把密钥清掉。草稿不该揣测保留值：「我没意见」的正确表达是缺键。 */
        ...(typedKey
          ? { apiKey: typedKey }
          : patch.clearApiKey
            ? { apiKey: null }
            : {}),
        kind: patch.kind === undefined ? (existing?.kind ?? null) : patch.kind,
      };
      const nextDraft = {
        ...llmDraft,
        model: llmDraft.model === name ? nextName : llmDraft.model,
        extraModels: llmDraft.extraModels.map((e) =>
          e.name === name ? updated : e,
        ),
      };
      setLlmDraft(nextDraft);
      return persistLlmDraft(nextDraft);
    },
    [llmDraft, persistLlmDraft, setLlmDraft],
  );

  const probeRemote = useCallback(
    async (input: { baseUrl?: string; apiKey?: string; model?: string }) =>
      probeRemoteApi(input),
    [],
  );

  /** 模型「实际使用」测试（chat / 生图 / 生视频各一次真实调用）。
   *  网络封装在 lib/llm/usage-test-client，密钥解析在服务端完成。 */
  const testModelUsageFn = useCallback(
    async (input: UsageTestInput) => testModelUsage(input),
    [],
  );

  /** 「继续等待」已提交的异步视频任务（同一条目连接参数 + taskId，只查不重交）。
   *  网络封装在 lib/llm/usage-test-client，密钥解析在服务端完成。 */
  const queryUsageTaskFn = useCallback(
    async (input: UsageTaskQueryInput) => queryUsageTask(input),
    [],
  );

  /** 远端候选模型列表（配置视图，按保存顺序）——设置页不区分「当前生效」，
   *  用哪个模型由工坊运行时切换。 */
  const remoteModelList: RemoteModelEntry[] = llmDraft?.extraModels ?? [];

  const setTaskTemperature = useCallback(
    (task: TaskType, raw: string) => {
      if (!llmDraft) return;
      const base = llmDraft.temperatureByTask ?? {};
      /* 清空输入框 = 删掉该 key（而不是写入 undefined），否则「已覆盖」徽标
       * 会一直亮着，且保存时会把 undefined 一并发给后端。 */
      const next =
        raw === ""
          ? Object.fromEntries(
              Object.entries(base).filter(([key]) => key !== task),
            )
          : { ...base, [task]: Number(raw) };
      patchLlm({
        temperatureByTask:
          Object.keys(next).length > 0
            ? (next as Record<TaskType, number>)
            : undefined,
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
