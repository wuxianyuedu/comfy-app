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
  LOCAL_TASK_TIMEOUT_MS,
  preparePortraitReferences,
  startLocalGenerate,
  watchTask,
  withGenerationAttribution,
  type GenerateInput,
} from "~/lib/workshop/generation-client";
import { describeUnmatchedInputs } from "~/lib/workshop/workflow-encapsulation";
import { withTimeoutResult } from "~/lib/with-timeout";
import type { Character, Shot } from "~/lib/workshop/types";

/** 每个镜头节点的实时生成进度（pct + 当前 ComfyUI 节点类别）。 */
export type ShotProgressMap = Record<string, { pct: number; label?: string }>;

export interface WorkshopGenerationDeps {
  /** 本地链路的唯一可执行来源（空串 = 未选工作流）。 */
  workflowId: string;
  /** 角色卡表：镜头相关角色选了定妆照时，按它取参考图下发（流程 §4）。 */
  characters: Character[];
  /**
   * 当前项目 id（空串 = 还没有活跃项目）。与镜头号一起写进任务行，让「这一镜出过图吗」
   * 能由数据库回答，而不是只信草稿里那个 `imageUrl` 字符串。
   *
   * 这里是**原始字符串**而不是对象：整个依赖要被 `generateShot` 的 useCallback 吃进去，
   * 传对象会让回调每次渲染都换身份，下游 memo 全废。
   */
  projectId: string;
  /** 回写目标镜头的 status / taskId / imageUrl —— 镜头数据仍归主管线持有。 */
  setShots: React.Dispatch<React.SetStateAction<Shot[]>>;
  /** 需要引起用户注意的失败/阻断文案通道（由主管线决定怎么渲染，不用 alert）。 */
  notify: (message: string | null) => void;
}

export interface WorkshopGenerationApi {
  generating: boolean;
  shotProgress: ShotProgressMap;
  generateShot: (shot: Shot) => Promise<void>;
  /** 观察一个本地任务直到落定，结果回写对应镜头（生图 / 视频共用）。
   *  主管线的「恢复失联任务」也走它 —— 重挂载后要有人重新订阅那条 SSE。 */
  watchShotTask: (
    shotId: string,
    taskId: string,
    target?: "image" | "video",
  ) => Promise<void>;
}

