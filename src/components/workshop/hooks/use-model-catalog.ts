"use client";

// 「测试模型」级联的目录读数复用层（#4834）：项目里各生成入口（提取 / 定妆照 /
// 镜头生图 / 视频）统一成「先选模态 → 再选模式 → 再选模型」的形态。候选装配、
// 模式收窄的取数口径只有测试模型页这一份（useTestCatalog，§12.18 复用优先）——
// 本文件只做薄封装：按 (kind, mode) 给出收窄后的候选、模式页签与按取值反查。

import { useMemo } from "react";

import { useTRPC } from "~/trpc/react";

import {
  candidateValue,
  defaultModeForKind,
  type ModeTab,
  type ModelTestKind,
  type TestCandidate,
} from "../model-test-config";
import { useTestCatalog } from "./use-model-test";

export type ModelCatalog = {
  /** 未按模式收窄的全部候选（摘要卡等只读展示用 —— 按取值反查显示名，
   *  不受当前模式影响）。 */
  allCandidates: Array<TestCandidate>;
  /** 应用模式收窄后的候选（chat = 全部候选；取值空间见 candidateValue）。 */
  candidates: Array<TestCandidate>;
  /** 该用途的默认模式（image → T2I、video → T2V；chat 恒 ""）。 */
  defaultMode: string;
  /** 候选是否还在取数（首取周期里下拉先不急着下「无候选」的结论）。 */
  loading: boolean;
  /** 当前 kind 的模式页签（chat 恒为空 —— 对话没有模式维度）。 */
  modeTabs: Array<ModeTab>;
  /** 按取值空间（模型名 / `wf::<工作流id>`）反查候选；未命中返回 null。 */
  resolveCandidate: (value: string) => TestCandidate | null;
};

export function useModelCatalog(kind: ModelTestKind, mode: string): ModelCatalog {
  const trpc = useTRPC();
  /* 模式缺省（旧草稿迁移 / 初次进入，mode = ""）落到该用途的默认模式再收窄 ——
   * 否则空模式会把候选收窄成空。defaultModeForKind 是静态纯函数，取数前可算。 */
  const effectiveMode = mode === "" ? defaultModeForKind(kind) : mode;
  const catalog = useTestCatalog({ kind, mode: effectiveMode, selectedModel: "", trpc });

  return useMemo(
    () => ({
      modeTabs: catalog.modeTabs,
      candidates: catalog.modeCandidates,
      allCandidates: catalog.candidates,
      loading: catalog.loading,
      defaultMode: defaultModeForKind(kind),
      resolveCandidate: (value: string): TestCandidate | null =>
        catalog.modeCandidates.find((c) => candidateValue(c) === value) ?? null,
    }),
    [catalog, kind],
  );
}
