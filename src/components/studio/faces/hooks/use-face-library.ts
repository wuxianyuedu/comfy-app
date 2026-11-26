"use client";

/**
 * 角色脸库的逻辑层（规范 17 §17.2 ②）：搜索 / 复制 / 生图编排都在这里，
 * 视图只收 props。生图不新造链路：本地工作流走 `buildLibraryWorkflowInput`
 * → `startLocalGenerate` → `observeTaskUntilSettled`，远端走 `apiGenerateImage`；
 * 模型候选由 `useModelCatalog("image", "T2I")` 收窄。复制走 `useCopyFeedback`
 * 唯一出口（视图层不碰 navigator.clipboard）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ModelSelection } from "~/components/workshop/ModelCascadeSelect";
import { useModelCatalog } from "~/components/workshop/hooks/use-model-catalog";
import { workflowIdFromCandidateValue } from "~/components/workshop/model-test-config";
import { useCopyFeedback } from "~/components/ui/use-copy-feedback";
import { isRecord } from "~/lib/is-record";
import {
  buildLibraryWorkflowInput,
  LOCAL_TASK_TIMEOUT_MS,
  observeTaskUntilSettled,
  startLocalGenerate,
} from "~/lib/workshop/generation-client";
import { apiGenerateImage } from "~/lib/workshop/generation-api-client";
import { isWantedOutput } from "~/lib/workshop/output-filter";

import {
  buildFaceNegative,
  buildFacePrompt,
  FACE_PRESETS,
  findFacePreset,
  searchFacePresets,
  type FacePreset,
} from "../face-presets";

/** 一格生成结果。 */
export type FaceResult = {
  error?: string;
  status: "pending" | "done" | "failed";
  url?: string;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 等本地任务出图：SSE 落定后收图片产物；未读到图片按失败处理。 */
function observeImageTask(
  taskId: string,
  registerDisposer: (dispose: () => void) => void,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let stop: () => void = () => undefined;
    let url = "";
    stop = observeTaskUntilSettled({
      onIdleTimeout: (snapshot) => {
        stop();
        const found = snapshot?.outputs.find((out) => isWantedOutput("image", out));
        if (found) {
          resolve(found.url);
        } else {
          reject(new Error("任务超时未产出图片"));
        }
      },
      onOutput: (out) => {
        if (isWantedOutput("image", out)) {
          url = out.url;
        }
      },
      onSettled: (result) => {
        stop();
        if (result.ok && url !== "") {
          resolve(url);
        } else {
          reject(new Error(result.message ?? "生成失败"));
        }
      },
      taskId,
      timeoutMs: LOCAL_TASK_TIMEOUT_MS,
    });
    registerDisposer(stop);
  });
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
  const [selectedId, setSelectedId] = useState<string>(FACE_PRESETS[0]?.id ?? "");
  const [modelSelection, setModelSelection] = useState<ModelSelection>({ mode: "T2I", model: "" });
  const [result, setResult] = useState<FaceResult>({ status: "pending" });
  const [generating, setGenerating] = useState(false);
  const [notice, setNotice] = useState("");
  const disposers = useRef<Array<() => void>>([]);

  const catalog = useModelCatalog("image", "T2I");
  const filtered = useMemo(() => searchFacePresets(query, FACE_PRESETS), [query]);
  const selected = useMemo(() => findFacePreset(selectedId), [selectedId]);
  const prompt = useMemo(() => (selected === null ? "" : buildFacePrompt(selected)), [selected]);

  const copy = useCopyFeedback();

  /* 卸载时退订仍挂着的 SSE（有界：只收这一页起的观察器）。 */
  useEffect(
    () => () => {
      for (const dispose of disposers.current) {
        dispose();
      }
      disposers.current = [];
    },
    [],
  );

  const generate = useCallback(async (): Promise<void> => {
    if (selected === null) {
      setNotice("先选一张脸");
      return;
    }
    const candidate = catalog.resolveCandidate(modelSelection.model);
    if (candidate === null) {
      setNotice("先选一个支持文生图（T2I）的模型");
      return;
    }
    setNotice("");
    setGenerating(true);
    setResult({ status: "pending" });
    const workflowId = workflowIdFromCandidateValue(modelSelection.model);
    try {
      const builtPrompt = buildFacePrompt(selected);
      const negative = buildFaceNegative();
      let url: string;
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
        const taskId = await startLocalGenerate(built.input);
        url = await observeImageTask(taskId, (dispose) => {
          disposers.current.push(dispose);
        });
      }
      setResult({ status: "done", url });
    } catch (error) {
      setResult({ error: errorMessage(error), status: "failed" });
    } finally {
      setGenerating(false);
    }
  }, [catalog, modelSelection.model, selected]);

  return {
    catalog,
    copy,
    filtered,
    generate,
    generating,
    isFacePreset,
    modelSelection,
    notice,
    prompt,
    query,
    result,
    selected,
    selectedId,
    setModelSelection,
    setQuery,
    setSelectedId,
  };
}