export function useWorkshopGeneration({
  workflowId,
  characters,
  projectId,
  setShots,
  notify,
}: WorkshopGenerationDeps): WorkshopGenerationApi {
  /** 在途生成链的条数（不是布尔）：批量并发下同刻可能有两条链在跑，
   *  布尔会被先结束的那条提前复位。对外仍表现为 generating = 条数 > 0。 */
  const [generatingDepth, setGeneratingDepth] = React.useState(0);
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
   *  （宽高由 size-presets 按场景现算）。没落到任何端口的口随结果以提示文案
   *  返回 —— 「给了值却没生效」必须让用户知道（规范 10 §10.3.1），不静默丢。 */
  const buildShotInput = React.useCallback(
    async (
      shot: Shot,
    ): Promise<{ input: GenerateInput; unmatchedWarning: string | null }> => {
      /* 草稿里存的是尺寸表达（老数据可能是 "832x1216" 字符串，回读时归一）。 */
      const sizeSpec = parseShotSize(shot.params.size);
      /* 定妆照 → 参考图（流程 §4 的口径）：镜头相关角色选了定妆照就带上下发，
       * 落到作者连给参考图口的行上；工作流没连参考图口时进 unmatched，由
       * 下面的提示条告知。上传失败不拖垮生成，只有失败数需要提示。 */
      const refs = await preparePortraitReferences(
        characters,
        shot.characterIds,
      );
      if (refs.failedCount > 0) {
        notify(
          `${refs.failedCount} 张定妆照参考图上传失败，本次生成未使用它们`,
        );
      }
      const { input, unmatched } = await buildLibraryWorkflowInput(workflowId, {
        prompt: shot.prompt,
        negativePrompt: shot.negativePrompt || undefined,
        size: sizeSpec,
        ...(refs.files.length > 0 ? { referenceImages: refs.files } : {}),
      });
      return { input, unmatchedWarning: describeUnmatchedInputs(unmatched) };
    },
    [workflowId, characters, notify],
  );

  /** 观察一个本地任务直到落定，结果回写对应镜头。生图与视频共用这一条观察
   *  循环（`target` 决定写哪组字段：生图写 imageUrl/status，视频写
   *  clipUrl/clipStatus）；批量循环与「恢复失联任务」都走它。回写前核对任务
   *  归属 —— 恢复期间用户可能已对同一镜头重新发起（换了任务），旧观察不得
   *  覆盖新结果。
   *  30 分钟无响应按失败收尾并退订（与 ShotStudio / VideoStudio 的安全阀
   *  同口径、同常量）：批量循环永不卡死在一条沉默的流上。 */
  const watchShotTask = React.useCallback(
    (
      shotId: string,
      taskId: string,
      target: "image" | "video" = "image",
    ): Promise<void> => {
      /* 订阅句柄 —— watchTask 返回前先给一个空实现，超时路径上一定已赋值。 */
      let close: () => void = () => undefined;
      /** 回写只认「仍归属本任务」的镜头（生图与视频的归属字段不同）。 */
      const patchIfOwned = (p: Partial<Shot>) =>
        setShots((prev) =>
          prev.map((item) => {
            if (item.id !== shotId) return item;
            const owned =
              target === "video"
                ? item.clipTaskId === taskId
                : item.taskId === taskId;
            return owned ? { ...item, ...p } : item;
          }),
        );
      return withTimeoutResult(
        new Promise<void>((resolve) => {
          close = watchTask(taskId, {
            onProgress: (pct, node) => {
              /* 高频回调：按条目独立节流（规范 16 §16.2.4.68）。这条的值是
               * 「百分比 + 当前节点名」的复合体，故只用闸门、不用 hook。 */
              if (!progressGate.current.allow(shotId)) return;
              setShotProgress((prev) => ({
                ...prev,
                [shotId]: {
                  pct,
                  ...(node?.label ? { label: node.label } : {}),
                },
              }));
            },
            onOutput: (out) => {
              /* 生图只要图片产物、视频只要视频产物（另一种是别的阶段的）。 */
              const wanted =
                target === "video"
                  ? out.kind !== "image"
                  : out.kind !== "video";
              if (!wanted) return;
              patchIfOwned(
                target === "video"
                  ? { clipUrl: out.url }
                  : { imageUrl: out.url },
              );
            },
            onSettled: (result) => {
              setShotProgress((prev) => {
                const next = { ...prev };
                delete next[shotId];
                return next;
              });
              patchIfOwned(
                target === "video"
                  ? { clipStatus: result.ok ? "done" : "failed" }
                  : { status: result.ok ? "done" : "failed" },
              );
              if (!result.ok && result.message) {
                /* 用户主动取消走的是 CANCELLED 终态：不是故障，文案要分开 ——
                 * 否则一次正常取消会被报成红色「生成失败」。 */
                const cancelled = result.message.includes("CANCELLED");
                notify(
                  cancelled
                    ? `${target === "video" ? "视频" : "镜头"}任务已取消，可重新生成`
                    : `${target === "video" ? "视频" : "镜头"}生成失败：${result.message}`,
                );
              }
              resolve();
            },
          });
        }),
        LOCAL_TASK_TIMEOUT_MS,
        undefined,
        {
          onTimeout: () => {
            /* 安全阀：超时退订（放弃等待后流还挂着才是真问题），按失败收尾，
             * 批量循环得以继续下一镜。 */
            close();
            setShotProgress((prev) => {
              const next = { ...prev };
              delete next[shotId];
              return next;
            });
            patchIfOwned(
              target === "video"
                ? { clipStatus: "failed" }
                : { status: "failed" },
            );
            notify("任务超时（30 分钟无响应），已按失败收尾");
          },
        },
      );
    },
    [notify, setShots],
  );

  const generateShot = React.useCallback(
    async (shot: Shot) => {
      // 本地通道没有内置模板可回落：必须先选好一个工作流库生图工作流。
      if (!workflowId) {
        notify("请先在右侧「生成资源」选择一个生图工作流（工作流库）");
        return;
      }
      setGeneratingDepth((depth) => depth + 1);
      setShots((prev) =>
        prev.map((item) =>
          item.id === shot.id ? { ...item, status: "running" } : item,
        ),
      );
      try {
        const { input, unmatchedWarning } = await buildShotInput(shot);
        /* 未生效的口在发起前提示：生成要跑几十秒到几十分钟，事后说就晚了。 */
        if (unmatchedWarning) notify(unmatchedWarning);
        /* 归属在这里补，不进 `buildLibraryWorkflowInput`：那个封装同时服务封装页签的
         * 流程测试，那边既没有项目也没有镜头，塞进去会让它长出一个多数调用方都得传
         * null 的参数。 */
        const taskId = await startLocalGenerate(
          withGenerationAttribution(input, { projectId, shotId: shot.id }),
        );
        setShots((prev) =>
          prev.map((item) =>
            item.id === shot.id ? { ...item, taskId } : item,
          ),
        );
        await watchShotTask(shot.id, taskId);
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
        setGeneratingDepth((depth) => Math.max(0, depth - 1));
      }
    },
    /* 依赖比拆分前多两个：`notify` / `setShots` 在原来那层是 useState 直接给出的
     * 稳定引用，不必写；搬进本 hook 后它们变成**入参**，不写进依赖就是 lint 掩盖。
     * 调用侧传的是 useState 的 setter（同一组件生命周期内引用不变），所以回调身份
     * 与拆分前一致，不会多触发下游重渲染。 */
    [workflowId, projectId, buildShotInput, notify, setShots, watchShotTask],
  );
  return {
    generating: generatingDepth > 0,
    shotProgress,
    generateShot,
    watchShotTask,
  };
}
