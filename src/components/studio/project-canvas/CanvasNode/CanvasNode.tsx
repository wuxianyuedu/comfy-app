/* eslint-disable @typescript-eslint/no-base-to-string, @typescript-eslint/no-empty-function, @typescript-eslint/no-explicit-any, @typescript-eslint/no-floating-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/prefer-optional-chain, @typescript-eslint/prefer-regexp-exec */
"use client";

import React, { useEffect, useState } from "react";
import { Handle, Position, useReactFlow, type NodeProps } from "@xyflow/react";
import { WorkflowNode, type WorkflowModesState, type WorkflowSourceFilter } from "../WorkflowNode";
import { ContentAssetBody } from "../ContentAssetNode";
import { ImageGenerationPanel } from "../ImageGenerationPanel";
import {
  outputTargetKind,
  reconcileInputValues,
  toWorkflowInputsPayload,
  splitWorkflowIO,
  type WorkflowIOMap,
} from "@/components/studio/shared/workflow-io";
import { ValidationErrorList } from "@/components/studio/shared/ValidationErrorList";
import {
  type CanvasNodeData,
  type CanvasNodeType,
  NODE_META,
  defaultData,
} from "../canvas-types";
import { Icon } from "@/components/ui/Icon";
import {
  uploadImageFile,
  uploadMediaFile,
  importOutputAsInput,
  makeNodeId,
  startGenerate,
  pollTask,
  isTaskSuccess,
} from "../canvas-helpers";
import { getActiveId } from "../canvas-store";
import { setActiveTaskId } from "../activeTask";
import { vanillaApi } from "~/trpc/vanilla";
import { parseModesJson } from "@/lib/workflow-types";
import { DebugChainFooter } from "../../debug/DebugChainFooter";
import { getProjectCanvasRenderChain } from "../canvas-render-chain";
import { collectReferenceImages, seedModeOverrides } from "./helpers";
import { NodeChip, PORT_STYLE, StatusBadge, StatusDot } from "./CanvasNodePrimitives";
import { OutputRowPort, SelectedToolbar } from "./SelectedToolbar";

