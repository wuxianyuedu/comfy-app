"use client";

/* extracted from CanvasNode — task-run logic.
 *  Owns the mount-time reconcile effect (stale status="running" self-heal)
 *  and runGenerate (workflow branch + prompt branch, incl. poll lifecycle,
 *  downstream sink auto-spawn and picture self-import), plus retryGenerate
 *  (re-run with the payload snapshotted into the error panel's context).
 *  All component-scoped closures (d / patch / wfIO / React Flow setters) are
 *  threaded in explicitly via the args object. */
import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { Edge, Node } from "@xyflow/react";
import {
  outputTargetKind,
  toWorkflowInputsPayload,
  splitWorkflowIO,
  type WorkflowIOMap,
} from "@/components/studio/shared/workflow-io";
import { type CanvasNodeData, defaultData } from "@/lib/project-canvas/canvas-types";
import { makeNodeId } from "@/lib/project-canvas/canvas-helpers";
import {
  importOutputAsInput,
  startGenerate,
  pollTask,
  isTaskSuccess,
} from "@/lib/project-canvas/canvas-api";
import { getActiveId } from "@/lib/project-canvas/canvas-store";
import { setActiveTaskId } from "@/components/studio/project-canvas/activeTask";
import { vanillaApi } from "~/trpc/vanilla";
import { collectReferenceImages, seedModeOverrides } from "@/components/studio/project-canvas/CanvasNode/helpers";
import {
  applyParamMapping,
  buildParamEntries,
  parseParamMapping,
} from "@/lib/workflow-param-mapping";

/** catch 抛出值（unknown）→ 与旧 `e?.message ?? String(e)` 逐值等价的错误文案：
 *  带 string message 的对象取 message（Error 实例即此路径），其余走 String(v)
 *  等价实现（对象经其 toString → "[object Object]"，null/undefined →
 *  "null"/"undefined"）。旧代码兜底的 `?? "未捕获异常"` 不可达（String 恒返回
 *  非空值），此处一并收敛。 */
