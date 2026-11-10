"use client";

/**
 * 设置页「模型清单」分区的 sub-hook（`use-settings-page` 的拆分件）。
 * 只做配置：本地候选勾选 + 按任务温度；远端供应商 / 模型的增删改在
 * `use-settings-providers`（#3501 起独立成表、独立读写面），不在这里。
 * 连通性 / 实际调用测试走服务端代理（apiKey 不直接打远端），返回形状与主 hook 一致。
 */
import { useCallback, type Dispatch, type SetStateAction } from "react";

import {
  queryUsageTask,
  testModelUsage,
  type UsageTaskQueryInput,
  type UsageTestInput,
} from "~/lib/llm/usage-test-client";
import { TASK_TYPES, type TaskType } from "~/lib/llm/types";

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
  /** 增删改的即时落库出口（主 hook 的 `persistLlmDraft` 原样传入）；`silentOk` 沿用主 hook 口径。 */
  persistLlmDraft: (
    draft: LlmConfig,
    opts?: { silentOk?: boolean },
  ) => Promise<{ error?: string; ok: boolean }>;
  setLlmDraft: LlmDraftSetter;
}) {
  const { llmDraft, persistLlmDraft, setLlmDraft, patchLlm } = input;

  /** 勾选/取消一个本地候选模型（多选集 = 主模型 + 勾选项）。
   *  option C：本地候选只存名字（字符串、无 apiKey），与远端独立模型(extraModels)
   *  彻底分开，不写进 remoteModel。
   *  勾选是离散动作，**即时落库**（与其它偏好一致改为自动保存），成功静默、失败报错。 */
  const toggleExtraModel = useCallback(
    async (name: string): Promise<{ error?: string; ok: boolean }> => {
      if (!llmDraft) {
        return { ok: false, error: "配置未就绪，请稍后重试" };
      }
      const nextNames = mergeExtraModels(llmDraft.localCandidates, llmDraft.model, name);
      const unchanged =
        nextNames.length === llmDraft.localCandidates.length &&
        nextNames.every((n, i) => n === llmDraft.localCandidates[i]);
      if (unchanged) {
        return { ok: true };
      }
      const nextDraft = { ...llmDraft, localCandidates: nextNames };
      setLlmDraft(nextDraft);
      return persistLlmDraft(nextDraft, { silentOk: true });
    },
    [llmDraft, persistLlmDraft, setLlmDraft],
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
    testModelUsage: testModelUsageFn,
    queryUsageTask: queryUsageTaskFn,
    setTaskTemperature,
  };
}
