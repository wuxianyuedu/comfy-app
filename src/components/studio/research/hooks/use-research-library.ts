"use client";

/**
 * 调研页（脸库 / 风格库 / 服饰库 / 装饰库）共用的生成逻辑层（规范 17 §17.2 ②）。
 *
 * 四页的差异只有「预设列表 + 提示词拼法 + 提示文案」，全部经 `config` 注入；
 * 本地工作流与远端 API 两条通道、有界并发、单条取消与退订、远端入库元数据的
 * 保留都只在这里实现一次（规范 12 §12.12 / 硬规则 20：不复制孪生对）。
 * 传输层仍是既有出口：generation-client / generation-api-client / task-cancel-client。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  LibraryTaskCancelledError,
  observeLibraryImageTask,
} from "~/components/studio/hooks/library-image-task";
import { useLibrarySelection } from "~/components/studio/hooks/use-library-selection";
import { searchResearchPresets } from "~/components/studio/research/research-prompt";
import type { ResearchPreset } from "~/components/studio/research/research-preset-types";
import type { ModelSelection } from "~/components/workshop/ModelCascadeSelect";
import { useModelCatalog } from "~/components/workshop/hooks/use-model-catalog";
import { workflowIdFromCandidateValue } from "~/components/workshop/model-test-config";
import { useCopyFeedback } from "~/components/ui/use-copy-feedback";
import { runAsyncAction } from "~/lib/async-action";
import { runWithConcurrency } from "~/lib/async-pool";
import { cancelTask } from "~/lib/task-cancel-client";
import {
  buildLibraryWorkflowInput,
  startLocalGenerate,
  WORKSHOP_BATCH_CONCURRENCY,
} from "~/lib/workshop/generation-client";
import { apiGenerateImage } from "~/lib/workshop/generation-api-client";

/** 一格生成结果；本地通道带 taskId，远端通道带入库所需的提示词 / 模型名（#5114）。 */
export type ResearchResult = {
  error?: string;
  modelName?: string;
  negativePrompt?: string;
  prompt?: string;
  status: "pending" | "cancelling" | "cancelled" | "done" | "failed";
  taskId?: string;
  url?: string;
};

