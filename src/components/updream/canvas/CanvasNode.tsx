"use client";

import React, { useEffect, useState } from "react";
import { Handle, Position, useReactFlow, type NodeProps } from "@xyflow/react";
import { NumberField } from "@/components/updream/ui/NumberField";
import { DynamicWorkflowForm } from "@/components/updream/shared/DynamicWorkflowForm";
import {
  outputTargetKind,
  reconcileInputValues,
  toWorkflowInputsPayload,
  type WorkflowIOMap,
} from "@/components/updream/shared/workflow-io";
import { DarkSelect } from "@/components/updream/ui/DarkSelect";
import {
  CanvasNodeData,
  CanvasNodeType,
  NODE_META,
  IMAGE_SIZES,
  VIDEO_SIZES,
  MODEL_REGISTRY,
  getModelPreset,
  STATUS_LABEL,
  type NodeKind,
  type ModelParamSchema,
  defaultData,
} from "./canvas-types";
import { Icon } from "@/components/ui/Icon";
import {
  uploadImageFile,
  importOutputAsInput,
  startGenerate,
  pollTask,
  runScript,
  isTaskSuccess,
} from "./canvas-helpers";
import { chatAgent } from "@/lib/agent/agentic";

/* ── Small shared UI primitives ── */
const inputCls =
  "w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[12px] text-gray-200 outline-none transition-colors focus:border-violet-500/40";
const btnCls =
  "rounded-md bg-violet-500/90 px-2.5 py-1 text-[12px] font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-40";
const ghostBtnCls =
  "rounded-md border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[12px] text-gray-300 transition-colors hover:bg-white/[0.06]";