function catchMessage(e: unknown): string {
  if (typeof e === "object" && e !== null && "message" in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  if (typeof e === "string") return e;
  if (e === null) return "null";
  if (e === undefined) return "undefined";
  return (e as { toString(): string }).toString();
}

export interface UseGenerateArgs {
  id: string;
  d: CanvasNodeData;
  patch: (p: Partial<CanvasNodeData>) => void;
  wfIO: WorkflowIOMap | null;
  /** 作者在工作流库配的「对外参数 → 节点端口」映射（paramMap.source）。 */
  wfParamMap?: Record<string, unknown> | null;
  /** 工作流当前生效的模式（落点覆盖按它归属，`source.mode:<模式>`）。 */
  wfMode?: string | null;
  setNodes: Dispatch<SetStateAction<Node[]>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  getNode: (id: string) => Node | undefined;
}

export function useGenerate({ id, d, patch, wfIO, wfParamMap, wfMode, setNodes, setEdges, getNode }: UseGenerateArgs) {
  /* mount-time reconcile — if the node was
   *  loaded with stale `status="running"` (e.g. dev server restarted
   *  while a generation was in flight, or the user closed/reopened the
   *  tab mid-run), the in-memory patch chain is gone but the DB task
   *  row has long been marked terminal by the runner's completion
   *  callback — or, if the runner itself died, by the RUNNING reaper
   *  we added in runner.ts.  Without this, the card sticks on
   *  "● 生成中…" forever even though the underlying task is FAILED/
   *  SUCCEEDED/CANCELLED.  We fetch the task once on mount when the
   *  node claims `status="running" + taskId` and patch to the real
   *  verdict. RUNNING-on-server is left alone (legitimately running
   *  on another runner instance). */
  const taskIdForReconcile = typeof d.taskId === "string" ? d.taskId : "";
  useEffect(() => {
    if (d.status !== "running" || !taskIdForReconcile) return;
    let cancelled = false;
    void (async () => {
      try {
        if (cancelled) return;
        const t = await vanillaApi.task.detail.query({ id: taskIdForReconcile });
        if (cancelled || !t?.status) return;
        if (t.status === "RUNNING") {
          // Legitimately still running on another runner — leave the node as-is.
          return;
        }
        if (t.status === "SUCCEEDED") {
          patch({
            status: "done",
            error: undefined,
            progress: 100,
            ...(t.resultImages ? { resultImages: t.resultImages } : {}),
          });
        } else if (t.status === "FAILED" || t.status === "CANCELLED") {
          patch({
            status: "error",
            error: t.error ?? (t.status === "CANCELLED" ? "已取消" : "生成失败"),
            progress: 0,
          });
        }
      } catch {
        /* network blip — silently ignore; the live SSE via GlobalStepLogPanel
         *  will catch up if the user re-triggers / the runner resumes. */
      }
    })();
    return () => { cancelled = true; };
    /* patch is stable (setNodes setter + id) — intentionally omitted to avoid
     * re-firing; we only want one reconcile per (status="running", taskId). */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.status, taskIdForReconcile]);

  /* ── image / video generation ── */
  const runGenerate = async () => {
    // ── user-uploaded workflow node: run the chosen WorkflowTemplate ──
    if (d.kind === "workflow" || ((d.kind === "image" || d.kind === "video" || d.kind === "picture") && d.workflowId)) {
      if (!d.workflowId) {
        patch({ error: "请先选择工作流", status: "error" });
        return;
      }
      /* also reset progress to 0 so the water-fill
       *  overlay starts from the bottom regardless of any stale value left
       *  from a previous run. pollTask's onProgress will tick it up as the
       *  backend reports task.progress. */
      patch({ status: "running", error: undefined, progress: 0 });
      /* hoist `payload` so the catch-block can also snapshot
       *  the request into errorContext.  `null` until the try-block assigns. */
      let payload: Record<string, unknown> | null = null;
      try {
        /* 有映射表时按「对外参数 → 目标端口」解析：连了线的对外口只覆盖它连到
         *  的那个端口（不把该节点别的默认值也塞进去），没连线的对外口仍按默认值
         *  兜底 —— 这正是「自动映射 = 默认连线状态，可在此基础上编辑」的运行期语义。 */
        const mode = wfMode ?? null;
        const mapped = wfIO
          ? applyParamMapping({
              io: wfIO,
              entries: buildParamEntries(wfIO, undefined, { mode }),
              mapping: parseParamMapping(wfParamMap ?? d.paramMap),
              values: d.workflowInputs ?? {},
              mode,
            })
          : null;
        const baseInputs =
          mapped && mapped.inputs.length > 0
            ? mapped.inputs
            : toWorkflowInputsPayload(wfIO ?? undefined, d.workflowInputs ?? {});
        const cagInputs = seedModeOverrides(wfIO ?? null, d.seedModes);
        payload = {
          workflow: d.workflowId,
          // Exposed-pin values drive the workflow (not the old hardcoded
          // 提示词/反向/参考图/步数/CFG/种子 fields). 种子「生成后控制」模式
          // 也并入同一数组（name=control_after_generate），API 图与 Raw 图两条
          // 后端路径都能识别。注：原本单独下发的 seedModes 字段被 zod schema
          // 剥离、从未到达后端，故改为并入 workflowInputs 一并生效。
          workflowInputs: [...baseInputs, ...cagInputs],
        };
        // Feed an upstream-generated image into this workflow (auto-chained via edge).
        if (d.inputImage) payload.inputImage = d.inputImage;
        // 项目级产出：归属到当前画布项目 + 记录参考图。
        payload.projectId = getActiveId() ?? undefined;
        const refs = collectReferenceImages(d);
        if (refs.length) payload.referenceImages = refs;
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
            window.dispatchEvent(
              new CustomEvent("canvas:produce", {
                detail: { id, resultPath: result.localPath, resultMediaType: result.mediaType },
              })
            );
            return;
          }
          // Auto-spawn a downstream image/video node and wire it to this node's
          // output handle, so the produced media is shown + chainable. Spawn
          // once per workflow node (workflowSinkId guards re-runs).
          let sinkId = d.workflowSinkId;
          if (!sinkId) {
            const nid = makeNodeId();
            const cur = getNode(id);
            const base = cur?.position ?? { x: 0, y: 0 };
            const isVideoOut =
              outputTargetKind(wfIO ?? undefined, d.workflowTaskType) === "video";
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
            const sinkData =
              isVideoOut
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
            setNodes((nds) => [
              ...nds,
              { id: nid, type: "canvasNode", position: { x: base.x + 340, y: base.y }, data: sinkData },
            ]);
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
          window.dispatchEvent(
            new CustomEvent("canvas:produce", {
              detail: { id, resultPath: result.localPath, resultMediaType: result.mediaType },
            })
          );
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
          error: catchMessage(e),
          errorContext: {
            request: payload,
            timestamp: new Date().toISOString(),
          },
        });
      }
      return;
    }

    if (!d.prompt.trim()) {
      patch({ error: "请输入提示词", status: "error" });
      return;
    }
    /* reset progress to 0 so the overlay starts
     *  from the bottom (same reasoning as the workflow branch above). */
    patch({ status: "running", error: undefined, progress: 0 });
    /* see workflow run above; hoist payload so catch can snapshot. */
    let payload: Record<string, unknown> | null = null;
    try {
      payload = {
        prompt: d.prompt,
        negative: d.negative || undefined,
        size: d.size,
        steps: d.steps,
        cfg: d.cfg,
      };
      if (d.seed.trim()) payload.seed = Number(d.seed);
      // 项目级产出：归属到当前画布项目 + 记录参考图。
      payload.projectId = getActiveId() ?? undefined;
      const refs = collectReferenceImages(d);
      if (refs.length) payload.referenceImages = refs;
      if (d.kind === "image") {
        payload.workflow = d.mode === "img2img" ? "img2img" : "txt2img";
        if (d.mode === "img2img" && d.inputImage) payload.inputImage = d.inputImage;
      } else {
        payload.workflow =
          d.mode === "t2v" ? "txt2video" : d.mode === "flf" ? "flfvideo" : "img2video";
        payload.frames = d.frames;
        payload.fps = d.fps;
        if (d.mode === "i2v" && d.inputImage) payload.inputImage = d.inputImage;
        if (d.mode === "flf") {
          payload.firstFrame = d.firstFrame;
          payload.lastFrame = d.lastFrame;
        }
      }
      const taskId = await startGenerate(payload);
      patch({ taskId });
      const result = await pollTask(taskId);
      if (isTaskSuccess(result)) {
        patch({
          status: "done",
          resultPath: result.localPath,
          resultMediaType: result.mediaType,
        });
        // Broadcast so downstream (connected) nodes can auto-consume this output.
        window.dispatchEvent(
          new CustomEvent("canvas:produce", {
            detail: {
              id,
              resultPath: result.localPath,
              resultMediaType: result.mediaType,
            },
          })
        );
      } else {
        patch({
          status: "error",
          error: result.error,
          taskId: result.taskId,
          errorStatus: result.status,
          /* 结构化校验错误落节点数据 */
          validationErrors: result.validationErrors,
          errorContext: {
            request: result.params ?? payload,
            timestamp: new Date().toISOString(),
          },
        });
      }
    } catch (e: unknown) {
      patch({
        status: "error",
        error: catchMessage(e),
        errorContext: {
          request: payload,
          timestamp: new Date().toISOString(),
        },
      });
    }
  };

  /* Error-panel retry: re-run the task with the payload recorded in the
   *  error context (moved verbatim from the retry button's onClick handler).
   *  直接复用上次已记录的 payload 重新跑
   *  一遍（不发新 task）。这样用户在保存当前错误上下文
   *  的同时，可以一键重试而无需重新输入所有字段。 */
  const retryGenerate = async (req: unknown) => {
    try {
      patch({ status: "running", error: undefined });
      const taskId = await startGenerate(req as Record<string, unknown>);
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
        error: catchMessage(e),
        errorContext: {
          request: req,
          timestamp: new Date().toISOString(),
        },
      });
    }
  };

  return { runGenerate, retryGenerate };
}