export type ResearchLibraryConfig<P extends ResearchPreset> = {
  /** 一条预设 → 可直接送 T2I 的正向词。 */
  buildPrompt: (preset: P) => string;
  /** 勾选为空时的提示文案。 */
  emptyHint: string;
  /** 负向词（全库统一口径，由各页出口传入）。 */
  negative: () => string;
  /** 本页全部预设（顺序即界面顺序）。 */
  presets: ReadonlyArray<P>;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 单条生成：本地走工作流任务观察，远端直接取图；错误由调用处收进那一格。 */
async function generateOne<P extends ResearchPreset>(input: {
  config: ResearchLibraryConfig<P>;
  modelName: string;
  onDisposer: (taskId: string, dispose: () => void) => void;
  onPending: (taskId: string) => void;
  preset: P;
  workflowId: string;
}): Promise<ResearchResult> {
  const { config, modelName, onDisposer, onPending, preset, workflowId } = input;
  const prompt = config.buildPrompt(preset);
  const negative = config.negative();
  if (workflowId !== "") {
    const built = await buildLibraryWorkflowInput(workflowId, {
      negativePrompt: negative,
      prompt,
    });
    const taskId = await startLocalGenerate(built.input);
    /* 先把 taskId 落到那一格，等待产物期间也能单条取消（与脸库 / 风格库同口径）。 */
    onPending(taskId);
    const url = await observeLibraryImageTask(taskId, onDisposer);
    return { status: "done", taskId, url };
  }
  const url = await apiGenerateImage({ mode: "T2I", model: modelName, negative, prompt });
  return { modelName, negativePrompt: negative, prompt, status: "done", url };
}

/** 视图只依赖这一组状态与动作；各页传进来的 controller 是它的实现。 */
export type ResearchLibraryController<P extends ResearchPreset> = {
  cancelOne: (id: string) => Promise<void>;
  clearAll: () => void;
  copy: (text: string) => void;
  filtered: ReadonlyArray<P>;
  generate: () => Promise<void>;
  generating: boolean;
  modelSelection: ModelSelection;
  notice: string;
  prompt: string;
  query: string;
  results: Record<string, ResearchResult>;
  selectAll: () => void;
  selectedIds: ReadonlyArray<string>;
  selectedPresets: ReadonlyArray<P>;
  setModelSelection: (selection: ModelSelection) => void;
  setQuery: (query: string) => void;
  togglePreset: (id: string) => void;
};

export function useResearchLibrary<P extends ResearchPreset>(config: ResearchLibraryConfig<P>) {
  const [query, setQuery] = useState("");
  const first = config.presets[0];
  const selection = useLibrarySelection<string>(first === undefined ? [] : [first.id]);
  const [modelSelection, setModelSelection] = useState<ModelSelection>({ mode: "T2I", model: "" });
  const [results, setResults] = useState<Record<string, ResearchResult>>({});
  const [generating, setGenerating] = useState(false);
  const [notice, setNotice] = useState("");
  /** SSE 退订口按 taskId 登记；已取消的 preset 即便在途回报失败也不改写状态。 */
  const disposers = useRef<Map<string, () => void>>(new Map());
  const cancelled = useRef<Set<string>>(new Set());

  const catalog = useModelCatalog("image", "T2I");
  const filtered = useMemo(
    () => searchResearchPresets(query, config.presets),
    [config.presets, query],
  );
  const selectedPresets = useMemo(() => {
    const selected = new Set(selection.selected);
    return config.presets.filter((preset) => selected.has(preset.id));
  }, [config.presets, selection.selected]);
  const prompt = useMemo(
    () => selectedPresets.map(config.buildPrompt).join("\n"),
    [config.buildPrompt, selectedPresets],
  );
  const copy = useCopyFeedback();

  useEffect(
    () => () => {
      for (const dispose of disposers.current.values()) {
        dispose();
      }
      disposers.current.clear();
    },
    [],
  );

  const patchResult = useCallback((id: string, next: ResearchResult) => {
    setResults((prev) => ({ ...prev, [id]: next }));
  }, []);

  const togglePreset = selection.toggle;
  const clearAll = selection.clear;
  const selectAll = useCallback(() => {
    selection.selectAll(config.presets.map((preset) => preset.id));
  }, [config.presets, selection]);

  /** 批量生成：勾选的预设各出一张，一格失败不拖累其余。 */
  const generate = useCallback(async (): Promise<void> => {
    const chosen = selectedPresets;
    if (chosen.length === 0) {
      setNotice(config.emptyHint);
      return;
    }
    const candidate = catalog.resolveCandidate(modelSelection.model);
    if (candidate === null) {
      setNotice("先选一个支持文生图（T2I）的模型");
      return;
    }
    setNotice("");
    setGenerating(true);
    cancelled.current.clear();
    for (const dispose of disposers.current.values()) {
      dispose();
    }
    disposers.current.clear();
    const workflowId = workflowIdFromCandidateValue(modelSelection.model);
    const nextResults: Record<string, ResearchResult> = {};
    for (const preset of chosen) {
      nextResults[preset.id] = { status: "pending" };
    }
    setResults(nextResults);
    try {
      await runWithConcurrency(chosen, WORKSHOP_BATCH_CONCURRENCY, async (preset) => {
        try {
          const result = await generateOne({
            config,
            modelName: candidate.name,
            onDisposer: (taskId, dispose) => {
              disposers.current.set(taskId, dispose);
            },
            onPending: (taskId) => {
              if (!cancelled.current.has(preset.id)) {
                patchResult(preset.id, { status: "pending", taskId });
              }
            },
            preset,
            workflowId,
          });
          if (!cancelled.current.has(preset.id)) {
            patchResult(preset.id, result);
          }
        } catch (error) {
          if (cancelled.current.has(preset.id) || error instanceof LibraryTaskCancelledError) {
            return;
          }
          patchResult(preset.id, { error: errorMessage(error), status: "failed" });
        }
      });
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setGenerating(false);
    }
  }, [catalog, config, modelSelection.model, patchResult, selectedPresets]);

  /** 单条取消只对本地工作流通道生效（远端通道没有可取消的任务行）。 */
  const cancelOne = useCallback(
    async (id: string): Promise<void> => {
      const current = results[id];
      if (current?.status !== "pending" || current.taskId === undefined || current.taskId === "") {
        return;
      }
      const taskId = current.taskId;
      const name = config.presets.find((preset) => preset.id === id)?.name ?? id;
      cancelled.current.add(id);
      patchResult(id, { status: "cancelling", taskId });
      const outcome = await runAsyncAction(() => cancelTask(taskId), {
        report: (kind, detail) => {
          if (kind === "err") {
            setNotice(detail);
          }
        },
        failureText: `取消「${name}」失败，请稍后重试`,
        successText: `已取消「${name}」的生成`,
      });
      if (outcome.ok) {
        disposers.current.get(taskId)?.();
        disposers.current.delete(taskId);
        patchResult(id, { status: "cancelled", taskId });
        return;
      }
      cancelled.current.delete(id);
      patchResult(id, { status: "pending", taskId });
    },
    [config.presets, patchResult, results],
  );

  return {
    cancelOne,
    catalog,
    clearAll,
    copy,
    filtered,
    generate,
    generating,
    modelSelection,
    notice,
    prompt,
    query,
    results,
    selectAll,
    selectedIds: selection.selected,
    selectedPresets,
    setModelSelection,
    setQuery,
    togglePreset,
  };
}