function Field({
  label,
  port,
  children,
}: {
  label: string;
  port?: { id: string; type: PortType; dir?: "in" | "out" };
  children: React.ReactNode;
}) {
  const s = port ? PORT_STYLE[port.type] : null;
  const isOut = port?.dir === "out";
  return (
    <div className="relative block">
      {/* Unified label row — relative anchor so the input Handle centers on the title */}
      <div className="relative mb-1.5 flex items-center gap-1.5">
        {port && s && !isOut && (
          <>
            <Handle
              type="target"
              position={Position.Left}
              id={port.id}
              style={{
                position: "absolute",
                width: 10,
                height: 10,
                background: s.gradient,
                border: `1.5px solid ${s.color}`,
                boxShadow: `0 0 8px ${s.glow}, 0 0 0 1px rgba(255,255,255,0.06)`,
                left: -14,
                top: "50%",
                transform: "translateY(-50%)",
                borderRadius: 9999,
              }}
            />
            <span className="text-[11px] font-medium" style={{ color: s.color }}>
              {s.label}
            </span>
          </>
        )}
        <span className="text-[11px] font-medium text-gray-300">{label}</span>
      </div>

      {/* Input area */}
      <div className="relative">
        {children}
        {port && s && isOut && (
          <>
            <span className="mt-1 flex items-center justify-end gap-1.5">
              <span className="text-[11px] font-medium" style={{ color: s.color }}>
                {s.label}
              </span>
            </span>
            <Handle
              type="source"
              position={Position.Right}
              id={port.id}
              style={{
                width: 10,
                height: 10,
                background: s.gradient,
                border: `1.5px solid ${s.color}`,
                boxShadow: `0 0 8px ${s.glow}, 0 0 0 1px rgba(255,255,255,0.08)`,
                right: -14,
                top: 1,
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}

/* ── Parameter-level port colors (粉彩渐变 6 色对应 6 类参数) ──
   灵感来源：用户偏好柔和粉彩渐变（紫粉/蓝青/黄橙/青绿/蓝紫/粉红）。
   端口用大圆点 + 渐变 + 同色发光，hover/连线时更醒目。 */
const PORT_STYLE = {
  model:    { gradient: "linear-gradient(135deg, #5BC6FF 0%, #6BEBEB 100%)", color: "#5BC6FF", glow: "rgba(91,198,255,0.55)",  label: "模型" },
  latent:   { gradient: "linear-gradient(135deg, #B584FF 0%, #FF9DCD 100%)", color: "#B584FF", glow: "rgba(181,132,255,0.55)", label: "LATENT" },
  condition:{ gradient: "linear-gradient(135deg, #FFD571 0%, #FF9C5B 100%)", color: "#FF9C5B", glow: "rgba(255,156,91,0.55)",  label: "条件" },
  negative: { gradient: "linear-gradient(135deg, #FF8FB0 0%, #FF7AC0 100%)", color: "#FF7AC0", glow: "rgba(255,122,192,0.55)", label: "负条件" },
  image:    { gradient: "linear-gradient(135deg, #5BE3C4 0%, #67E89D 100%)", color: "#5BE3C4", glow: "rgba(91,227,196,0.55)",  label: "图像" },
  seed:     { gradient: "linear-gradient(135deg, #7891FF 0%, #A584FF 100%)", color: "#A584FF", glow: "rgba(165,132,255,0.55)", label: "种子" },
  int:      { gradient: "linear-gradient(135deg, #B584FF 0%, #FF9DCD 100%)", color: "#B584FF", glow: "rgba(181,132,255,0.55)", label: "整数值" },
  float:    { gradient: "linear-gradient(135deg, #FFD571 0%, #FF9C5B 100%)", color: "#FFD571", glow: "rgba(255,213,113,0.55)", label: "浮点值" },
} as const;
type PortType = keyof typeof PORT_STYLE;

function Seg<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-md bg-white/[0.03] p-0.5 text-[11px]">
      {options.map(([v, l]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`flex-1 rounded px-2 py-1 transition-colors ${
            value === v ? "bg-violet-500/80 text-white" : "text-gray-400 hover:text-gray-200"
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

/* ── Result preview card ──
 * The card itself mimics a node: it has a top-left "type char + name" header
 * and a status badge below, so the user can read the output's identity and
 * lifecycle at a glance — the same surface that already shows on the parent
 * node.  Then comes the content (image / video / text) and a 替换 button. */
function ResultCard({
  kind,
  name,
  status,
  path,
  mediaType,
  text,
  onReplace,
}: {
  kind: NodeKind;
  name?: string;
  status: CanvasNodeData["status"];
  path?: string;
  mediaType?: string;
  text?: string;
  onReplace: () => void;
}) {
  const isVideo = kind === "video" || mediaType === "video" || (path && /\.(mp4|webm|ogg)$/i.test(path));
  const src = path?.startsWith("/") ? path : path ? `/${path}` : undefined;
  const meta = NODE_META[kind];
  const displayName = name?.trim() || meta.label;

  /* ── Text result ── */
  if (kind === "script" || kind === "agent" || (!src && text)) {
    return (
      <div className="nodrag nopan relative mt-2 overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.03]">
        {/* Header — top-left: type char + name, top-right: status badge */}
        <div className="flex items-center justify-between border-b border-white/[0.06] bg-black/15 px-2.5 py-1.5">
          <NodeChip kind={kind} name={displayName} size="sm" />
          <StatusBadge status={status} />
        </div>
        {/* Edit toolbar */}
        <div className="flex items-center justify-center gap-1 border-b border-white/[0.06] bg-black/20 px-2 py-1.5">
          <button type="button" title="字号减小" className="rounded-md px-2 py-1 text-[11px] font-medium text-gray-300 hover:bg-white/[0.06]">A-</button>
          <button type="button" title="字号增大" className="rounded-md px-2 py-1 text-[11px] font-medium text-gray-300 hover:bg-white/[0.06]">A+</button>
          <span className="mx-1 h-3 w-px bg-white/[0.08]" />
          <button type="button" title="编辑" className="rounded-md px-2 py-1 text-[11px] text-gray-300 hover:bg-white/[0.06]">
            <Icon name="pen" size={11} className="mr-1 inline align-[-1px]" />编辑
          </button>
          <button type="button" title="下载" onClick={() => text && navigator.clipboard?.writeText(text)} className="rounded-md px-2 py-1 text-[11px] text-gray-300 hover:bg-white/[0.06]">
            <Icon name="download" size={11} className="mr-1 inline align-[-1px]" />下载
          </button>
        </div>
        <div className="max-h-56 overflow-auto p-3 text-[12px] leading-relaxed text-gray-200">
          {text || <span className="text-gray-500">尚无文本输出</span>}
        </div>
        <div className="flex items-center justify-center border-t border-white/[0.06] py-2">
          <button type="button" onClick={onReplace} className="flex items-center gap-1.5 rounded-full bg-black/40 px-3 py-1.5 text-[11px] text-gray-200 ring-1 ring-white/[0.08] transition-colors hover:bg-black/60">
            <Icon name="refresh" size={11} />替换
          </button>
        </div>
      </div>
    );
  }

  /* ── Image / video result ── */
  return (
    <div className="nodrag nopan relative mt-2 overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.03]">
      {/* Header — top-left: type char + name, top-right: status badge */}
      <div className="flex items-center justify-between border-b border-white/[0.06] bg-black/15 px-2.5 py-1.5">
        <NodeChip kind={kind} name={displayName} size="sm" />
        <StatusBadge status={status} />
      </div>
      <div className="relative flex aspect-video items-center justify-center bg-gradient-to-br from-[#1a1530]/40 to-[#0f0b1c]/40">
        {!src ? (
          <Icon name={isVideo ? "film" : "image"} size={32} className="text-gray-600" />
        ) : isVideo ? (
          <video src={src} controls autoPlay loop muted className="max-h-56 w-full object-contain" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="result" className="max-h-56 w-full object-contain" />
        )}
      </div>
      <div className="flex items-center justify-center border-t border-white/[0.06] py-2">
        <button type="button" onClick={onReplace} className="flex items-center gap-1.5 rounded-full bg-black/40 px-3 py-1.5 text-[11px] text-gray-200 ring-1 ring-white/[0.08] transition-colors hover:bg-black/60">
          <Icon name="refresh" size={11} />替换
        </button>
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: CanvasNodeData["status"] }) {
  const grad =
    status === "running"
      ? "linear-gradient(135deg, #FFD571 0%, #FF9C5B 100%)"
      : status === "done"
      ? "linear-gradient(135deg, #5BE3C4 0%, #67E89D 100%)"
      : status === "error"
      ? "linear-gradient(135deg, #FF8FB0 0%, #FF7AC0 100%)"
      : "linear-gradient(135deg, #7891FF 0%, #A584FF 100%)";
  const glow =
    status === "running" ? "rgba(255,213,113,0.6)"
    : status === "done" ? "rgba(91,227,196,0.6)"
    : status === "error" ? "rgba(255,122,192,0.6)"
    : "rgba(165,132,255,0.6)";
  return (
    <span
      className="inline-block h-2.5 w-2.5 rounded-full"
      style={{ background: grad, boxShadow: `0 0 8px ${glow}` }}
    />
  );
}

/* ── Status badge (text label) ──
 * Used in the top-left header row of nodes & result cards so the user can
 * read the lifecycle state at a glance.  Color matches the status dot. */
function StatusBadge({ status }: { status: CanvasNodeData["status"] }) {
  const style =
    status === "running"
      ? "bg-amber-400/10 text-amber-300 border-amber-400/20"
      : status === "done"
      ? "bg-emerald-400/10 text-emerald-300 border-emerald-400/20"
      : status === "error"
      ? "bg-rose-400/10 text-rose-300 border-rose-400/20"
      : "bg-white/[0.05] text-gray-300 border-white/[0.08]";
  return (
    <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium ${style}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

/* ── "Type char + name" chip ──
 * Shared by the node header and the result-card header so every surface
 * displays a consistent top-left "type indicator + name" pair.  The char is
 * the kind's representative letter (T/I/V/A/W) rendered inside a circular
 * gradient that matches the kind's color. */
function NodeChip({
  kind,
  name,
  size = "md",
}: {
  kind: NodeKind;
  name: string;
  size?: "sm" | "md";
}) {
  const meta = NODE_META[kind];
  const isSm = size === "sm";
  return (
    <div className={`flex min-w-0 items-center ${isSm ? "gap-1.5" : "gap-2.5"}`}>
      <span
        className={`flex shrink-0 items-center justify-center rounded-full font-bold ${
          isSm ? "h-5 w-5 text-[10px]" : "h-6 w-6 text-[11px]"
        }`}
        style={{
          background: `linear-gradient(135deg, ${meta.color}30 0%, ${meta.color}15 100%)`,
          color: meta.color,
          boxShadow: `0 0 8px ${meta.color}33, inset 0 0 0 1px ${meta.color}40`,
        }}
        aria-label={`类型 ${meta.label}`}
      >
        {meta.typeChar}
      </span>
      <span
        className={`truncate font-semibold text-gray-100 ${
          isSm ? "text-[11px]" : "text-[13px]"
        }`}
      >
        {name}
      </span>
    </div>
  );
}

/* ── Model selector (per-node) ──
 * Renders a DarkSelect listing the available models for the node's kind.
 * Switching models updates the node's `model` field; the params below are
 * filtered by the selected model's param schema. */
function ModelSelector({
  kind,
  value,
  onChange,
}: {
  kind: NodeKind;
  value: string;
  onChange: (v: string) => void;
}) {
  const reg = MODEL_REGISTRY[kind];
  const list = reg.image.length ? reg.image : reg.video.length ? reg.video : reg.text;
  if (list.length === 0) return null;
  const current = list.find((m) => m.id === value) ?? list[0];
  return (
    <div className="flex items-center gap-1.5">
      <span className="shrink-0 text-[11px] font-medium text-gray-300">模型</span>
      <DarkSelect
        value={value || current.id}
        onChange={onChange}
        options={list.map((m) => m.id)}
        labels={Object.fromEntries(list.map((m) => [m.id, m.badge ? `${m.name} · ${m.badge}` : m.name]))}
        className="nodrag nopan"
      />
    </div>
  );
}

/* ── Main node component ── */
export function CanvasNode({ id, data }: NodeProps<CanvasNodeType>) {
  const d = data as CanvasNodeData;
  const { setNodes, getNode, setEdges } = useReactFlow();
  const meta = NODE_META[d.kind];

  const patch = (p: Partial<CanvasNodeData>) =>
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id ? { ...n, data: { ...(n.data as CanvasNodeData), ...p } } : n
      )
    );
  const deleteSelf = () => setNodes((nds) => nds.filter((n) => n.id !== id));

  /* Error panel state — collapsed by default (just a one-line summary),
   *  expandable to show the raw backend error (incl. ComfyUI tracebacks).
   *  Reset to collapsed whenever a new run starts so the next failure
   *  presents fresh without the user seeing a stale expanded state. */
  const [errExpanded, setErrExpanded] = useState(false);
  useEffect(() => {
    if (d.status === "running" || d.status === "idle") setErrExpanded(false);
  }, [d.status]);

  /* file upload helper */
  const fileRef = React.useRef<HTMLInputElement>(null);
  const uploadTo = React.useRef<"inputImage" | "firstFrame" | "lastFrame">("inputImage");
  const pickFile = (target: "inputImage" | "firstFrame" | "lastFrame") => {
    uploadTo.current = target;
    fileRef.current?.click();
  };
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      const name = await uploadImageFile(f);
      patch({ [uploadTo.current]: name, upstreamId: undefined } as Partial<CanvasNodeData>);
    } catch (err: any) {
      patch({ error: err?.message ?? "上传失败", status: "error" });
    }
  };

  /* ── uploaded workflows list (for the workflow node) ── */
  /* 2026-08-11 R55: include `sourcePath` so the dropdown can distinguish
   *  local-on-disk imports from user-uploaded online workflows (the dot +
   *  "本机 / 在线" badge in the option label).  The DB select already
   *  exposes it; only the client type was missing. */
  const [wfList, setWfList] = useState<{ id: string; name: string; taskType?: string; sourcePath?: string | null }[]>([]);
  useEffect(() => {
    if (d.kind !== "workflow") return;
    let alive = true;
    fetch("/api/workflows")
      .then((r) => r.json())
      .then((dd) => {
        if (alive) setWfList(dd.workflows ?? []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [d.kind]);

  /* ── dynamic IO map for the selected workflow (drives the form) ── */
  const [wfIO, setWfIO] = useState<WorkflowIOMap | null>(null);
  const [wfIOLoading, setWfIOLoading] = useState(false);
  useEffect(() => {
    if (d.kind !== "workflow" || !d.workflowId) {
      setWfIO(null);
      setWfIOLoading(false);
      return;
    }
    let alive = true;
    setWfIOLoading(true);
    fetch(`/api/workflows/${d.workflowId}`)
      .then((r) => r.json())
      .then((dd) => {
        if (alive) setWfIO((dd.workflowIO as WorkflowIOMap) ?? null);
      })
      .catch(() => {
        if (alive) setWfIO(null);
      })
      .finally(() => {
        if (alive) setWfIOLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [d.kind, d.workflowId]);

  /* Seed the dynamic form with the workflow's default values once IO loads, so
   * the form is fully populated (not blank) and the generate payload carries
   * every exposed pin's current value. Re-seeds only when the workflow changes. */
  const seededFor = React.useRef<string | null>(null);
  useEffect(() => {
    if (d.kind !== "workflow" || !wfIO) return;
    if (seededFor.current === d.workflowId) return;
    seededFor.current = d.workflowId ?? null;
    const reconciled = reconcileInputValues(wfIO, d.workflowInputs ?? {});
    patch({ workflowInputs: reconciled });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wfIO, d.kind, d.workflowId]);

  /* ── image / video generation ── */
  const runGenerate = async () => {
    // ── user-uploaded workflow node: run the chosen WorkflowTemplate ──
    if (d.kind === "workflow") {
      if (!d.workflowId) {
        patch({ error: "请先选择上传的工作流", status: "error" });
        return;
      }
      patch({ status: "running", error: undefined });
      try {
        const payload: Record<string, unknown> = {
          workflow: d.workflowId,
          // Exposed-pin values now drive the workflow (not the old hardcoded
          // 提示词/反向/参考图/步数/CFG/种子 fields).
          workflowInputs: toWorkflowInputsPayload(wfIO ?? undefined, d.workflowInputs ?? {}),
        };
        // Feed an upstream-generated image into this workflow (auto-chained via edge).
        if (d.inputImage) payload.inputImage = d.inputImage;
        const taskId = await startGenerate(payload);
        patch({ taskId });
        const result = await pollTask(taskId);
        if (isTaskSuccess(result)) {
          // Auto-spawn a downstream image/video node and wire it to this node's
          // output handle, so the produced media is shown + chainable. Spawn
          // once per workflow node (workflowSinkId guards re-runs).
          let sinkId = d.workflowSinkId;
          if (!sinkId) {
            const nid = `n_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            const cur = getNode(id);
            const base = cur?.position ?? { x: 0, y: 0 };
            const isVideoOut =
              outputTargetKind(wfIO ?? undefined, d.workflowTaskType) === "video";
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
                sourceHandle: "output",
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
          });
        }
      } catch (e: any) {
        patch({
          status: "error",
          error: e?.message ?? String(e) ?? "未捕获异常",
        });
      }
      return;
    }

    const isVideo = d.kind === "video";
    if (!d.prompt.trim()) {
      patch({ error: "请输入提示词", status: "error" });
      return;
    }
    patch({ status: "running", error: undefined });
    try {
      const payload: Record<string, unknown> = {
        prompt: d.prompt,
        negative: d.negative || undefined,
        size: d.size,
        steps: d.steps,
        cfg: d.cfg,
      };
      if (d.seed.trim()) payload.seed = Number(d.seed);
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
        });
      }
    } catch (e: any) {
      patch({
        status: "error",
        error: e?.message ?? String(e) ?? "未捕获异常",
      });
    }
  };

  /* ── agent generation (uses spec) ── */
  const runAgentGenerate = async () => {
    const spec = d.agentSpec;
    if (!spec) return;
    patch({ status: "running" });
    try {
      const isVid = spec.kind === "video";
      const payload: Record<string, unknown> = {
        prompt: spec.prompt,
        negative: spec.negative || undefined,
        size: spec.params?.size || (isVid ? "832x480" : "1024x1024"),
        steps: spec.params?.steps || 25,
        cfg: spec.params?.cfg || (isVid ? 6 : 7),
      };
      payload.workflow = isVid ? "txt2video" : "txt2img";
      const taskId = await startGenerate(payload);
      const result = await pollTask(taskId);
      if (isTaskSuccess(result)) {
        patch({
          status: "done",
          resultPath: result.localPath,
          resultMediaType: result.mediaType,
        });
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
        });
      }
    } catch (e: any) {
      patch({
        status: "error",
        error: e?.message ?? String(e) ?? "未捕获异常",
      });
    }
  };

  /* ── agent chat ── */
  const [agentInput, setAgentInput] = useState("");
  const sendAgent = async () => {
    const text = agentInput.trim();
    if (!text) return;
    const history = [...d.agentHistory, { role: "user" as const, content: text }];
    patch({ agentHistory: history, agentReply: "思考中…", status: "running" });
    setAgentInput("");
    const res = await chatAgent(history);
    patch({
      agentHistory: [...history, { role: "assistant" as const, content: res.reply }],
      agentReply: res.reply,
      agentReady: res.ready,
      agentSpec: res.spec,
      status: res.ready ? "done" : "idle",
    });
  };

  /* ── script generation ── */
  const genScript = async () => {
    if (!d.theme.trim()) {
      patch({ error: "请输入主题或梗概", status: "error" });
      return;
    }
    patch({ status: "running" });
    try {
      const text = await runScript(d.theme);
      patch({ scriptText: text, status: "done" });
    } catch (e: any) {
      patch({ status: "error", error: e?.message ?? "生成失败" });
    }
  };

  /* script → spawn a video node from the script */
  const addVideoFromScript = () => {
    if (!d.scriptText) return;
    const nid = `n_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const cur = getNode(id);
    const base = cur?.position ?? { x: 0, y: 0 };
    const node: CanvasNodeType = {
      id: nid,
      type: "canvasNode",
      position: { x: base.x + 340, y: base.y },
      data: {
        ...defaultData("video"),
        prompt: d.scriptText.replace(/\n+/g, " ").slice(0, 400),
        mode: "t2v",
      },
    };
    setNodes((nds) => [...nds, node]);
  };

  /* ── render body by kind ── */
  let body: React.ReactNode = null;

  if (d.kind === "image" || d.kind === "video") {
    const isVideo = d.kind === "video";
    const sizes = isVideo ? VIDEO_SIZES : IMAGE_SIZES;
    /* Resolve the active model & its param schema (image + script are
     * chainable per user spec; video has no connection ports for now). */
    const preset = getModelPreset(d.kind, d.model);
    const ps: ModelParamSchema = preset?.params ?? {};
    const chainable = !isVideo; // image has ports, video doesn't
    body = (
      <div className="space-y-2">
        {/* Result card at top so the user sees the product first */}
        <ResultCard
          kind={d.kind}
          name={preset?.name}
          status={d.status}
          path={d.resultPath}
          mediaType={d.resultMediaType}
          onReplace={() => pickFile("inputImage")}
        />

        {/* Mode tabs */}
        <Field label="模式">
          {isVideo ? (
            <Seg
              value={d.mode as "t2v" | "i2v" | "flf"}
              options={[
                ["t2v", "文生视频"],
                ["i2v", "图生视频"],
                ["flf", "首尾帧"],
              ]}
              onChange={(v) => patch({ mode: v })}
            />
          ) : (
            <Seg
              value={d.mode as "txt2img" | "img2img"}
              options={[
                ["txt2img", "文生图"],
                ["img2img", "图生图"],
              ]}
              onChange={(v) => patch({ mode: v })}
            />
          )}
        </Field>

        {/* Reference-image upload (only when in a referencing mode + image/video supports it) */}
        {(d.mode === "img2img" ||
          (isVideo && d.mode === "i2v") ||
          (isVideo && d.mode === "flf")) && (
          <Field label="参考图" port={chainable ? { id: "inputImage", type: "image" } : undefined}>
            <div className="space-y-1">
              {d.mode === "img2img" && (
                <button type="button" className={ghostBtnCls} onClick={() => pickFile("inputImage")}>
                  {d.inputImage ? `参考图：${d.inputImage}` : "上传参考图"}
                </button>
              )}
              {isVideo && d.mode === "i2v" && (
                <button type="button" className={ghostBtnCls} onClick={() => pickFile("inputImage")}>
                  {d.inputImage ? `首帧：${d.inputImage}` : "上传首帧参考图"}
                </button>
              )}
              {isVideo && d.mode === "flf" && (
                <div className="flex gap-1">
                  <button type="button" className={ghostBtnCls} onClick={() => pickFile("firstFrame")}>
                    {d.firstFrame ? `首帧✓` : "首帧图"}
                  </button>
                  <button type="button" className={ghostBtnCls} onClick={() => pickFile("lastFrame")}>
                    {d.lastFrame ? `尾帧✓` : "尾帧图"}
                  </button>
                </div>
              )}
            </div>
          </Field>
        )}

        {d.upstreamId && (
          <div className="flex items-center gap-1">
            <span className="rounded bg-emerald-400/10 px-1.5 py-0.5 text-[10px] text-emerald-300">
              ⇠ 已接收上游输出
            </span>
            <button
              type="button"
              className={ghostBtnCls}
              onClick={() => patch({ inputImage: undefined, upstreamId: undefined })}
            >
              断开
            </button>
          </div>
        )}

        {/* Model selector — swaps param set on change */}
        <ModelSelector kind={d.kind} value={d.model} onChange={(v) => patch({ model: v })} />

        {/* Prompt (only when model exposes it) */}
        {ps.prompt && (
          <Field label="提示词" port={chainable ? { id: "prompt", type: "condition" } : undefined}>
            <textarea
              className={inputCls}
              rows={3}
              value={d.prompt}
              placeholder="描述你想要画面…"
              onChange={(e) => patch({ prompt: e.target.value })}
            />
          </Field>
        )}

        {/* Negative (only when model exposes it) */}
        {ps.negative && (
          <Field label="反向提示词" port={chainable ? { id: "negative", type: "negative" } : undefined}>
            <input
              className={inputCls}
              value={d.negative}
              placeholder="可选"
              onChange={(e) => patch({ negative: e.target.value })}
            />
          </Field>
        )}

        {/* Size + sampling params (rendered only when the active model exposes them) */}
        <div className="grid grid-cols-2 gap-2">
          {ps.size && (
            <Field label="尺寸">
              <DarkSelect value={d.size} onChange={(v) => patch({ size: v })} options={sizes} />
            </Field>
          )}
          {ps.frames && (
            <Field label="帧数" port={chainable ? { id: "frames", type: "int" } : undefined}>
              <NumberField value={d.frames} onChange={(v) => patch({ frames: v })} min={17} max={241} step={2} />
            </Field>
          )}
          {ps.fps && (
            <Field label="帧率" port={chainable ? { id: "fps", type: "int" } : undefined}>
              <NumberField value={d.fps} onChange={(v) => patch({ fps: v })} min={8} max={30} step={1} />
            </Field>
          )}
          {ps.steps && (
            <Field label="步数" port={chainable ? { id: "steps", type: "int" } : undefined}>
              <NumberField value={d.steps} onChange={(v) => patch({ steps: v })} min={1} max={100} step={1} />
            </Field>
          )}
          {ps.cfg && (
            <Field label="CFG" port={chainable ? { id: "cfg", type: "float" } : undefined}>
              <NumberField value={d.cfg} onChange={(v) => patch({ cfg: v })} min={0} max={30} step={0.5} decimalPlaces={1} />
            </Field>
          )}
        </div>

        {/* Seed */}
        {ps.seed && (
          <Field label="种子（留空随机）" port={chainable ? { id: "seed", type: "seed" } : undefined}>
            <input
              className={inputCls}
              value={d.seed}
              placeholder="random"
              onChange={(e) => patch({ seed: e.target.value })}
            />
          </Field>
        )}

        <button type="button" className={btnCls + " mx-auto block w-auto px-6"} disabled={d.status === "running"} onClick={runGenerate}>
          {d.status === "running" ? "生成中…" : `▶ 生成${isVideo ? "视频" : "图像"}`}
        </button>
      </div>
    );
  } else if (d.kind === "script") {
    body = (
      <div className="space-y-2">
        {/* Result card on top — text output preview with edit toolbar */}
        <ResultCard
          kind="script"
          name={d.theme.split("\n")[0]?.trim() || undefined}
          status={d.status}
          text={d.scriptText}
          onReplace={() => patch({ scriptText: undefined, status: "idle" })}
        />

        {/* Model selector (LLM model) */}
        <ModelSelector kind="script" value={d.model} onChange={(v) => patch({ model: v })} />

        {/* Theme / 梗概 input — chainable so other nodes can feed it */}
        <Field label="主题 / 梗概" port={{ id: "theme", type: "condition" }}>
          <textarea
            className={inputCls}
            rows={2}
            value={d.theme}
            placeholder="例如：一个老人重拾年轻时的音乐梦"
            onChange={(e) => patch({ theme: e.target.value })}
          />
        </Field>

        <button type="button" className={btnCls + " w-full"} disabled={d.status === "running"} onClick={genScript}>
          {d.status === "running" ? "扩写中…" : (<><Icon name="pen" size={12} className="mr-1 inline align-[-1px]" />生成剧本</>)}
        </button>

        {d.scriptText && (
          <button type="button" className={btnCls + " w-full"} onClick={addVideoFromScript}>
            → 生成视频节点
          </button>
        )}
      </div>
    );
  } else if (d.kind === "workflow") {
    const sinkKind = outputTargetKind(wfIO ?? undefined, d.workflowTaskType);
    const hasResult = Boolean(d.resultPath || d.resultMediaType);
    body = (
      <div className="space-y-2">
        {/* Result card — only after the first generation.  Pre-generation the
            card was a misleading empty preview with a "替换" button that didn't
            do anything useful. */}
        {hasResult && (
          <ResultCard
            kind="workflow"
            name={d.workflowName}
            status={d.status}
            path={d.resultPath}
            mediaType={d.resultMediaType}
            onReplace={() => patch({ resultPath: undefined, resultMediaType: undefined, status: "idle" })}
          />
        )}

        <Field label="选择上传的工作流">
          <DarkSelect
            value={d.workflowId ?? ""}
            onChange={(v) => {
              const wf = wfList.find((w) => w.id === v);
              seededFor.current = null;
              patch({
                workflowId: v || undefined,
                workflowName: wf?.name,
                workflowTaskType: wf?.taskType,
                workflowInputs: {},
                workflowSinkId: undefined,
              });
            }}
            options={["", ...wfList.map((w) => w.id)]}
            /* 2026-08-11 R55: per-option rich label — a coloured dot
             *  (emerald = 本机导入 / violet = 在线导入) plus a small text
             *  badge, so users can tell at a glance whether the workflow
             *  was imported from their disk (`sourcePath` non-empty) or
             *  uploaded from the cloud.  Local rows are arbitrarily
             *  abundant and durable; online rows track the remote
             *  origin.  The visual matches the colour vocabulary used
             *  elsewhere (canvas-types.ts: workflow=violet). */
            labels={Object.fromEntries(
              wfList.map((w) => {
                const local = Boolean(w.sourcePath);
                return [
                  w.id,
                  <span key={w.id} className="flex min-w-0 flex-1 items-center gap-1.5">
                    <span
                      className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                        local ? "bg-emerald-400" : "bg-violet-400"
                      }`}
                      aria-hidden="true"
                    />
                    {/* min-w-0 lets this flex item shrink below its
                     *  intrinsic content width so long names ellipsise
                     *  instead of pushing the badge off-screen. */}
                    <span className="min-w-0 flex-1 truncate">{w.name}</span>
                    {w.taskType && (
                      <span className="shrink-0 text-[10px] opacity-60">（{w.taskType}）</span>
                    )}
                    <span
                      className={`ml-auto inline-block shrink-0 rounded px-1 py-px text-[9px] font-medium tracking-wide ${
                        local
                          ? "bg-emerald-500/15 text-emerald-300"
                          : "bg-violet-500/15 text-violet-300"
                      }`}
                    >
                      {local ? "本机" : "在线"}
                    </span>
                  </span>,
                ];
              })
            )}
            placeholder="— 请选择工作流 —"
          />
        </Field>
        {wfList.length === 0 && (
          <p className="text-[11px] text-gray-500">
            暂无上传工作流。请先在「创作台 / 工作区」粘贴 ComfyUI「导出(API 格式)」JSON 导入。
          </p>
        )}
        {d.workflowTaskType && (
          <span className="inline-block rounded bg-violet-400/10 px-1.5 py-0.5 text-[10px] text-violet-300">
            类型：{d.workflowTaskType}
          </span>
        )}
        {d.workflowName && (
          <p className="truncate text-[11px] text-gray-400">已选：{d.workflowName}</p>
        )}

        {/* Upstream image chaining.  The dedicated handle was previously
            a fixed `inputImage` port on every workflow node — but it ignored
            the user's curated IO and confused reviewers.  It's now fully
            driven by DynamicWorkflowForm: workflows that expose image inputs
            get image pins; everything else just runs without a hidden slot. */}

        {/* Dynamic form — strictly driven by the workflow's exposed IO. */}
        <DynamicWorkflowForm
          io={wfIO ?? undefined}
          loading={wfIOLoading}
          values={d.workflowInputs ?? {}}
          onChange={(next) => patch({ workflowInputs: next })}
          compact
          showOutputs
        />

        <button type="button" className={btnCls + " mx-auto block w-auto px-6"} disabled={d.status === "running"} onClick={runGenerate}>
          {d.status === "running" ? "生成中…" : "▶ 用此工作流生成"}
        </button>
      </div>
    );
  } else if (d.kind === "agent") {
    body = (
      <div className="space-y-2">
        {/* Result card at top — shows last agent reply as text preview */}
        <ResultCard
          kind="agent"
          status={d.status}
          text={d.agentReply || (d.agentHistory.length ? d.agentHistory[d.agentHistory.length - 1].content : undefined)}
          onReplace={() => patch({ agentHistory: [], agentReply: undefined, agentSpec: undefined, status: "idle" })}
        />

        {/* Model selector */}
        <ModelSelector kind="agent" value={d.model} onChange={(v) => patch({ model: v })} />

        {/* Chat history (compact, scrollable) */}
        <div className="max-h-40 space-y-1 overflow-auto rounded-md border border-white/[0.08] bg-white/[0.03] p-2">
          {d.agentHistory.length === 0 && (
            <p className="text-[11px] text-gray-500">点击下方发送，开始多轮对话引导创作。</p>
          )}
          {d.agentHistory.map((m, i) => (
            <div
              key={i}
              className={`text-[11px] leading-relaxed ${
                m.role === "user" ? "text-violet-300" : "text-gray-300"
              }`}
            >
              <span className="opacity-60">{m.role === "user" ? "你：" : "AI："}</span>
              {m.content}
            </div>
          ))}
        </div>

        <div className="flex gap-1">
          <input
            className={inputCls}
            value={agentInput}
            placeholder="说点什么…"
            onChange={(e) => setAgentInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") sendAgent();
            }}
          />
          <button type="button" className={btnCls} onClick={sendAgent}>
            发送
          </button>
        </div>
        {d.agentReady && d.agentSpec && (
          <div className="rounded-md border border-emerald-400/30 bg-emerald-400/[0.06] p-2">
            <p className="mb-1 text-[11px] text-emerald-300">方案就绪（{d.agentSpec.kind === "video" ? "视频" : "图片"}）</p>
            <p className="mb-2 line-clamp-2 text-[11px] text-gray-300">{d.agentSpec.prompt}</p>
            <button type="button" className={btnCls + " w-full"} disabled={d.status === "running"} onClick={runAgentGenerate}>
              {d.status === "running" ? "生成中…" : "▶ 按方案生成"}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="w-[300px] rounded-2xl border border-white/[0.08] bg-[#14121f]/95 shadow-lg shadow-black/30 backdrop-blur-sm"
    >
      {/* 顶部头部 — 统一格式：左上角 圆形类型字符 + 名称；右上角 状态徽章 + 关闭 */}
      <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] px-3.5 py-2.5">
        <NodeChip kind={d.kind} name={meta.label} />
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
      </div>
      <div className="px-3.5 py-2.5">{body}</div>
      {d.error && d.status === "error" && (
        <div className="nodrag nopan border-t border-rose-400/20 bg-rose-500/[0.06] px-3 py-1.5 text-[10.5px]">
          <div className="flex items-start gap-1.5">
            <Icon
              name="alert"
              size={12}
              className="mt-px shrink-0 text-rose-300"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-1.5">
                <span className="truncate font-medium text-rose-200">
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
                <button
                  type="button"
                  onClick={() => setErrExpanded((v) => !v)}
                  className="shrink-0 rounded border border-rose-400/20 px-1.5 py-0.5 text-[10px] text-rose-200/80 transition-colors hover:bg-rose-400/10"
                  title={errExpanded ? "收起错误详情" : "展开错误详情"}
                >
                  {errExpanded ? "▲ 收起" : "▼ 展开"}
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
                              taskId: d.taskId ?? null,
                              errorStatus: d.errorStatus ?? null,
                              error: d.error ?? null,
                              ts: new Date().toISOString(),
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
                  className="shrink-0 rounded border border-rose-400/20 px-1.5 py-0.5 text-[10px] text-rose-200/80 transition-colors hover:bg-rose-400/10"
                  title="复制错误详情到剪贴板（含 taskId）"
                >
                  ⧉ 复制
                </button>
              </div>
              {errExpanded && (
                <pre className="nodrag nopan mt-1 max-h-32 overflow-auto rounded border border-rose-400/15 bg-black/40 p-1.5 font-mono text-[10px] leading-tight text-rose-100/90">
                  {d.error}
                </pre>
              )}
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
      {/* 主输出端口 + 类型标签 — 仅 image 和 script 节点保留（用户要求：只有文本和图像需要连线） */}
      {d.kind === "image" && (
        <div className="relative flex items-center justify-end gap-1.5 border-t border-white/[0.06] px-3.5 py-2 text-[11px]">
          <span className="font-medium" style={{ color: PORT_STYLE.image.color }}>
            输出 · {PORT_STYLE.image.label}
          </span>
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{
              background: PORT_STYLE.image.gradient,
              boxShadow: `0 0 8px ${PORT_STYLE.image.glow}`,
            }}
          />
          <Handle
            type="source"
            position={Position.Right}
            id="output"
            style={{
              position: "absolute",
              right: -7,
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
        </div>
      )}
      {d.kind === "script" && (
        <div className="relative flex items-center justify-end gap-1.5 border-t border-white/[0.06] px-3.5 py-2 text-[11px]">
          <span className="font-medium" style={{ color: PORT_STYLE.condition.color }}>
            输出 · {PORT_STYLE.condition.label}
          </span>
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{
              background: PORT_STYLE.condition.gradient,
              boxShadow: `0 0 8px ${PORT_STYLE.condition.glow}`,
            }}
          />
          <Handle
            type="source"
            position={Position.Right}
            id="output"
            style={{
              position: "absolute",
              right: -7,
              top: "50%",
              transform: "translateY(-50%)",
              width: 10,
              height: 10,
              background: PORT_STYLE.condition.gradient,
              border: `1.5px solid ${PORT_STYLE.condition.color}`,
              boxShadow: `0 0 10px ${PORT_STYLE.condition.glow}, 0 0 0 1px rgba(255,255,255,0.08)`,
              borderRadius: 9999,
            }}
          />
        </div>
      )}
      {/* workflow output handle — kind (image/video) follows the exposed output pin */}
      {d.kind === "workflow" && (() => {
        const isVideoOut =
          outputTargetKind(wfIO ?? undefined, d.workflowTaskType) === "video";
        const style = isVideoOut ? PORT_STYLE.condition : PORT_STYLE.image;
        return (
          <div className="relative flex items-center justify-end gap-1.5 border-t border-white/[0.06] px-3.5 py-2 text-[11px]">
            <span className="font-medium" style={{ color: style.color }}>
              输出 · {style.label}
            </span>
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: style.gradient, boxShadow: `0 0 8px ${style.glow}` }}
            />
            <Handle
              type="source"
              position={Position.Right}
              id="output"
              style={{
                position: "absolute",
                right: -7,
                top: "50%",
                transform: "translateY(-50%)",
                width: 10,
                height: 10,
                background: style.gradient,
                border: `1.5px solid ${style.color}`,
                boxShadow: `0 0 10px ${style.glow}, 0 0 0 1px rgba(255,255,255,0.08)`,
                borderRadius: 9999,
              }}
            />
          </div>
        );
      })()}
      {/* video / agent: no output Handle */}
    </div>
  );
}