/* ── Main node component ── */
export const CanvasNode = React.memo(function CanvasNode({ id, data, selected }: NodeProps<CanvasNodeType>) {
  const d = data as CanvasNodeData;
  const { setNodes, getNode, setEdges, fitView } = useReactFlow();
  const meta = NODE_META[d.kind];

  const patch = (p: Partial<CanvasNodeData>) =>
    setNodes((nds) =>
      nds.map((node) =>
        node.id === id
          ? { ...node, data: { ...(node.data as CanvasNodeData), ...p } }
          : node
      )
    );
  const deleteSelf = () => setNodes((nds) => nds.filter((nd) => nd.id !== id));

  const focusNode = () =>
    fitView({ nodes: [{ id }], duration: 300, padding: 0.2, maxZoom: 1.2 });

  /* Error panel state — collapsed by default (just a one-line summary),
   *  expandable to show the raw backend error (incl. ComfyUI tracebacks).
   *  Reset to collapsed whenever a new run starts so the next failure
   *  presents fresh without the user seeing a stale expanded state.
   *
   *  2026-08-13 R83: when the error message contains ComfyUI's
   *  "Node X not found" / "OOM" / "Cannot find model" / 5xx patterns, the
   *  panel auto-expands so the user can actually see the actionable
   *  context (taskId, request payload, suggestion). */
  const [errExpanded, setErrExpanded] = useState(false);
  /* Reset to collapsed whenever a new run starts (adjusted during render,
   * React 19 pattern). */
  const [prevStatus, setPrevStatus] = useState(d.status);
  if (d.status !== prevStatus) {
    setPrevStatus(d.status);
    if (d.status === "running" || d.status === "idle") setErrExpanded(false);
  }

  /* R-ardot121 (2026-08-18): mount-time reconcile — if the node was
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
    (async () => {
      try {
        if (cancelled) return;
        const t = await vanillaApi.task.detail.query({ id: taskIdForReconcile });
        if (cancelled || !t || !t.status) return;
        if (t.status === "RUNNING") {
          // Legitimately still running on another runner — leave the node as-is.
          return;
        }
        if (t.status === "SUCCEEDED") {
          patch({
            status: "done",
            error: undefined,
            progress: 100,
            ...(t.resultImages ? { resultImages: t.resultImages as never } : {}),
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

  /* Auto-expand on structured / actionable errors so the suggestion +
   *  request-payload sections are visible without an extra click. */
  const shouldAutoExpand = (() => {
    // R-Next (2026-08-17): structured validation errors are always actionable
    //  → expand so the per-field list is visible without an extra click.
    if ((d.validationErrors?.length ?? 0) > 0) return true;
    if (!d.error) return false;
    const e = d.error;
    return /not found|not installed|out of memory|cannot find model|checkpoint.*not exists|missing\s+\w+\s+model|ValueError|IndexError|KeyError|BackendError|server_busy|insufficient/i.test(
      e
    );
  })();
  /* Auto-expand on actionable errors (adjusted during render, React 19
   *  pattern). */
  const [prevErrCtx, setPrevErrCtx] = useState(`${d.status}|${shouldAutoExpand}`);
  const errCtx = `${d.status}|${shouldAutoExpand}`;
  if (errCtx !== prevErrCtx) {
    setPrevErrCtx(errCtx);
    if (d.status === "error" && shouldAutoExpand) setErrExpanded(true);
  }

  /* Pattern-match the error text to surface a one-line actionable hint.
   *  Returns null if we don't recognize the failure shape (UI keeps the
   *  generic raw-error block instead of making up bad advice). */
  const errorSuggestion: string | null = (() => {
    const e = d.error ?? "";
    if (!e) return null;
    /* UUID-class wrapper / ComfyUI subgraph not installed */
    const uuid = e.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (uuid && /not found|not installed/i.test(e)) {
      return `wrapper 子图 (${uuid[0].slice(0, 8)}…) 找不到。自定义工作流依赖的节点未在 ComfyUI 端安装；请确认 wrapper 在源工作流里声明了相同的自定义节点包，或者回退到「无 wrapper」的 flat form 模板。`;
    }
    if (/out of memory|oom|cuda out|tried to allocate/i.test(e)) {
      return "ComfyUI 显存不足。建议：把工作流拆成更小的批次 / 关闭其他任务 / 减小图片分辨率 / 加 ControlNets 或 LoRA 占用的层数。";
    }
    if (/checkpoint.*not.*found|cannot find.*model|model.*not.*exists|FileNotFoundError.*safetensors|missing.*\.safetensors/i.test(e)) {
      return "指定的模型文件不存在。请在 ComfyUI `models/checkpoints/` 中放入该 .safetensors（或 .ckpt），或在节点参数下拉里换一个已下载的模型。";
    }
    if (/valueerror|indexerror|keyerror|prompthelperror|input type mismatch|got.*expected/i.test(e)) {
      return "ComfyUI 节点参数类型不匹配。常见原因：把 wrong type 的连线插入了强类型节点；请检查出错节点的输入端口和上游数据形状。";
    }
    if (/timeout|timed out|connection.*refused|server_busy|503|429/i.test(e)) {
      return "ComfyUI 端请求超时 / 拒绝连接。请确认本地 8188 端口的 ComfyUI 进程还活着、最近没在初始化大模型。";
    }
    return null;
  })();

  /* file upload helper */
  const fileRef = React.useRef<HTMLInputElement>(null);
  const uploadTo = React.useRef<"inputImage" | "firstFrame" | "lastFrame" | "media">("inputImage");
  const pickFile = (target: "inputImage" | "firstFrame" | "lastFrame" | "media") => {
    uploadTo.current = target;
    fileRef.current?.click();
  };
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      if (uploadTo.current === "media") {
        const { name } = await uploadMediaFile(f);
        patch({ mediaPath: name, mediaName: f.name, upstreamId: undefined });
      } else {
        const name = await uploadImageFile(f);
        patch({ [uploadTo.current]: name, upstreamId: undefined } as Partial<CanvasNodeData>);
      }
    } catch (err: any) {
      patch({ error: err?.message ?? "上传失败", status: "error" });
    }
  };

  /* ── content-carrier upload helper (picture / movie nodes) ──
   * Reuses uploadMediaFile (drops into ComfyUI input dir, returns the
   * filename). The preview URL is derived in-render from mediaPath. */
  const mediaRef = React.useRef<HTMLInputElement>(null);
  const mediaKindRef = React.useRef<"picture" | "movie">("picture");
  const pickMedia = (k: "picture" | "movie") => {
    mediaKindRef.current = k;
    mediaRef.current?.click();
  };
  const onMediaFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      const { name } = await uploadMediaFile(f);
      patch({ mediaPath: name, mediaName: f.name, upstreamId: undefined });
    } catch (err: any) {
      patch({ error: err?.message ?? "上传失败", status: "error" });
    }
  };
  /* R-ardot101 (2026-08-17): drag-and-drop upload on the dashed area.
   *  Mirrors onMediaFile but takes a `File` instead of a `<input>` change
   *  event — the ContentAssetBody passes whatever the user dropped straight
   *  here.  The hidden input + pickMedia + FAB stay intact so the bottom-
   *  right "+" remains the only click-to-upload path. */
  const onUploadFile = async (f: File) => {
    try {
      const { name } = await uploadMediaFile(f);
      patch({ mediaPath: name, mediaName: f.name, upstreamId: undefined });
    } catch (err: any) {
      patch({ error: err?.message ?? "上传失败", status: "error" });
    }
  };

  /* ── uploaded workflows list (for the workflow node) ── */
  /* 2026-08-11 R55: include `sourcePath` so the dropdown can distinguish
   *  local-on-disk imports from user-uploaded online workflows (the dot +
   *  "本机 / 在线" badge in the option label).  The DB select already
   *  exposes it; only the client type was missing. */
  const [wfList, setWfList] = useState<{ id: string; name: string; taskType?: string; sourcePath?: string | null; modelTags?: string[] }[]>([]);
  // True until the workflow list has finished loading. The dropdown must
  // NOT render "暂无工作流" (empty) while the list is still in flight.
  const [wfListLoading, setWfListLoading] = useState(true);
  // 2026-08-15: 用户级模型标签库（全局），供 WorkflowNode 的模型筛选 chip 使用
  const [modelTagLib, setModelTagLib] = useState<{ id: string; name: string; count: number }[]>([]);
  // 2026-08-15: 画布节点内的会话级模型筛选（不写 patch，仅当前节点 lifespan 生效）
  const [modelFilter, setModelFilter] = useState<string>("all");
  useEffect(() => {
    if (d.kind !== "workflow" && d.kind !== "image" && d.kind !== "video" && d.kind !== "picture") return;
    let alive = true;
    vanillaApi.workflow.list
      .query({})
      .then((dd) => {
        if (alive) setWfList((dd.workflows ?? []) as any);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setWfListLoading(false);
      });
    vanillaApi.workflowModel.list
      .query()
      .then((dd) => {
        if (alive && dd && Array.isArray(dd.tags)) setModelTagLib(dd.tags);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [d.kind]);

  /* ── dynamic IO map for the selected workflow (drives the form) ── */
  const [wfIO, setWfIO] = useState<WorkflowIOMap | null>(null);
  const [wfIOLoading, setWfIOLoading] = useState(false);
  /* R-ardot25 (2026-08-14): alongside wfIO, also keep the workflow's
   *  multi-mode config (modes[] + defaultMode) so chip3 can render
   *  按该工作流配置的动态模式列表. */
  const [wfModes, setWfModes] = useState<WorkflowModesState | null>(null);
  /* R-ardot25: 会话级「本机 / 在线 / 全部」来源筛选 — 只在画布节点组件
   *  内部 React state 持有，不写 patch（不污染 d，避免 React Flow 重渲）。
   *  默认「全部」，用户切换后只在当前节点 lifespan 内生效。 */
  const [sourceFilter, setSourceFilter] = useState<WorkflowSourceFilter>("all");
  /* Reset IO state when the node's workflow binding changes (adjusted during
   * render, React 19 pattern — keeps the effect body setState-free). */
  const ioKey = `${d.kind}|${d.workflowId ?? ""}`;
  const [prevIoKey, setPrevIoKey] = useState(ioKey);
  if (ioKey !== prevIoKey) {
    setPrevIoKey(ioKey);
    setWfIO(null);
    setWfModes(null);
    setWfIOLoading(false);
  }
  useEffect(() => {
    if ((d.kind !== "workflow" && d.kind !== "image" && d.kind !== "video" && d.kind !== "picture") || !d.workflowId) return;
    let alive = true;
    const t = setTimeout(() => {
      if (!d.workflowId) return;
      setWfIOLoading(true);
      void vanillaApi.workflow.detail
        .query({ id: d.workflowId })
        .then((dd) => {
          const tpl = dd.template;
          if (!alive || !tpl) return;
          setWfIO((tpl.workflowIO as unknown as WorkflowIOMap) ?? null);
          /* R-ardot37 模式一致性：库卡片对 `taskType` 有 fallback（仅写
           *  taskType 没声明 modes[] 的旧工作流也能展示单模式 chip），画布
           *  也走完全相同的 fallback 避免「库显示文生图 / 画布显示未选」
           *  的不一致。优先级：
           *   1) DB 的 modes[] + defaultMode（用户通过 MultiModeSelect 声明的）
           *   2) taskType 单模式兜底（向后兼容 2026-08-13 之前的旧工作流）
           *   3) 都为空才走「未选 + 该工作流没有声明可用模式」 */
          const dbModes = parseModesJson(tpl.modes);
          const dbDefault = typeof tpl.defaultMode === "string" ? tpl.defaultMode : null;
          const inferredMode =
            typeof tpl.taskType === "string" && tpl.taskType ? tpl.taskType : null;
          const modes = dbModes.length > 0
            ? dbModes
            : inferredMode
              ? [inferredMode]
              : [];
          const defaultMode =
            dbDefault && modes.includes(dbDefault)
              ? dbDefault
              : modes[0] ?? null;
          setWfModes({ modes, defaultMode });
        })
        .catch(() => {
          if (alive) setWfIO(null);
        })
        .finally(() => {
          if (alive) setWfIOLoading(false);
        });
    }, 0);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [d.kind, d.workflowId]);

  /* Seed the dynamic form with the workflow's default values once IO loads, so
   * the form is fully populated (not blank) and the generate payload carries
   * every exposed pin's current value. Re-seeds only when the workflow changes. */
  const seededFor = React.useRef<string | null>(null);
  useEffect(() => {
    if ((d.kind !== "workflow" && d.kind !== "image" && d.kind !== "video" && d.kind !== "picture") || !wfIO) return;
    if (seededFor.current === d.workflowId) return;
    seededFor.current = d.workflowId ?? null;
    const reconciled = reconcileInputValues(wfIO, d.workflowInputs ?? {});
    patch({ workflowInputs: reconciled });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wfIO, d.kind, d.workflowId]);

  /* R-ardot86 Issue 1 (2026-08-16): 当「模型标签 / 来源」筛选变化导致当前已选
   *  工作流掉出过滤列表时，把参数清空回节点初始态（与显式换工作流语义一致）。
   *  复用 WorkflowNode 同款过滤谓词（sourceFilter + modelFilter）。wfList 为空
   *  视为「仍在加载」而非「被过滤」，避免挂载瞬间误清空已选工作流。 */
  useEffect(() => {
    if ((d.kind !== "workflow" && d.kind !== "picture") || !d.workflowId) return;
    if (wfList.length === 0) return;
    // Defer out of the effect body (React 19 rule: no setState synchronously
    // within an effect).
    const t = setTimeout(() => {
      const stillVisible = wfList
        .filter((workflow) => {
          if (sourceFilter === "all") return true;
          if (sourceFilter === "local") return Boolean(workflow.sourcePath);
          return !workflow.sourcePath;
        })
        .filter((workflow) => {
          if (modelFilter === "all") return true;
          return (workflow.modelTags ?? []).includes(modelFilter);
        })
        .some((workflow) => workflow.id === d.workflowId);
      if (!stillVisible) {
        seededFor.current = null;
        setWfModes(null);
        patch({
          workflowId: undefined,
          workflowName: undefined,
          workflowTaskType: undefined,
          workflowInputs: {},
          workflowSinkId: undefined,
        });
      }
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelFilter, sourceFilter, wfList, d.kind, d.workflowId]);

  /* ── image / video generation ── */
  const runGenerate = async () => {
    // ── user-uploaded workflow node: run the chosen WorkflowTemplate ──
    if (d.kind === "workflow" || ((d.kind === "image" || d.kind === "video" || d.kind === "picture") && d.workflowId)) {
      if (!d.workflowId) {
        patch({ error: "请先选择工作流", status: "error" });
        return;
      }
      /* R-ardot103 (2026-08-17): also reset progress to 0 so the water-fill
       *  overlay starts from the bottom regardless of any stale value left
       *  from a previous run. pollTask's onProgress will tick it up as the
       *  backend reports task.progress. */
      patch({ status: "running", error: undefined, progress: 0 });
      /* 2026-08-13 R83: hoist `payload` so the catch-block can also snapshot
       *  the request into errorContext.  `null` until the try-block assigns. */
      let payload: Record<string, unknown> | null = null;
      try {
        const baseInputs = toWorkflowInputsPayload(wfIO ?? undefined, d.workflowInputs ?? {});
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
        // 2026-08-13 项目级产出：归属到当前画布项目 + 记录参考图。
        payload.projectId = getActiveId() ?? undefined;
        const refs = collectReferenceImages(d);
        if (refs.length) payload.referenceImages = refs;
        const taskId = await startGenerate(payload);
        patch({ taskId });
        setActiveTaskId(taskId);
        const result = await pollTask(taskId, undefined, (progress) => patch({ progress }));
        if (isTaskSuccess(result)) {
          // R-ardot91 (2026-08-16): picture 节点 = 图片资产本身，生成结果直接
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
                    mode: (imported ? "img2img" : "txt2img") as "img2img" | "txt2img",
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
            /* R-Next (2026-08-17): 结构化校验错误落节点数据，错误面板渲染逐字段列表 */
            validationErrors: result.validationErrors,
            /* 2026-08-13 R83: 失败面板要展示「执行了什么」 */
            errorContext: {
              request: result.params ?? payload,
              timestamp: new Date().toISOString(),
            },
          });
        }
      } catch (e: any) {
        patch({
          status: "error",
          error: e?.message ?? String(e) ?? "未捕获异常",
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
    /* R-ardot103 (2026-08-17): reset progress to 0 so the overlay starts
     *  from the bottom (same reasoning as the workflow branch above). */
    patch({ status: "running", error: undefined, progress: 0 });
    /* 2026-08-13 R83: see workflow run above; hoist payload so catch can snapshot. */
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
      // 2026-08-13 项目级产出：归属到当前画布项目 + 记录参考图。
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
          /* R-Next (2026-08-17): 结构化校验错误落节点数据 */
          validationErrors: result.validationErrors,
          errorContext: {
            request: result.params ?? payload,
            timestamp: new Date().toISOString(),
          },
        });
      }
    } catch (e: any) {
      patch({
        status: "error",
        error: e?.message ?? String(e) ?? "未捕获异常",
        errorContext: {
          request: payload,
          timestamp: new Date().toISOString(),
        },
      });
    }
  };

  /* ── render body by kind ── */
  let body: React.ReactNode = null;

  if (d.kind === "image" || d.kind === "video") {
    /* R-ardot91 (2026-08-16): 生图/生成视频节点本体即生成器 —— 复用
     *  ImageGenerationPanel（与 picture 节点同源），渲染「类型→模型→工作流」
     *  三步级联 + 参数表单 + 生成 CTA。 */
    body = (
      <ImageGenerationPanel
        kind={d.kind}
        d={d}
        patch={patch}
        wfList={wfList}
        modelTagLib={modelTagLib}
        wfIO={wfIO}
        wfIOLoading={wfIOLoading}
        wfListLoading={wfListLoading}
        seededFor={seededFor}
        setWfModes={setWfModes}
        onGenerate={runGenerate}
        onReplaceResult={() => pickFile("inputImage")}
      />
    );
  } else if (d.kind === "text" || d.kind === "movie") {
    /* ── 内容载体节点（text / movie）· 对齐 Ardot 稿 715394877779066 v2 ──
     *  边框内 ~100% 预览（视频填满、文本 textarea 填满），空状态居中类型图标 + helper；
     *  右下 36×36 圆 FAB（类型色 #FF5CA8 粉 / #FB923C 橙 + 白色图标）触发编辑/上传。
     *  Handle 全部在本组件渲染：右侧 output（同 parent 50%）。内容区与 FAB 抽离到
     *  ContentAssetBody 便于复用与单测。R-ardot73-D-port (2026-08-16)：输出 Handle
     *  直接骑跨在右侧边框 50% 处。 */
    const outStyle = d.kind === "text" ? PORT_STYLE.condition : PORT_STYLE.image;
    body = (
      <div className="relative -mx-3.5">
        {/* R-ardot73-D-port: 右侧 source Handle — 与 picture 左输入 Handle 同 parent
         *  同 top:50%，自然共 Y；对 text 用 condition（橙）/ movie 用 image（绿）。*/}
        <Handle
          type="source"
          position={Position.Right}
          id="output"
          style={{
            position: "absolute",
            right: -5,
            top: "50%",
            transform: "translateY(-50%)",
            width: 10,
            height: 10,
            background: outStyle.gradient,
            border: `1.5px solid ${outStyle.color}`,
            boxShadow: `0 0 10px ${outStyle.glow}, 0 0 0 1px rgba(255,255,255,0.08)`,
            borderRadius: 9999,
          }}
        />
        <ContentAssetBody
          kind={d.kind}
          data={d}
          onPatch={patch}
          onPickMedia={pickMedia}
          onUploadFile={onUploadFile}
          status={d.status}
          progress={d.progress}
        />
      </div>
    );
  } else if (d.kind === "picture") {
    /* R-ardot91 (2026-08-16): 图片资产 = 生图节点整体。
     *  主体永远显示预览（ContentAssetBody，含左侧 inputImage + 右侧 output Handle + FAB）；
     *  仅当选中该节点时，在预览下方展开 ImageGenerationPanel（类型→模型→工作流 + 参数 +
     *  生成 CTA）—— 即生图节点的「下半部分（除标题外）」。取消选中后下半部分隐藏，但已
     *  填写的 workflowId / workflowInputs / genModelTag 仍存于 d（patch 落库），重选即恢复，
     *  信息不丢。生成成功的图片直接写回本节点 mediaPath，由 ContentAssetBody 预览展示。 */
    const outStyle = PORT_STYLE.image;
    body = (
      <div className="space-y-2">
        <div className="relative -mx-3.5">
          {/* R-ardot59: 左侧 IMAGE input Handle — 上游工作流 outputs 连入自动接收生成图，
           *  也可作为本节点生成时的参考/底图（runGenerate 透传 d.inputImage）。 */}
          <Handle
            type="target"
            position={Position.Left}
            id="inputImage"
            style={{
              position: "absolute",
              left: -5,
              top: "50%",
              transform: "translateY(-50%)",
              width: 10,
              height: 10,
              background: PORT_STYLE.image.gradient,
              border: `1.5px solid ${PORT_STYLE.image.color}`,
              boxShadow: `0 0 10px ${PORT_STYLE.image.glow}, 0 0 0 1px rgba(255,255,255,0.08)`,
              borderRadius: 9999,
            }}
          />
          {/* 右侧 source Handle：生成结果（或上传图）作为下游 inputImage 源。*/}
          <Handle
            type="source"
            position={Position.Right}
            id="output"
            style={{
              position: "absolute",
              right: -5,
              top: "50%",
              transform: "translateY(-50%)",
              width: 10,
              height: 10,
              background: outStyle.gradient,
              border: `1.5px solid ${outStyle.color}`,
              boxShadow: `0 0 10px ${outStyle.glow}, 0 0 0 1px rgba(255,255,255,0.08)`,
              borderRadius: 9999,
            }}
          />
          <ContentAssetBody
            kind="picture"
            data={d}
            onPatch={patch}
            onPickMedia={pickMedia}
            onUploadFile={onUploadFile}
            status={d.status}
            progress={d.progress}
          />
        </div>
        {selected && (
          <div className="border-t border-white/6 pt-2">
            <ImageGenerationPanel
              kind="picture"
              d={d}
              patch={patch}
              wfList={wfList}
              modelTagLib={modelTagLib}
              wfIO={wfIO}
              wfIOLoading={wfIOLoading}
              wfListLoading={wfListLoading}
              seededFor={seededFor}
              setWfModes={setWfModes}
              onGenerate={runGenerate}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    /* R-ardot19 (2026-08-14): 选中态边框 — Card 在 selected 时加 2px 紫色
       outline + 4px offset + 紫光晕投影；非选中态保持 1px border + 低调黑
       投影。transition 150ms 让用户拖动选区时视觉平滑，border 自身不变
       （避免 1px ↔ 2px 跳。Handle 骑跨设计保留——右下紫色 Handle 圆点本
       就设计在外露 +6，与 outline-offset 4 不冲突）。*/
    <div
      /* R-ardot93-C (2026-08-17): node card width bumped 340→380 so the
       *  label column ("宽度"/"高度"/"步数"…) can render the full 2-char
       *  CJK label without competing with the stepper.  Combined with
       *  R-ardot93-B (stepper capped at max-w-[180px]) the layout is
       *  now:  [label flex-1] ……… [type chip] / [stepper ≤180]   on
       *  each workflow widget row. */
      className="relative w-[380px] rounded-[14px] border border-(--color-border-strong) bg-(--color-card) transition-[outline,box-shadow] duration-150"
      style={
        selected
          ? {
              outline: "2px solid #7C5CFC",
              outlineOffset: "4px",
              boxShadow:
                "0 0 0 1px rgba(124,92,252,0.50), 0 4px 24px rgba(124,92,252,0.30)",
            }
          : {
              boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
            }
      }
    >
      {selected && <SelectedToolbar onDelete={deleteSelf} onFocusNode={focusNode} />}
      {/* 头部按节点类型分支：自定义工作流走 Ardot 稿 v2 精确 token
       * （紫色 W 圆角方块 + 标题 + 状态胶囊）；其它节点保留通用 NodeChip。
       * 外壳严格对齐 9:27/9:61：radius12、无投影、padding20；表单区包一层
       * 暗色面板 #0B0B10/radius10/border #26262E/padding14，与头部间距 14。 */}
      {d.kind === "workflow" ? (
        <WorkflowNode
          id={id}
          data={d}
          workflowIO={wfIO}
          workflowIOLoading={wfIOLoading}
          workflowListLoading={wfListLoading}
          workflowList={wfList}
          workflowModes={wfModes}
          sourceFilter={sourceFilter}
          modelTagLib={modelTagLib}
          modelFilter={modelFilter}
          onPatch={patch}
          onSourceFilterChange={setSourceFilter}
          onModelFilterChange={setModelFilter}
          onGenerate={runGenerate}
          onSelectWorkflow={(workflowId) => {
            const wf = wfList.find((item) => item.id === workflowId);
            seededFor.current = null;
            patch({
              workflowId: workflowId || undefined,
              workflowName: wf?.name,
              workflowTaskType: wf?.taskType,
              workflowInputs: {},
              workflowSinkId: undefined,
            });
          }}
          onFormChange={(next) => patch({ workflowInputs: next })}
          onSeedModeChange={(ioKey, mode) =>
            patch({ seedModes: { ...(d.seedModes ?? {}), [ioKey]: mode } })
          }
          onModesChange={async (modes, defaultMode) => {
            /* R-ardot25: 多模式持久化 — PATCH /api/workflows/[id] 写入
             *  WorkflowTemplate.modes/defaultMode 字段；后端同时把
             *  defaultMode 同步到 taskType 列保持向后兼容。 */
            if (!d.workflowId) return;
            setWfModes({ modes, defaultMode });
            try {
              await vanillaApi.workflow.update.mutate({
                id: d.workflowId,
                modes,
                defaultMode,
              });
            } catch (err) {
              // rollback local state to avoid zombie mode chip
              setWfModes(wfModes);
              patch({
                error:
                  (err as Error)?.message ??
                  "保存模式失败，请重试",
                status: "error",
              });
            }
          }}
        />
      ) : (
        <>
          {(() => {
            /* R-ardot73-D-port (2026-08-16)：资产节点（text/picture/movie）
             * 是「内容载体」，不参与运行态，状态徽标/关闭按钮与画布语义无关 →
             * 头部只留 NodeChip。无障碍与误删保护由 SelectedToolbar 的
             * ⌫ 按钮统一承担。*/
            const isAsset = d.kind === "text" || d.kind === "picture" || d.kind === "movie";
            return (
              <div className="flex items-center justify-between gap-2 border-b border-white/6 px-3.5 py-2.5">
                <NodeChip kind={d.kind} name={meta.label} />
                {!isAsset && (
                  <div className="flex shrink-0 items-center gap-1.5">
                    <StatusDot status={d.status} />
                    <StatusBadge status={d.status} />
                    <button
                      type="button"
                      onClick={deleteSelf}
                      className="ml-1 text-gray-500 transition-colors hover:text-red-300"
                      title="删除节点"
                    >
                      <Icon name="close" size={14} />
                    </button>
                  </div>
                )}
              </div>
            );
          })()}
          <div className="px-3.5 py-2.5">{body}</div>
        </>
      )}
      {d.status === "error" && (d.error || (d.validationErrors?.length ?? 0) > 0) && (
        <div className="nodrag nopan border-t border-rose-400/20 bg-rose-500/6 px-3 py-2 text-[10.5px]">
          <div className="flex items-start gap-1.5">
            <Icon
              name="alert"
              size={12}
              className="mt-px shrink-0 text-rose-300"
            />
            <div className="min-w-0 flex-1">
              {/* Header row: status badge + workflow name + actions */}
              <div className="flex items-center justify-between gap-1.5">
                <span className="min-w-0 truncate font-medium text-rose-200">
                  {d.errorStatus === "TIMEOUT"
                    ? "轮询超时"
                    : d.errorStatus === "CANCELLED"
                      ? "任务被取消"
                      : d.errorStatus
                        ? "生成失败"
                        : "未捕获异常"}
                  <span className="ml-1 text-rose-300/60">
                    · {d.errorStatus ? `task ${d.errorStatus}` : "client"}
                  </span>
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  {d.kind === "workflow" && d.workflowName && (
                    <span
                      className="rounded border border-rose-400/15 bg-rose-400/10 px-1.5 py-0.5 font-mono text-[9.5px] text-rose-100/80"
                      title="执行的工作流"
                    >
                      {/* cast: CanvasNodeData has [key: string]: unknown
                       *  index signature that widens d.workflowName to
                       *  unknown on JSX read.  Explicit String() fixes
                       *  ReactNode compatibility for the rare wrapper
                       *  union. */}
                      {String(d.workflowName)}
                    </span>
                  )}
                  {/* Retry with the same payload.  Only enabled when there's a taskId
                   *  (i.e. a task actually ran) and we're not the pre-flight
                   *  validation errors.  Wrapped in Boolean() to keep TS happy
                   *  because `d.errorContext?.request` is typed `unknown`. */}
                  {Boolean(d.errorContext?.request) && d.taskId && (
                    <button
                      type="button"
                      onClick={() => {
                        /* 2026-08-13 R83: 直接复用上次已记录的 payload 重新跑
                         *  一遍（不发新 task）。这样用户在保存当前错误上下文
                         *  的同时，可以一键重试而无需重新输入所有字段。 */
                        const req = d.errorContext?.request;
                        void (async () => {
                          try {
                            patch({ status: "running", error: undefined });
                            const taskId = await startGenerate(req as Record<string, unknown>);
                            patch({ taskId });
                            setActiveTaskId(taskId);
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
                                /* R-Next (2026-08-17): 重试失败也带回结构化校验错误 */
                                validationErrors: result.validationErrors,
                                errorContext: {
                                  request: result.params ?? req,
                                  timestamp: new Date().toISOString(),
                                },
                              });
                            }
                          } catch (e: any) {
                            patch({
                              status: "error",
                              error: e?.message ?? String(e) ?? "重试失败",
                              errorContext: {
                                request: req,
                                timestamp: new Date().toISOString(),
                              },
                            });
                          }
                        })();
                      }}
                      className="rounded border border-rose-400/20 px-1.5 py-0.5 text-[10px] text-rose-200/80 transition-colors hover:bg-rose-400/10"
                      title="用相同参数重跑一次"
                    >
                      ↻ 重试
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setErrExpanded((value) => !value)}
                    className="rounded border border-rose-400/20 px-1.5 py-0.5 text-[10px] text-rose-200/80 transition-colors hover:bg-rose-400/10"
                    title={errExpanded ? "收起错误详情" : "展开错误详情"}
                  >
                    {errExpanded ? "▲" : "▼"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void (async () => {
                        try {
                          await navigator.clipboard.writeText(
                            JSON.stringify(
                              {
                                nodeId: id,
                                workflowId: d.workflowId ?? null,
                                workflowName: d.workflowName ?? null,
                                taskId: d.taskId ?? null,
                                errorStatus: d.errorStatus ?? null,
                                validationErrors: d.validationErrors ?? null,
                                error:
                                  typeof d.error === "string"
                                    ? d.error
                                    : (() => {
                                        try {
                                          return JSON.stringify(d.error);
                                        } catch {
                                          return String(d.error);
                                        }
                                      })(),
                                request: d.errorContext?.request ?? null,
                                ts: d.errorContext?.timestamp ?? new Date().toISOString(),
                              },
                              null,
                              2
                            )
                          );
                        } catch {
                          /* clipboard unavailable — silent; user can still
                           *  hand-expand and select the raw error text */
                        }
                      })();
                    }}
                    className="rounded border border-rose-400/20 px-1.5 py-0.5 text-[10px] text-rose-200/80 transition-colors hover:bg-rose-400/10"
                    title="复制错误详情到剪贴板（含 taskId 与请求参数）"
                  >
                    ⧉
                  </button>
                </div>
              </div>

              {/* Collapsed teaser: just the raw error string. Keeps the
               *  existing one-line behavior so users who don't need the
               *  full context don't lose vertical space. */}
              {!errExpanded && (d.validationErrors?.length ?? 0) > 0 && (
                <p className="nodrag nopan mt-1 text-[10px] font-medium text-rose-200">
                  发现 {(d.validationErrors ?? []).length} 项节点配置错误（点击 ▼ 查看明细）
                </p>
              )}
              {!errExpanded && (
                <p className="nodrag nopan mt-1 line-clamp-2 break-words text-[10px] text-rose-100/80">
                  {typeof d.error === "string"
                    ? d.error.replace(/\n/g, " ").slice(0, 200)
                    : "（点击 ▼ 展开查看完整错误）"}
                </p>
              )}

              {errExpanded && (() => {
                // 2026-08-13 R83: 重做失败面板，把「执行了什么」结构化展示。
                //
                // Defensive coerce (R67 + R69): `d.error` is typed `string`
                // but legacy rows / older code paths may have stored the
                // literal "[object Object]" (e.g. buildPromptError pre-R69
                // used `String(res.error)`) or a structured object slipped
                // through a race.  We (1) detect the literal garbage-string
                // sentinel, (2) JSON-stringify real objects, (3) fall back
                // to a generic "no detail" message.  The expanded <pre>
                // never shows literal `[object Object]`.
                const raw = d.error;
                let errText = "(no error detail)";
                if (typeof raw === "string") {
                  const trimmed = raw.trim();
                  if (
                    trimmed &&
                    trimmed !== "[object Object]" &&
                    trimmed !== "[unserializable error]"
                  ) {
                    errText = trimmed;
                  }
                } else if (raw && typeof raw === "object") {
                  try {
                    errText = JSON.stringify(raw, null, 2);
                  } catch {
                    errText = String(raw);
                  }
                }

                const ts = (() => {
                  const t = d.errorContext?.timestamp;
                  if (!t) return null;
                  const dt = new Date(t);
                  if (Number.isNaN(dt.getTime())) return t;
                  return dt.toLocaleString("zh-CN", { hour12: false });
                })();
                const hasCtx =
                  Boolean(d.taskId) ||
                  Boolean(ts) ||
                  Boolean(d.errorContext?.request) ||
                  Boolean(errorSuggestion);

                return (
                  <div className="nodrag nopan mt-1.5 space-y-1.5">
                    {/* 0) 结构化校验错误（R-Next 2026-08-17）：精确指出哪个节点哪个字段 */}
                    {(d.validationErrors?.length ?? 0) > 0 && (
                      <div className="rounded border border-rose-400/25 bg-rose-500/10 px-2 py-1.5">
                        <div className="mb-1 text-[10px] font-semibold text-rose-200">
                          节点配置校验（{(d.validationErrors ?? []).length} 项）
                        </div>
                        <ValidationErrorList errors={d.validationErrors} className="text-rose-100/90" />
                      </div>
                    )}
                    {/* 1) 任务上下文：taskId（可点击复制）+ 时间 */}
                    {hasCtx && (
                      <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 rounded border border-rose-400/15 bg-black/30 px-1.5 py-1 text-[10px]">
                        {d.taskId && (
                          <>
                            <span className="text-rose-300/60">taskId</span>
                            <button
                              type="button"
                              onClick={() =>
                                void navigator.clipboard
                                  .writeText(d.taskId!)
                                  .catch(() => {})
                              }
                              className="nodrag nopan min-w-0 truncate text-left font-mono text-rose-100/90 hover:text-rose-50"
                              title="点击复制 taskId"
                            >
                              {d.taskId}
                            </button>
                          </>
                        )}
                        {ts && (
                          <>
                            <span className="text-rose-300/60">时间</span>
                            <span className="truncate text-rose-100/80">{ts}</span>
                          </>
                        )}
                      </div>
                    )}

                    {/* 2) 自动建议 — 正则推断的纠错提示 */}
                    {errorSuggestion && (
                      <div className="rounded border border-amber-400/25 bg-amber-500/8 px-2 py-1 text-[10px] leading-relaxed text-amber-100">
                        <span className="mr-1 font-semibold text-amber-300">
                          建议
                        </span>
                        {errorSuggestion}
                      </div>
                    )}

                    {/* 3) 请求参数快照 */}
                    {d.errorContext?.request ? (
                      <details className="text-[10px]" open>
                        <summary className="cursor-pointer select-none text-rose-300/70 hover:text-rose-200">
                          请求参数
                        </summary>
                        <pre className="nodrag nopan mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded border border-rose-400/15 bg-black/50 p-1.5 font-mono text-[10px] leading-tight text-rose-100/85">
                          {typeof d.errorContext.request === "string"
                            ? d.errorContext.request
                            : (() => {
                                try {
                                  return JSON.stringify(
                                    d.errorContext.request,
                                    null,
                                    2
                                  );
                                } catch {
                                  return String(d.errorContext.request);
                                }
                              })()}
                        </pre>
                      </details>
                    ) : null}

                    {/* 4) 原始错误详情（保持旧版的 <pre> 风格） */}
                    <details className="text-[10px]" open>
                      <summary className="cursor-pointer select-none text-rose-300/70 hover:text-rose-200">
                        原始错误
                      </summary>
                      <pre className="nodrag nopan mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded border border-rose-400/15 bg-black/50 p-1.5 font-mono text-[10px] leading-tight text-rose-100/85">
                        {errText}
                      </pre>
                    </details>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onFile}
      />
      {/* content-carrier upload input — accepts both image and video */}
      <input
        ref={mediaRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={onMediaFile}
      />
      {/* R-ardot88-b (2026-08-16): 主输出端口 + 类型标签 — 改为与 WorkflowNode.outputs
       *  row 同款结构（label + typeChip + PortHandle）。image / video / script 通用。 */}
      {(d.kind === "image" || d.kind === "video" || d.kind === "script") && (
        <div className="border-t border-white/6">
          <OutputRowPort kind={d.kind} wfIO={wfIO ?? null} />
        </div>
      )}
      {/* workflow output — exposed by ComfyUI workflow as a connectable right-side
       *  source handle (matches the standard workflow-canvas endpoint styling,
       *  no separate footer row).  Colour follows the resolved output kind
       *  (IMAGE/VHS_VIDEO…) via outputTargetKind, so the handle always matches
       *  Ardot design tokens regardless of the selected workflow's task type.
       *
       *  R-ardot23 (2026-08-14): 用户反馈画布 workflow 节点右侧的紫色圆点
       *  「看起来像漏出的 bug」——workflow 节点是叶节点（生成图片/视频），
       *  在 project canvas 上不会接出到下游节点，所以这个 source Handle 实
       *  际上没人连。需要让出端口的能力由画布 IO-edit modal 提供（不在节
       *  点上外挂圆点）。直接干掉这个 Handle，只在节点外侧浮层工具栏
       *  「添加输出」里有需要时显式拖出。*/}
      {/* d.kind === "workflow" && <Handle type="source" ... /> removed (R-ardot23) */}
      {/* content-carrier output handles (text / picture / movie) — R-ardot73-D-port
          (2026-08-16): 已上移到 body wrapper 内（与 picture input Handle 同 parent），
          保持右侧 50% 与左侧同 Y；底部不再挂 footer 行，去掉「输出 · 图像」label 与装饰点。
       *  R-ardot88-b (2026-08-16): video 节点现在也走 OutputRowPort（同 image / script）
       *  — 与 WorkflowNode.outputs row 视觉对齐。agent / text / picture / movie 仍由各自
       *  body 内的 Handle 处理。 */}
      {/* agent: no output Handle */}
      {/* 调试模式：渲染链路模块标签（仅 debug-store 开启时由
       *  DebugChainFooter 自行显示，kind 决定链路）。 */}
      <DebugChainFooter modules={getProjectCanvasRenderChain(d.kind)} />
    </div>
  );
});
