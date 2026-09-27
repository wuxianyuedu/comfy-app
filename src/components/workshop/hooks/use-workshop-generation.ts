"use client";

// ── 工坊生成链路（第②层）：单镜生图的执行态与编排 ────────────────────────────
//
// 从 `use-workshop-pipeline` 拆出来，是因为这三样东西只服务于「跑一次生成」，
// 却占着主管线的状态位与行数：`generating`、每镜实时进度 `shotProgress`、
// 按条目节流用的 `progressGate`，加上 `buildShotInput` / `generateShot`。
// 主管线要装的是项目草稿与六段状态，进度回写这种高频细节混在里面，会让两边
// 每次改动都互相碰到（也让行数一路顶到单文件 900 行的拆分线，规范 12 §12.8）。
//
// 本 hook **只搬不改**：判据、文案、节流口径、失败回写路径与拆分前逐字一致。

import React from "react";

import { createThrottleGate } from "~/components/ui/use-throttled-progress";
import { parseShotSize } from "~/components/workshop/shot-size-config";
import { errorMessage } from "~/lib/error-message";
import {
  buildLibraryWorkflowInput,
  startLocalGenerate,
  watchTask,
  type GenerateInput,
} from "~/lib/workshop/generation-client";
import type { Shot } from "~/lib/workshop/types";

/** 每个镜头节点的实时生成进度（pct + 当前 ComfyUI 节点类别）。 */
export type ShotProgressMap = Record<string, { pct: number; label?: string }>;

export interface WorkshopGenerationDeps {
  /** 本地链路的唯一可执行来源（空串 = 未选工作流）。 */
  workflowId: string;
  /** 回写目标镜头的 status / taskId / imageUrl —— 镜头数据仍归主管线持有。 */
  setShots: React.Dispatch<React.SetStateAction<Shot[]>>;
  /** 需要引起用户注意的失败/阻断文案通道（由主管线决定怎么渲染，不用 alert）。 */
  notify: (message: string | null) => void;
}

export interface WorkshopGenerationApi {
  generating: boolean;
  shotProgress: ShotProgressMap;
  generateShot: (shot: Shot) => Promise<void>;
}

export function useWorkshopGeneration({
  workflowId,
  setShots,
  notify,
}: WorkshopGenerationDeps): WorkshopGenerationApi {
  const [generating, setGenerating] = React.useState(false);
  const [shotProgress, setShotProgress] = React.useState<ShotProgressMap>({});
  /* 按条目独立节流的闸门（规范 16 §16.2.4.68）：值为「百分比 + 节点名」的
   * 复合体，故只用闸门、不用 hook。 */
  const progressGate = React.useRef(createThrottleGate());

  /**
   * 分镜阶段的单镜生图(StoryboardPlanner 的 onGenerate 契约不变):
   * 走与画布一致的本地 ComfyUI 链路(tRPC generate → SSE 任务流),
   * 结果回写 Shot.imageUrl / status,镜头生图阶段自动继承。
   */
  /** 单镜生成请求的封装：本地通道一律走工作流库工作流（内置模板已移除），
   *  按 ISSUE #145 只暴露 提示词 / 尺寸 / 参考图，其余走工作流默认值。
   *
   *  尺寸只表达一次（比例 + 分辨率 或 比例 + 百万像素 + 倍数）：整块交给封装层
   *  （宽高由 size-presets 按场景现算）。 */
  const buildShotInput = React.useCallback(
    async (shot: Shot): Promise<GenerateInput> => {
      /* 草稿里存的是尺寸表达（老数据可能是 "832x1216" 字符串，回读时归一）。 */
      const sizeSpec = parseShotSize(shot.params.size);
      const { input } = await buildLibraryWorkflowInput(workflowId, {
        prompt: shot.prompt,
        negativePrompt: shot.negativePrompt || undefined,
        size: sizeSpec,
      });
      return input;
    },
    [workflowId],
  );

  const generateShot = React.useCallback(
    async (shot: Shot) => {
      // 本地通道没有内置模板可回落：必须先选好一个工作流库生图工作流。
      if (!workflowId) {
        notify("请先在右侧「生成资源」选择一个生图工作流（工作流库）");
        return;
      }
      setGenerating(true);
      setShots((prev) =>
        prev.map((item) =>
          item.id === shot.id ? { ...item, status: "running" } : item,
        ),
      );
      try {
        const input = await buildShotInput(shot);
        const taskId = await startLocalGenerate(input);
        setShots((prev) =>
          prev.map((item) =>
            item.id === shot.id ? { ...item, taskId } : item,
          ),
        );
        await new Promise<void>((resolve) => {
          watchTask(taskId, {
            onProgress: (pct, node) => {
              /* 高频回调：按条目独立节流（规范 16 §16.2.4.68）。这条的值是
               * 「百分比 + 当前节点名」的复合体，故只用闸门、不用 hook。 */
              if (!progressGate.current.allow(shot.id)) return;
              setShotProgress((prev) => ({
                ...prev,
                [shot.id]: {
                  pct,
                  ...(node?.label ? { label: node.label } : {}),
                },
              }));
            },
            onOutput: (out) => {
              if (out.kind !== "video") {
                setShots((prev) =>
                  prev.map((item) =>
                    item.id === shot.id ? { ...item, imageUrl: out.url } : item,
                  ),
                );
              }
            },
            onSettled: (result) => {
              setShotProgress((prev) => {
                const next = { ...prev };
                delete next[shot.id];
                return next;
              });
              setShots((prev) =>
                prev.map((item) =>
                  item.id === shot.id
                    ? { ...item, status: result.ok ? "done" : "failed" }
                    : item,
                ),
              );
              resolve();
            },
          });
        });
      } catch (err: unknown) {
        setShots((prev) =>
          prev.map((item) =>
            item.id === shot.id ? { ...item, status: "failed" } : item,
          ),
        );
        const message = errorMessage(err, "生成失败");
        console.error(message);
        notify(message);
      } finally {
        setGenerating(false);
      }
    },
    /* 依赖比拆分前多两个：`notify` / `setShots` 在原来那层是 useState 直接给出的
     * 稳定引用，不必写；搬进本 hook 后它们变成**入参**，不写进依赖就是 lint 掩盖。
     * 调用侧传的是 useState 的 setter（同一组件生命周期内引用不变），所以回调身份
     * 与拆分前一致，不会多触发下游重渲染。 */
    [workflowId, buildShotInput, notify, setShots],
  );
  return {
    generating,
    shotProgress,
    generateShot,
  };
}
