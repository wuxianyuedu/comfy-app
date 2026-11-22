"use client";

// ── 测试模型 · 历史页「重试」的带参预填（#4841）─────────────────────────
// 预填是表单值的**兜底层**不是会话值：写进某一格会在切模型后消失，放这里
// 才能「重试换个模型再跑」时参数跟着走。从 useModelTest 拆出（§12.13：主 hook
// 越过文件长度硬闸，按职责拆子 hook；与 use-model-test-json 同一手法）。

import { useCallback, useEffect, useRef, useState } from "react";

import { sceneFromMode } from "~/lib/media/size-presets";
import type { ModelTestRetryPayload } from "~/components/studio/history/history-detail-derive";

import { candidateValue, type TestCandidate } from "../model-test-config";

export function useModelTestReprint(args: {
  /** 候选清单（未按模式收窄的全量）：预选按它找同款工作流。 */
  candidates: Array<TestCandidate>;
  /** 参考图组（预填应用时清空：载荷刻意不携带旧任务的参考图）。 */
  referenceGroup: { reset: () => void };
  /** 当前选中的候选取值（预选只在它为空时补，不覆盖用户已选）。 */
  selectedModel: string;
  /** 用途 / 模式 / 模型的原生 setter（预填要按载荷整体摆位，不吃
   *  setKind / setMode 的逐项重置语义）。 */
  setKindState: (kind: "image" | "video" | "chat") => void;
  setModeState: (mode: string) => void;
  setSelectedModel: (name: string) => void;
  /** 工作流清单查询是否已 settle（成功 / 失败都算）：预选等它到位再补。 */
  workflowsReady: boolean;
}): {
  /** 应用一次预填：按任务模式切模式页签，能对上候选时预选同款工作流。 */
  applyReprintPrefill: (payload: ModelTestRetryPayload) => void;
  /** 用户接管输入（改值 / 随机 / 贴 JSON / 选文件）时整份退场。 */
  dropReprintPrefill: () => void;
  /** 历史页「重试」折好的预填载荷：null = 没有在场的预填。 */
  reprintPrefill: ModelTestRetryPayload | null;
} {
  const {
    candidates,
    referenceGroup,
    selectedModel,
    setKindState,
    setSelectedModel,
    setModeState,
    workflowsReady,
  } = args;
  const [reprintPrefill, setReprintPrefill] = useState<ModelTestRetryPayload | null>(null);

  const dropReprintPrefill = useCallback(() => {
    setReprintPrefill(null);
  }, []);

  /* 历史页「重试」的带参预填（#4841）：按任务模式切模式页签（模式码推不出
   * 用途时 sceneFromMode 兜底 image），清掉旧模型选择；参考图组一并清空——
   * 预填载荷刻意不携带旧任务的参考图（见 buildModelTestRetryPayload 的注释），
   * 旧图静默跟跑不是重试的语义。同款工作流的预选见下方候选就绪补选效应。 */
  const applyReprintPrefill = useCallback(
    (payload: ModelTestRetryPayload) => {
      setKindState(sceneFromMode(payload.mode));
      setSelectedModel("");
      setModeState(payload.mode);
      referenceGroup.reset();
      setReprintPrefill(payload);
    },
    [referenceGroup, setKindState, setModeState, setSelectedModel],
  );

  /* 预选同款工作流（#4841）：候选清单可能**晚于**预填到达 —— 首次进入本页是
   * 懒分块 + 工作流查询竞速，applyReprintPrefill 那一刻原地找一遍会静默漏选
   * （表单退回三步引导，统一输入看不见）。改成等工作流清单 settle 后补一次：
   * 就绪判据是 `workflowsReady`（成功 / 失败都算），不能拿「已有若干候选」
   * 顶替 —— 配置型候选先于工作流清单到达时长度非空但工作流候选还缺。
   * 只在「还没选模型」时补，不覆盖用户已选；同一份载荷只试一次（用户之后
   * 主动清空选择不再被抢回）。 */
  const preselectedForRef = useRef<ModelTestRetryPayload | null>(null);
  useEffect(() => {
    if (reprintPrefill === preselectedForRef.current) {
      return;
    }
    if (reprintPrefill !== null && !workflowsReady) {
      /* 工作流清单还没 settle：不标记，等它到位再补。 */
      return;
    }
    preselectedForRef.current = reprintPrefill;
    const workflowId = reprintPrefill?.workflowId;
    if (workflowId === undefined || selectedModel !== "") {
      return;
    }
    const matched = candidates.find((candidate) => candidate.workflow?.id === workflowId);
    if (matched !== undefined) {
      setSelectedModel(candidateValue(matched));
    }
  }, [candidates, reprintPrefill, selectedModel, setSelectedModel, workflowsReady]);

  return { reprintPrefill, dropReprintPrefill, applyReprintPrefill };
}
