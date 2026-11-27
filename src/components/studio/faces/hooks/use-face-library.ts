"use client";

/**
 * 角色脸库的逻辑层（规范 17 §17.2 ②）：搜索 / 复制 / 多选生图编排都在这里，
 * 视图只收 props。生图不新造链路：本地工作流走 buildLibraryWorkflowInput
 * → startLocalGenerate → observeLibraryImageTask，远端走 apiGenerateImage；
 * 模型候选由 useModelCatalog("image", "T2I") 收窄。复制走 useCopyFeedback
 * 唯一出口（视图层不碰 navigator.clipboard）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  LibraryTaskCancelledError,
  observeLibraryImageTask,
} from "~/components/studio/hooks/library-image-task";
import { useLibrarySelection } from "~/components/studio/hooks/use-library-selection";
import type { ModelSelection } from "~/components/workshop/ModelCascadeSelect";
import { useModelCatalog } from "~/components/workshop/hooks/use-model-catalog";
import { workflowIdFromCandidateValue } from "~/components/workshop/model-test-config";
import { useCopyFeedback } from "~/components/ui/use-copy-feedback";
import { runAsyncAction } from "~/lib/async-action";
import { runWithConcurrency } from "~/lib/async-pool";
import { isRecord } from "~/lib/is-record";
import { cancelTask } from "~/lib/task-cancel-client";
import {
  buildLibraryWorkflowInput,
  startLocalGenerate,
  WORKSHOP_BATCH_CONCURRENCY,
} from "~/lib/workshop/generation-client";
import { apiGenerateImage } from "~/lib/workshop/generation-api-client";

import {
  buildFaceNegative,
  buildFacePrompt,
  FACE_PRESETS,
  searchFacePresets,
  type FacePreset,
} from "../face-presets";

/** 一格生成结果。taskId 只在本地工作流通道产生，远端通道没有可取消的任务行；
 *  远端通道把 url / 提示词 / 模型名留在结果里，供「加入资产库」复用（#5114）。 */
export type FaceResult = {
  error?: string;
  modelName?: string;
  negativePrompt?: string;
  prompt?: string;
  status: "pending" | "cancelling" | "cancelled" | "done" | "failed";
  taskId?: string;
  url?: string;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 把 skill.list 那种「record + tags」行收窄成 UI 视图（脸库预设是本地常量，这里只留形状出口）。 */
function isFacePreset(value: unknown): value is FacePreset {
  if (!isRecord(value)) {
    return false;
  }
  const { description, id, local, name, prompt, tags } = value;
  return (
    typeof description === "string" &&
    typeof id === "string" &&
    typeof local === "boolean" &&
    typeof name === "string" &&
    typeof prompt === "string" &&
    Array.isArray(tags)
  );
}

export function useFaceLibrary() {
  const [query, setQuery] = useState("");
  const selection = useLibrarySelection<string>(
    FACE_PRESETS[0] === undefined ? [] : [FACE_PRESETS[0].id],
  );
  const [modelSelection, setModelSelection] = useState<ModelSelection>({ mode: "T2I", model: "" });
  const [results, setResults] = useState<Record<string, FaceResult>>({});
  const [generating, setGenerating] = useState(false);
  const [notice, setNotice] = useState("");
  /** 退订口按 taskId 登记，单条取消只退订对应那一条 SSE。 */
  const disposers = useRef<Map<string, () => void>>(new Map());
  /** 已发起取消的脸：在途观察即便回报失败也不许把「已取消」改写掉。 */
  const cancelled = useRef<Set<string>>(new Set());

  const catalog = useModelCatalog("image", "T2I");
  const filtered = useMemo(() => searchFacePresets(query, FACE_PRESETS), [query]);
  const selectedPresets = useMemo(() => {
    const selected = new Set(selection.selected);
    return FACE_PRESETS.filter((preset) => selected.has(preset.id));
  }, [selection.selected]);
  const prompt = useMemo(
    () => selectedPresets.map((preset) => buildFacePrompt(preset)).join("\n"),
    [selectedPresets],
  );

  const copy = useCopyFeedback();

  /* 卸载时退订仍挂着的 SSE（有界：只收这一页起的观察器）。 */
  useEffect(
    () => () => {
      for (const dispose of disposers.current.values()) {
        dispose();
      }
      disposers.current.clear();
    },
    [],
  );

  const patchResult = useCallback((id: string, next: FaceResult) => {
    setResults((prev) => ({ ...prev, [id]: next }));
  }, []);

  const toggleFace = selection.toggle;
  const clearAll = selection.clear;
  const selectAll = useCallback(() => {
    selection.selectAll(FACE_PRESETS.map((preset) => preset.id));
  }, [selection]);

  /** 批量生成：勾选的脸各出一张，沿用有界并发与「一格失败不拖累其余」。 */
  const generate = useCallback(async (): Promise<void> => {
    const chosen = selectedPresets;
    if (chosen.length === 0) {
      setNotice("先勾选至少一张脸");
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
    const nextResults: Record<string, FaceResult> = {};
    for (const preset of chosen) {
      nextResults[preset.id] = { status: "pending" };
    }
    setResults(nextResults);
    try {
      await runWithConcurrency(chosen, WORKSHOP_BATCH_CONCURRENCY, async (preset) => {
        try {
          const builtPrompt = buildFacePrompt(preset);
          const negative = buildFaceNegative();
          let url: string;
          let taskId: string | undefined;
          if (workflowId === "") {
            url = await apiGenerateImage({
              mode: "T2I",
              model: candidate.name,
              negative,
              prompt: builtPrompt,
            });
          } else {
            const built = await buildLibraryWorkflowInput(workflowId, {
              negativePrompt: negative,
              prompt: builtPrompt,
            });
            taskId = await startLocalGenerate(built.input);
            if (cancelled.current.has(preset.id)) {
              return;
            }
            patchResult(preset.id, { status: "pending", taskId });
            url = await observeLibraryImageTask(taskId, (id, dispose) => {
              disposers.current.set(id, dispose);
            });
          }
          if (cancelled.current.has(preset.id)) {
            return;
          }
          patchResult(preset.id, {
            ...(taskId === undefined
              ? {
                  modelName: candidate.name,
                  negativePrompt: negative,
                  prompt: builtPrompt,
                }
              : { taskId }),
            status: "done",
            url,
          });
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
  }, [catalog, modelSelection.model, patchResult, selectedPresets]);

  /** 单条取消：只对本地工作流通道生效（远端通道没有 task 行）。 */
  const cancelOne = useCallback(
    async (id: string): Promise<void> => {
      const current = results[id];
      if (current?.status !== "pending" || current.taskId === undefined || current.taskId === "") {
        return;
      }
      const taskId = current.taskId;
      const name = FACE_PRESETS.find((preset) => preset.id === id)?.name ?? id;
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
    [patchResult, results],
  );

  return {
    cancelOne,
    catalog,
    clearAll,
    copy,
    filtered,
    generate,
    generating,
    isFacePreset,
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
    toggleFace,
  };
}
