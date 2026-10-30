"use client";

/* CanvasNode 的任务运行逻辑。
 *  负责挂载时对账 effect（陈旧 status="running" 的自愈）
 *  与 runGenerate（工作流分支 + 提示词分支，含轮询生命周期、
 *  下游接收节点自动孵化、图片自导入），以及 retryGenerate
 *  （用快照进错误面板上下文的 payload 重跑）。
 *  所有组件作用域的闭包（d / patch / wfIO / React Flow setter）
 *  都经 args 对象显式传入。 */
import { emitAppEvent } from "~/lib/app-events";
import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { Edge, Node, XYPosition } from "@xyflow/react";
import {
  outputTargetKind,
  splitWorkflowIO,
  type WorkflowIOMap,
} from "~/components/studio/workflow-io";
import { type CanvasNodeData, defaultData } from "~/lib/project-canvas/canvas-types";
import { makeNodeId, placeCanvasNode } from "~/lib/project-canvas/canvas-helpers";
import { beginStaleRun } from "~/lib/stale-run";
import {
  importOutputAsInput,
  startGenerate,
  pollTask,
  isTaskSuccess,
} from "~/lib/project-canvas/canvas-api";
import { getActiveId } from "~/lib/project-canvas/canvas-store";
import { setActiveTaskId } from "~/components/studio/project-canvas/activeTask";
import { vanillaApi } from "~/trpc/vanilla";
import { buildCanvasGeneratePayload } from "~/components/studio/project-canvas/CanvasNode/generate-payload";
import { parseGenerateInput, type GenerateInput } from "~/lib/workflow/workflow-generate-input";
import { errorMessage } from "~/lib/error-message";

export interface UseGenerateArgs {
  id: string;
  d: CanvasNodeData;
  patch: (p: Partial<CanvasNodeData>) => void;
  wfIO: WorkflowIOMap | null;
  /** 作者在工作流库配的「对外参数 → 节点端口」映射（paramMap.source）。 */
  wfParamMap?: Record<string, unknown> | null;
  /** 工作流当前生效的模式（落点覆盖按它归属，`source.mode:<模式>`）。 */
  wfMode?: string | null;
  setNodes: Dispatch<SetStateAction<Array<Node>>>;
  setEdges: Dispatch<SetStateAction<Array<Edge>>>;
  getNode: (id: string) => Node | undefined;
  /** 屏幕坐标 → 画布坐标（`useReactFlow().screenToFlowPosition`）——
   *  自动孵化下游节点时由出口用它换算落点。 */
  screenToFlowPosition: (p: XYPosition) => XYPosition;
}

export function useGenerate({
  id,
  d,
  patch,
  wfIO,
  wfParamMap,
  wfMode,
  setNodes,
  setEdges,
  getNode,
  screenToFlowPosition,
}: UseGenerateArgs) {
  /* 挂载时对账 —— 若节点带着陈旧的 `status="running"` 被
   *  加载（例如生成进行中 dev server 重启了，或用户在运行中
   *  关掉 / 重开了页签），内存里的 patch 链已丢失，但 DB 任务
   *  行早被 runner 的完成回调标成终态 —— 或者 runner 自己也死了，
   *  则由 runner.ts 里的 RUNNING 回收器标终态。没有这一步，卡片会
   *  永远停在「● 生成中…」，即使底层任务已是 FAILED/
   *  SUCCEEDED/CANCELLED。节点自称
   *  `status="running" + taskId` 时我们挂载时拉一次任务，patch 成真实
   *  结论。服务端仍在 RUNNING 的不动（那是另一个 runner 实例
   *  上合法地在跑）。 */
  const taskIdForReconcile = typeof d.taskId === "string" ? d.taskId : "";
  useEffect(() => {
    if (d.status !== "running" || !taskIdForReconcile) return;
    /* 这一轮的作废守卫（规范 16 §16.2.4.34）：节点卸载 / 换任务时，
     * 对账结论（patch）一律不落地。 */
    const guard = beginStaleRun();
    void (async () => {
      try {
        const t = await vanillaApi.task.detail.query({
          id: taskIdForReconcile,
        });
        if (!t?.status) return;
        if (t.status === "RUNNING") {
          // 在另一个 runner 上合法地仍在运行 —— 节点保持原样。
          return;
        }
        if (t.status === "SUCCEEDED") {
          guard.commit(() =>
            patch({
              status: "done",
              error: undefined,
              progress: 100,
              ...(t.resultImages ? { resultImages: t.resultImages } : {}),
            }),
          );
        } else if (t.status === "FAILED" || t.status === "CANCELLED") {
          guard.commit(() =>
            patch({
              status: "error",
              error: t.error ?? (t.status === "CANCELLED" ? "已取消" : "生成失败"),
              progress: 0,
            }),
          );
        }
      } catch {
        /* 网络抖动 —— 静默忽略；用户重触发 / runner 恢复后，
         *  GlobalStepLogPanel 的实时 SSE 会自己追上。 */
      }
    })();
    return () => guard.dispose();
    /* patch 是稳定的（setNodes setter + id）—— 故意省略以避免
     * 重复触发；每个 (status="running", taskId) 只对账一次。 */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.status, taskIdForReconcile]);

  /* ── 图片 / 视频生成 ── */
  const runGenerate = async () => {
    // ── 用户上传的工作流节点：跑选中的 WorkflowTemplate ──
    if (
      d.kind === "workflow" ||
      ((d.kind === "image" || d.kind === "video" || d.kind === "picture") && d.workflowId)
    ) {
      if (!d.workflowId) {
        patch({ error: "请先选择工作流", status: "error" });
        return;
      }
      /* 同时把进度重置为 0，好让水填充
       *  覆盖层从底部起步，不受上一轮残留值
       *  影响。pollTask 的 onProgress 会随
       *  后端上报的 task.progress 把它顶上去。 */
      patch({ status: "running", error: undefined, progress: 0 });
      /* 把 `payload` 提到外层，好让 catch 块也能把
       *  请求快照进 errorContext。try 块赋值前它是 `null`。 */
      let payload: GenerateInput | null = null;
      try {
        payload = buildCanvasGeneratePayload({
          d,
          wfIO,
          wfParamMap,
          wfMode,
          projectId: getActiveId(),
        });
        const taskId = await startGenerate(payload);
        patch({ taskId });
        setActiveTaskId(taskId, id);
        const result = await pollTask(taskId, undefined, (progress) => patch({ progress }));
        if (isTaskSuccess(result)) {
          // picture 节点 = 图片资产本身，生成结果直接
          //  写回本节点 mediaPath（ContentAssetBody 据此预览），不另起下游节点。
          if (d.kind === "picture") {
            let imported: string | null = null;
            try {
              imported = await importOutputAsInput(result.localPath);
            } catch {
              imported = null;
            }
            patch({
              status: "done",
              resultPath: result.localPath,
              resultMediaType: result.mediaType,
              mediaPath: imported ?? result.localPath.split("/").pop() ?? "",
              mediaName: d.workflowName ?? "生成结果",
            });
            emitAppEvent("canvas:produce", {
              id,
              resultPath: result.localPath,
              resultMediaType: result.mediaType,
            });
            return;
          }
          // 自动孵化一个下游图片 / 视频节点，并连到本节点的
          // 输出句柄，好让产出的媒体被展示且可继续串联。每个
          // 工作流节点只孵化一次（workflowSinkId 挡住重跑）。
          let sinkId = d.workflowSinkId;
          if (!sinkId) {
            /* 这是**第四个**「把新节点放进画布」的落点（规范 16
             * §16.2.4.38）—— 收口时只找到三处，是 P35 的判据把它抓出来的。
             * 它的落点既不是指针也不是视口中心，而是**源节点右侧 340px**，
             * 所以走出口的 `flowPosition` 那一支（坐标本身已在画布坐标系里）。 */
            const cur = getNode(id);
            const base = cur?.position ?? { x: 0, y: 0 };
            const isVideoOut = outputTargetKind(wfIO ?? undefined, d.workflowTaskType) === "video";
            // 主输出 ioKey（自动连线用，必须与该节点渲染的 output 句柄 id 一致）
            const outIoKey = splitWorkflowIO(wfIO ?? undefined).outputs[0]?.ioKey ?? "output";
            let imported: string | null = null;
            if (!isVideoOut && result.mediaType !== "video") {
              try {
                imported = await importOutputAsInput(result.localPath);
              } catch {
                imported = null;
              }
            }
            const sinkData = isVideoOut
              ? {
                  ...defaultData("video"),
                  resultPath: result.localPath,
                  resultMediaType: result.mediaType,
                }
              : {
                  ...defaultData("image"),
                  resultPath: result.localPath,
                  resultMediaType: result.mediaType,
                  inputImage: imported ?? null,
                  mode: imported ? "img2img" : "txt2img",
                };
            /* 节点 id 由出口生成 —— 先在本地算一份，好让紧接着的自动连线
             * 用同一个 id（出口的 `placeCanvasNode` 只吃「已经定好的 id」
             * 会把它自己的那枚判据挪回调用处）。 */
            const nid = makeNodeId();
            setNodes((nds) =>
              placeCanvasNode({
                nodes: nds,
                id: nid,
                flowPosition: { x: base.x + 340, y: base.y },
                flow: { screenToFlowPosition },
                data: /* SAFETY: 类型断言已复核 */ sinkData as CanvasNodeData,
              }),
            );
            setEdges((eds) => [
              ...eds,
              {
                id: `e_${id}-${nid}`,
                source: id,
                sourceHandle: outIoKey,
                target: nid,
                targetHandle: "inputImage",
              },
            ]);
            sinkId = nid;
          }
          patch({
            status: "done",
            resultPath: result.localPath,
            resultMediaType: result.mediaType,
            workflowSinkId: sinkId,
          });
          emitAppEvent("canvas:produce", {
            id,
            resultPath: result.localPath,
            resultMediaType: result.mediaType,
          });
        } else {
          patch({
            status: "error",
            error: result.error,
            taskId: result.taskId,
            errorStatus: result.status,
            /* 结构化校验错误落节点数据，错误面板渲染逐字段列表 */
            validationErrors: result.validationErrors,
            /* 失败面板要展示「执行了什么」 */
            errorContext: {
              request: result.params ?? payload,
              timestamp: new Date().toISOString(),
            },
          });
        }
      } catch (e: unknown) {
        patch({
          status: "error",
          error: errorMessage(e, "生成失败"),
          errorContext: {
            request: payload,
            timestamp: new Date().toISOString(),
          },
        });
      }
      return;
    }

    /* 内置模板已移除：画布上的生图 / 生视频节点与自定义工作流节点走同一条
     *  「工作流库工作流」分支。没有选中工作流时给出可行动的指引，而不是回落到
     *  内置模板（那条通路已随 __PROMPT__ / __SEED__ token 替换一起删除）。 */
    patch({ error: "请先选择工作流（工作流库模型）", status: "error" });
  };

  /* 错误面板重试：用记录在错误上下文里的 payload 重跑任务
   *  （从重试按钮的 onClick 处理器原样搬来）。
   *  直接复用上次已记录的 payload 重新跑
   *  一遍（不发新 task）。这样用户在保存当前错误上下文
   *  的同时，可以一键重试而无需重新输入所有字段。 */
  const retryGenerate = async (req: unknown) => {
    /* 这一份 `req` 是**外部输入**：它来自节点上的 `errorContext.request`，而那格的
     * 来源是任务行 `params` 列里存下来的载荷 —— 它跨过一次入参演进（今天的 schema
     * 与写下那一行的那天不必相同）。过去这里直接 `req as Record<string, unknown>`
     * 把它送回同一个 cast，于是「旧形状」只会在服务端变成一句英文的 zod 原文。
     * 预检用的就是服务端那一个 `generateInputSchema`（判据不另立一份），
     * 拒了就不发这次请求，并把能读的这句话交给错误面板。 */
    const parsed = parseGenerateInput(req);
    if (!parsed.ok) {
      patch({
        status: "error",
        error: parsed.message,
        errorContext: { request: req, timestamp: new Date().toISOString() },
      });
      return;
    }
    try {
      patch({ status: "running", error: undefined });
      const taskId = await startGenerate(parsed.input);
      patch({ taskId });
      setActiveTaskId(taskId, id);
      const result = await pollTask(taskId, undefined, (progress) => patch({ progress }));
      if (isTaskSuccess(result)) {
        patch({
          status: "done",
          resultPath: result.localPath,
          resultMediaType: result.mediaType,
        });
      } else {
        patch({
          status: "error",
          error: result.error,
          taskId: result.taskId,
          errorStatus: result.status,
          /* 重试失败也带回结构化校验错误 */
          validationErrors: result.validationErrors,
          errorContext: {
            request: result.params ?? req,
            timestamp: new Date().toISOString(),
          },
        });
      }
    } catch (e: unknown) {
      patch({
        status: "error",
        error: errorMessage(e, "生成失败"),
        errorContext: {
          request: req,
          timestamp: new Date().toISOString(),
        },
      });
    }
  };

  return { runGenerate, retryGenerate };
}
