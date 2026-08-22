"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getWorkflow } from "@/lib/comfyui/_meta";
import { SkillSelector } from "@/components/skill";
import type { SkillData } from "@/components/skill";
import dynamic from "next/dynamic";
import { DarkSelect } from "@/components/updream/ui/DarkSelect";
import { NumberField } from "@/components/updream/ui/NumberField";
import { api } from "~/trpc/react";

// Lazy-load the heavy ReactFlow canvas (only needed for custom workflows)
const WorkflowCanvas = dynamic(
  () => import("@/components/workflow-canvas").then((m) => ({ default: m.WorkflowCanvas })),
  { ssr: false }
);

type ModelOpt = { id: string; fileName: string; name: string };
type WorkflowOpt = { id: string; name: string; taskType: string };
type LogEntry = { t: number; level: "info" | "progress" | "warn" | "error" | "success"; msg: string };
type ParamMap = {
  positiveNode?: string;
  negativeNode?: string;
  checkpointNode?: string;
  samplerNode?: string;
};
type WfNode = { id: string; class_type: string; title: string };
type WfDetail = { graph: Record<string, any>; nodes: WfNode[]; paramMap: ParamMap };

const LOG_STYLE: Record<LogEntry["level"], string> = {
  info: "text-muted",
  progress: "text-primary",
  warn: "text-amber-500",
  error: "text-red-500",
  success: "text-emerald-500",
};

const SAMPLERS = ["euler", "euler_ancestral", "dpmpp_2m", "dpmpp_2m_sde", "ddim", "uni_pc"];
const SCHEDULERS = ["normal", "karras", "exponential", "simple", "beta"];
const SIZES = ["1024x1024", "768x768", "512x512", "832x1216", "1216x832", "1344x768"];

const ROLE_COLORS: Record<string, string> = {
  positiveNode: "#7c5cff",
  negativeNode: "#f59e0b",
  checkpointNode: "#a855f7",
  samplerNode: "#10b981",
};

// Layered left→right layout for the imported ComfyUI node graph preview.
function computeLayout(graph: Record<string, any>) {
  const ids = Object.keys(graph);
  const succ: Record<string, string[]> = {};
  ids.forEach((id) => (succ[id] = []));
  for (const id of ids) {
    const inputs = graph[id]?.inputs || {};
    for (const v of Object.values(inputs)) {
      if (Array.isArray(v) && typeof v[0] === "string" && graph[v[0]]) succ[id]!.push(v[0]);
    }
  }
  const layer: Record<string, number> = {};
  const visiting: Record<string, boolean> = {};
  const dfs = (id: string): number => {
    if (layer[id] !== undefined) return layer[id];
    if (visiting[id]) return 0;
    visiting[id] = true;
    let l = 0;
    for (const s of succ[id]!) l = Math.max(l, dfs(s) + 1);
    visiting[id] = false;
    layer[id] = l;
    return l;
  };
  ids.forEach(dfs);

  const byLayer: Record<number, string[]> = {};
  ids.forEach((id) => {
    (byLayer[layer[id]!] ||= []).push(id);
  });
  const maxLayer = ids.length ? Math.max(...ids.map((i) => layer[i]!)) : 0;

  const colW = 196;
  const rowH = 66;
  const padX = 16;
  const padY = 16;
  const NODE_W = 158;
  const NODE_H = 48;
  const pos: Record<string, { x: number; y: number }> = {};
  for (let L = maxLayer; L >= 0; L--) {
    const arr = byLayer[L] || [];
    arr.forEach((id, idx) => {
      pos[id] = { x: padX + (maxLayer - L) * colW, y: padY + idx * rowH };
    });
  }

  const maxRows = Math.max(1, ...Object.values(byLayer).map((a) => a.length));
  const width = padX * 2 + maxLayer * colW + NODE_W;
  const height = padY * 2 + maxRows * rowH;

  const edges: { from: string; to: string }[] = [];
  for (const id of ids) {
    const inputs = graph[id]?.inputs || {};
    for (const v of Object.values(inputs)) {
      if (Array.isArray(v) && typeof v[0] === "string" && graph[v[0]]) {
        edges.push({ from: v[0], to: id });
      }
    }
  }
  return { pos, edges, width, height, NODE_W, NODE_H };
}

type Tab = "txt2img" | "img2img" | "custom";

export function CreateStudio() {
  const [tab, setTab] = useState<Tab>("txt2img");
  const [prompt, setPrompt] = useState("");
  const [negative, setNegative] = useState("");
  const [checkpoint, setCheckpoint] = useState("");
  const [loras, setLoras] = useState<{ name: string; weight: number }[]>([]);
  const [sampler, setSampler] = useState("euler");
  const [scheduler, setScheduler] = useState("normal");
  const [steps, setSteps] = useState(25);
  const [cfg, setCfg] = useState(7);
  const [size, setSize] = useState("1024x1024");
  const [count, setCount] = useState(1);
  const [seed, setSeed] = useState("");
  const [denoise, setDenoise] = useState(0.65);
  const [inputImage, setInputImage] = useState("");

  const [checkpoints, setCheckpoints] = useState<ModelOpt[]>([]);
  const [loraOpts, setLoraOpts] = useState<ModelOpt[]>([]);
  const [customWorkflows, setCustomWorkflows] = useState<WorkflowOpt[]>([]);
  const [customId, setCustomId] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [importName, setImportName] = useState("");
  const [importJson, setImportJson] = useState("");
  const [importError, setImportError] = useState("");

  const [wfDetail, setWfDetail] = useState<WfDetail | null>(null);
  const [paramMap, setParamMap] = useState<ParamMap>({});
  const [savingMap, setSavingMap] = useState(false);
  const [graphFullscreen, setGraphFullscreen] = useState(false);
  const [canvasGraph, setCanvasGraph] = useState<Record<string, any> | null>(null);
  const canvasRef = useRef<{ getGraph: () => Record<string, any> } | null>(null);

  // ── Skill system ──
  const [selectedSkill, setSelectedSkill] = useState<SkillData | null>(null);

  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [taskId, setTaskId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const ckptQ = api.model.list.useQuery({ type: "CHECKPOINT" });
  const loraQ = api.model.list.useQuery({ type: "LORA" });
  const workflowsQ = api.workflow.list.useQuery();
  const wfDetailQ = api.workflow.detail.useQuery({ id: customId }, { enabled: !!customId });
  const createWf = api.workflow.create.useMutation();
  const updateWf = api.workflow.update.useMutation();
  const gen = api.generate.generate.useMutation();
  const utils = api.useUtils();

  const workflowLabel =
    tab === "custom"
      ? customWorkflows.find((w) => w.id === customId)?.name ?? "自定义工作流"
      : getWorkflow(tab)?.label ?? tab;

  const layout = useMemo(
    () => (wfDetail ? computeLayout(wfDetail.graph) : null),
    [wfDetail]
  );

  const clipNodes = wfDetail?.nodes.filter((n) => n.class_type === "CLIPTextEncode") ?? [];
  const ckptNodes = wfDetail?.nodes.filter((n) => n.class_type === "CheckpointLoaderSimple") ?? [];
  const ksNodes = wfDetail?.nodes.filter((n) => n.class_type === "KSampler") ?? [];

  useEffect(() => {
    if (ckptQ.data) setCheckpoints(ckptQ.data.models ?? []);
  }, [ckptQ.data]);
  useEffect(() => {
    if (loraQ.data) setLoraOpts(loraQ.data.models ?? []);
  }, [loraQ.data]);
  useEffect(() => {
    if (workflowsQ.data) setCustomWorkflows(workflowsQ.data.workflows ?? []);
  }, [workflowsQ.data]);

  // Close fullscreen graph on Escape.
  useEffect(() => {
    if (!graphFullscreen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setGraphFullscreen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [graphFullscreen]);

  // Load detail (graph + node mapping) when a custom workflow is selected.
  useEffect(() => {
    if (!customId) {
      setWfDetail(null);
      setParamMap({});
      return;
    }
    const tpl = wfDetailQ.data?.template;
    if (tpl?.graph) {
      const nodes = Object.entries(tpl.graph as unknown as Record<string, any>).map(([id, n]) => ({
        id,
        class_type: n?.class_type ?? "",
        title: n?._meta?.title ?? n?.class_type ?? id,
      }));
      const pm = (tpl.paramMap ?? {}) as ParamMap;
      setWfDetail({ graph: tpl.graph as unknown as Record<string, any>, nodes, paramMap: pm });
      setParamMap(pm);
    }
  }, [customId, wfDetailQ.data]);

  async function onUpload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const d = await res.json();
      if (d.name) setInputImage(d.name);
      else setError(d.error ?? "上传失败");
    } finally {
      setUploading(false);
    }
  }

  async function importWorkflow() {
    setImportError("");
    if (!importJson.trim()) {
      setImportError("请粘贴或上传工作流 JSON");
      return;
    }
    let graph: unknown;
    try {
      graph = JSON.parse(importJson);
    } catch {
      setImportError("JSON 解析失败，请检查格式");
      return;
    }
    let d: { id: string; name: string; taskType: string };
    try {
      d = await createWf.mutateAsync({ name: importName || "未命名工作流", graph: graph as any });
    } catch (e: any) {
      setImportError(e?.message ?? "导入失败");
      return;
    }
    setCustomWorkflows((prev) => [...prev, { id: d.id, name: d.name, taskType: d.taskType }]);
    setCustomId(d.id);
    setTab("custom");
    setShowImport(false);
    setImportJson("");
    setImportName("");
  }

  // Update one role mapping and persist it to the template.
  function updateRole(role: keyof ParamMap, value: string) {
    setParamMap((prev) => {
      const next = { ...prev };
      if (value) next[role] = value;
      else delete next[role];
      // Persist asynchronously.
      if (customId) {
        setSavingMap(true);
        updateWf
          .mutateAsync({ id: customId, paramMap: next })
          .catch(() => {})
          .finally(() => setSavingMap(false));
      }
      return next;
    });
  }

  async function generate() {
    setError("");
    if (tab === "custom") {
      if (!customId) {
        setError("请先选择或导入一个自定义工作流");
        return;
      }
    } else if (!checkpoint) {
      setError("请先选择一个大模型（Checkpoint）");
      return;
    }
    if (!prompt.trim()) {
      setError("请输入正向提示词");
      return;
    }
    if (tab === "img2img" && !inputImage) {
      setError("请先上传参考图");
      return;
    }

    const payload: Record<string, unknown> = {
      workflow: tab === "custom" ? customId : tab,
      prompt: prompt.trim(),
      negative: negative.trim() || undefined,
    };
    // Attach selected skill metadata
    if (selectedSkill) {
      payload.skillId = selectedSkill.id;
      payload.skillName = selectedSkill.name;
      payload.skillSlug = selectedSkill.slug;
    }
    if (tab === "custom") {
      // If canvas has edited graph, pass it as override
      if (canvasGraph && Object.keys(canvasGraph).length) {
        payload.canvasGraph = canvasGraph;
      }
      if (Object.keys(paramMap).length) payload.paramMap = paramMap;
      if (checkpoint) payload.checkpoint = checkpoint;
      Object.assign(payload, { steps, cfg, sampler, scheduler });
      if (seed) payload.seed = Number(seed);
    } else {
      Object.assign(payload, {
        checkpoint,
        sampler,
        scheduler,
        steps,
        cfg,
        size,
        count,
        seed: seed ? Number(seed) : undefined,
        loras: loras.length ? loras : undefined,
      });
      if (tab === "img2img") {
        payload.denoise = denoise;
        payload.inputImage = inputImage;
      }
    }

    setStatus("running");
    setProgress(0);
    setImages([]);
    setLogs([]);

    let d: { taskId: string };
    try {
      d = await gen.mutateAsync(payload as any);
    } catch (e: any) {
      setStatus("error");
      setError(e?.message ?? "提交失败");
      return;
    }
    setTaskId(d.taskId);
    const es = new EventSource(`/api/tasks/${d.taskId}/stream`);
    es.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "progress") setProgress(msg.progress ?? 0);
      else if (msg.type === "log") setLogs((prev) => [...prev, msg.entry]);
      else if (msg.type === "state") {
        setProgress(msg.progress ?? 0);
        if (msg.status === "FAILED") {
          setStatus("error");
          setError(msg.error ?? "生成失败");
          es.close();
        }
      } else if (msg.type === "done") {
        setStatus("done");
        setProgress(100);
        utils.task.detail
          .fetch({ id: d.taskId })
          .then((td) => setImages((td.images ?? []).map((i: any) => i.localPath)))
          .catch(() => {});
        es.close();
      } else if (msg.type === "error") {
        setStatus("error");
        setError(msg.error ?? "生成失败");
        es.close();
      }
    };
    es.onerror = () => {
      if (status !== "done") {
        setStatus("error");
        setError("连接中断，请稍后刷新查看结果");
      }
      es.close();
    };
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
      {/* Parameter panel */}
      <aside className="rounded-2xl border border-border bg-surface p-5">
        <div className="mb-4 grid grid-cols-3 gap-1 rounded-xl bg-subtle p-1">
          {(["txt2img", "img2img", "custom"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-lg py-2 text-sm font-medium transition-colors ${
                tab === t ? "bg-surface text-primary shadow-sm" : "text-muted"
              }`}
            >
              {t === "txt2img" ? "文生图" : t === "img2img" ? "图生图" : "自定义"}
            </button>
          ))}
        </div>

        {/* ── Skill Selector (all tabs) ── */}
        <div className="mb-4">
          <SkillSelector
            value={selectedSkill?.id ?? null}
            onSelect={(skill) => {
              setSelectedSkill(skill);
              if (skill) {
                // Pre-fill prompt template
                setPrompt(skill.promptTemplate);
                if (skill.negativePrompt) setNegative(skill.negativePrompt);
                // Apply default params
                if (skill.defaultParams) {
                  const p = skill.defaultParams as Record<string, unknown>;
                  if (typeof p.steps === "number") setSteps(p.steps);
                  if (typeof p.cfg === "number") setCfg(p.cfg);
                  if (typeof p.sampler === "string" && SAMPLERS.includes(p.sampler)) setSampler(p.sampler);
                  if (typeof p.scheduler === "string" && SCHEDULERS.includes(p.scheduler)) setScheduler(p.scheduler);
                  if (typeof p.width === "number" && typeof p.height === "number") {
                    const sizeStr = `${p.width}x${p.height}`;
                    if (SIZES.includes(sizeStr) || true) setSize(sizeStr);
                  }
                }
                // Recommend model
                if (skill.recommendedModel && checkpoints.some((c) => c.fileName === skill.recommendedModel)) {
                  setCheckpoint(skill.recommendedModel);
                }
              } else {
                // Clear — user deselected; keep what they typed
              }
            }}
          />
        </div>

        {tab === "custom" ? (
          <div className="mb-3">
            <label className="mb-1 block text-sm font-medium">自定义工作流</label>
            <div className="flex gap-2">
              <DarkSelect
                className="flex-1 !bg-white/[0.03] !border-white/[0.08] text-sm py-2.5"
                value={customId}
                onChange={(v) => setCustomId(v)}
                options={customWorkflows.map((w) => w.id)}
                labels={Object.fromEntries(customWorkflows.map((w) => [w.id, w.name]))}
                placeholder="选择已导入工作流…"
              />
              <button
                onClick={() => setShowImport(true)}
                className="rounded-lg border border-border px-3 text-sm text-primary hover:bg-subtle"
              >
                + 导入
              </button>
            </div>
            <p className="mt-1 text-xs text-muted">
              导入 ComfyUI「导出（API 格式）」的 JSON 即可直接复用你已有的工作流。
            </p>
          </div>
        ) : null}

        {/* ── Custom workflow: Interactive canvas engine ── */}
        {tab === "custom" && wfDetail ? (
          <div className="col-span-full">
            <div
              style={{
                height: "calc(100vh - 220px)",
                minHeight: 520,
                borderRadius: 16,
                overflow: "hidden",
                border: "1px solid rgba(139,92,246,0.15)",
              }}
            >
              <WorkflowCanvas
                initialGraph={wfDetail.graph}
                initialParamMap={wfDetail.paramMap ?? paramMap}
                checkpoints={checkpoints.map((c) => c.fileName)}
                modelLists={{
                  checkpoints: checkpoints.map((c) => c.fileName),
                  loras: loraOpts.map((l) => l.fileName),
                }}
                onGraphChange={(graph, pm) => {
                  setCanvasGraph(graph);
                  setParamMap(pm);
                  // Persist paramMap to server
                  if (customId) {
                    updateWf.mutateAsync({ id: customId, paramMap: pm }).catch(() => {});
                  }
                }}
                onGenerate={(graph, pm) => {
                  // Store graph for generate() to use
                  setCanvasGraph(graph);
                  setParamMap(pm);
                }}
              />
            </div>
          </div>
        ) : null}

        {/* Fallback: static SVG preview (shown only if canvas hasn't loaded yet) */}
        {tab === "custom" && wfDetail && layout && !canvasGraph && (
          <div className="mb-4 rounded-xl border border-border bg-bg p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium">节点图预览</span>
              <div className="flex items-center gap-2">
                {savingMap && <span className="text-xs text-muted">保存映射…</span>}
                <button
                  onClick={() => setGraphFullscreen(true)}
                  className="rounded-md p-1 text-muted hover:bg-subtle hover:text-ink"
                  title="全屏查看"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1.5 5.5V1.5H5.5M10.5 1.5H14.5V5.5M14.5 10.5V14.5H10.5M5.5 14.5H1.5V10.5" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="overflow-auto rounded-lg border border-border bg-surface" style={{ maxHeight: 240 }}>
              <svg
                width={layout.width}
                height={layout.height}
                viewBox={`0 0 ${layout.width} ${layout.height}`}
                className="block"
              >
                {layout.edges.map((e, i) => {
                  const a = layout.pos[e.from];
                  const b = layout.pos[e.to];
                  if (!a || !b) return null;
                  const x1 = a.x + layout.NODE_W;
                  const y1 = a.y + layout.NODE_H / 2;
                  const x2 = b.x;
                  const y2 = b.y + layout.NODE_H / 2;
                  const mx = (x1 + x2) / 2;
                  return (
                    <path
                      key={i}
                      d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                      fill="none"
                      stroke="var(--color-border)"
                      strokeWidth={1.2}
                    />
                  );
                })}
                {wfDetail.nodes.map((n) => {
                  const p = layout.pos[n.id];
                  if (!p) return null;
                  const roleKey = (Object.keys(paramMap) as (keyof ParamMap)[]).find(
                    (k) => paramMap[k] === n.id
                  );
                  const roleColor = roleKey ? ROLE_COLORS[roleKey] : "var(--color-border)";
                  const roleLabel = roleKey
                    ? roleKey === "positiveNode"
                      ? "正向"
                      : roleKey === "negativeNode"
                        ? "负向"
                        : roleKey === "checkpointNode"
                          ? "模型"
                          : "采样"
                    : null;
                  return (
                    <g key={n.id}>
                      <rect
                        x={p.x}
                        y={p.y}
                        width={layout.NODE_W}
                        height={layout.NODE_H}
                        rx={8}
                        fill="var(--color-surface)"
                        stroke={roleColor}
                        strokeWidth={roleKey ? 2 : 1}
                      />
                      <text
                        x={p.x + 10}
                        y={p.y + 19}
                        fill="var(--color-ink)"
                        fontSize={11}
                        fontFamily="monospace"
                      >
                        {n.class_type.length > 18 ? n.class_type.slice(0, 17) + "…" : n.class_type}
                      </text>
                      <text x={p.x + 10} y={p.y + 36} fill="var(--color-muted)" fontSize={10}>
                        #{n.id}
                      </text>
                      {roleLabel && (
                        <g>
                          <rect
                            x={p.x + layout.NODE_W - 38}
                            y={p.y + 6}
                            width={32}
                            height={16}
                            rx={8}
                            fill={roleColor}
                          />
                          <text x={p.x + layout.NODE_W - 22} y={p.y + 17} fill="#fff" fontSize={10} textAnchor="middle">
                            {roleLabel}
                          </text>
                        </g>
                      )}
                    </g>
                  );
                })}
              </svg>
            </div>

            {/* Role mapping */}
            <div className="mt-3 space-y-2">
              <p className="text-xs font-medium text-muted">参数映射（指定节点角色）</p>
              <RoleSelect
                label="正向提示词节点"
                value={paramMap.positiveNode ?? ""}
                options={clipNodes}
                onChange={(v) => updateRole("positiveNode", v)}
              />
              <RoleSelect
                label="负向提示词节点"
                value={paramMap.negativeNode ?? ""}
                options={clipNodes}
                onChange={(v) => updateRole("negativeNode", v)}
              />
              <RoleSelect
                label="模型节点"
                value={paramMap.checkpointNode ?? ""}
                options={ckptNodes}
                onChange={(v) => updateRole("checkpointNode", v)}
              />
              <RoleSelect
                label="采样器节点"
                value={paramMap.samplerNode ?? ""}
                options={ksNodes}
                onChange={(v) => updateRole("samplerNode", v)}
              />
              <p className="text-[11px] text-muted">
                留空即自动识别。修改后会保存到该工作流，下次直接生效。
              </p>
            </div>
          </div>
        )}

        <label className="mb-1 block text-sm font-medium">正向提示词</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          placeholder="描述你想要的图像，例如：a girl with flowing hair, soft lighting, anime style"
          className="mb-3 w-full resize-none rounded-lg border border-border bg-bg p-3 text-sm outline-none focus:border-primary"
        />

        <label className="mb-1 block text-sm font-medium">反向提示词</label>
        <textarea
          value={negative}
          onChange={(e) => setNegative(e.target.value)}
          rows={2}
          placeholder="low quality, blurry, extra fingers"
          className="mb-3 w-full resize-none rounded-lg border border-border bg-bg p-3 text-sm outline-none focus:border-primary"
        />

        {tab === "img2img" && (
          <div className="mb-3">
            <label className="mb-1 block text-sm font-medium">参考图</label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
              className="block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-primary-soft file:px-3 file:py-1.5 file:text-primary"
            />
            {inputImage && <p className="mt-1 text-xs text-primary">已上传：{inputImage}</p>}
          </div>
        )}

        {/* Checkpoint is shown for built-in and custom (custom: optional override). */}
        {tab !== "img2img" && (
          <div className="mb-3">
            <label className="mb-1 block text-sm font-medium">
              大模型（Checkpoint）{tab === "custom" && <span className="text-muted">· 可选</span>}
            </label>
            <DarkSelect
              className="mb-3 w-full !bg-white/[0.03] !border-white/[0.08] text-sm py-2.5"
              value={checkpoint}
              onChange={(v) => setCheckpoint(v)}
              options={checkpoints.map((m) => m.fileName)}
              labels={Object.fromEntries(checkpoints.map((m) => [m.fileName, m.name]))}
              placeholder={tab === "custom" ? "使用工作流自带模型" : "请选择…"}
            />
          </div>
        )}

        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium">采样器</label>
            <DarkSelect
              className="w-full !bg-white/[0.03] !border-white/[0.08] text-sm py-2"
              value={sampler}
              onChange={(v) => setSampler(v)}
              options={SAMPLERS}
              placeholder="选择采样器"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">调度器</label>
            <DarkSelect
              className="w-full !bg-white/[0.03] !border-white/[0.08] text-sm py-2"
              value={scheduler}
              onChange={(v) => setScheduler(v)}
              options={SCHEDULERS}
              placeholder="选择调度器"
            />
          </div>
        </div>

        <div className="mb-3 grid grid-cols-3 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium">步数 {steps}</label>
            <input
              type="range"
              min={1}
              max={50}
              value={steps}
              onChange={(e) => setSteps(Number(e.target.value))}
              className="w-full accent-[var(--color-primary)]"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">CFG {cfg}</label>
            <input
              type="range"
              min={1}
              max={20}
              step={0.5}
              value={cfg}
              onChange={(e) => setCfg(Number(e.target.value))}
              className="w-full accent-[var(--color-primary)]"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">数量 {count}</label>
            <input
              type="range"
              min={1}
              max={4}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="w-full accent-[var(--color-primary)]"
            />
          </div>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium">尺寸</label>
            <DarkSelect
              className="w-full !bg-white/[0.03] !border-white/[0.08] text-sm py-2"
              value={size}
              onChange={(v) => setSize(v)}
              options={SIZES}
              placeholder="选择尺寸"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">种子</label>
            <div className="flex gap-1">
              <input
                value={seed}
                onChange={(e) => setSeed(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="随机"
                className="w-full rounded-lg border border-border bg-bg p-2 text-sm outline-none focus:border-primary"
              />
              <button
                onClick={() => setSeed(String(Math.floor(Math.random() * 1e15)))}
                className="rounded-lg border border-border px-2 text-xs text-muted hover:text-ink"
              >
                随机
              </button>
            </div>
          </div>
        </div>

        {tab === "img2img" && (
          <div className="mb-3">
            <label className="mb-1 block text-sm font-medium">重绘幅度 {denoise}</label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={denoise}
              onChange={(e) => setDenoise(Number(e.target.value))}
              className="w-full accent-[var(--color-primary)]"
            />
          </div>
        )}

        {tab !== "custom" && (
          <div className="mb-4">
            <label className="mb-1 block text-sm font-medium">LoRA（可选，可叠加）</label>
            <div className="space-y-2">
              {loras.map((l, i) => (
                <div key={i} className="flex items-center gap-2">
                  <DarkSelect
                    className="flex-1 !bg-white/[0.03] !border-white/[0.08] text-sm py-1.5"
                    value={l.name}
                    onChange={(v) => {
                      const next = [...loras];
                      next[i]!.name = v;
                      setLoras(next);
                    }}
                    options={loraOpts.map((m) => m.fileName)}
                    labels={Object.fromEntries(loraOpts.map((m) => [m.fileName, m.name]))}
                    placeholder="选择 LoRA…"
                  />
                  <NumberField
                    value={l.weight}
                    onChange={(v) => {
                      const next = [...loras];
                      next[i]!.weight = v;
                      setLoras(next);
                    }}
                    min={0}
                    max={2}
                    step={0.05}
                    decimalPlaces={2}
                    className="w-16"
                  />
                  <button
                    onClick={() => setLoras(loras.filter((_, j) => j !== i))}
                    className="text-muted hover:text-ink"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                onClick={() => setLoras([...loras, { name: "", weight: 0.8 }])}
                className="text-sm text-primary hover:underline"
              >
                + 添加 LoRA
              </button>
            </div>
          </div>
        )}

        {error && <p className="mb-3 text-sm text-red-500">{error}</p>}

        <Button
          onClick={generate}
          disabled={status === "running" || uploading}
          className="w-full"
          size="lg"
        >
          {status === "running" ? "生成中…" : "开始生成"}
        </Button>
      </aside>

      {/* Result area */}
      <section className="rounded-2xl border border-border bg-surface p-5">
        {status === "idle" && (
          <div className="grid h-full min-h-[360px] place-items-center text-center text-muted">
            <div>
              <p className="text-lg font-medium text-ink">等待创作</p>
              <p className="mt-1 text-sm">设置参数后点击「开始生成」</p>
            </div>
          </div>
        )}

        {status === "running" && (
          <div className="grid min-h-[360px] place-items-center">
            <div className="w-full max-w-sm text-center">
              <p className="mb-1 text-sm font-medium text-ink">工作流：{workflowLabel}</p>
              <div className="mb-3 h-2 w-full overflow-hidden rounded-full bg-subtle">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-sm text-muted">生成中… {progress}%</p>
            </div>
          </div>
        )}

        {(status === "done" || status === "error") && (
          <div>
            {status === "error" ? (
              <div className="grid min-h-[200px] place-items-center text-center text-red-500">
                {error || "生成失败"}
              </div>
            ) : (
              <>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="font-semibold">生成结果</h3>
                  {taskId && (
                    <Link href={`/create/${taskId}`} className="text-sm text-primary hover:underline">
                      查看详情 →
                    </Link>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {images.map((src, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={i}
                      src={src}
                      alt={`result ${i}`}
                      className="aspect-square w-full rounded-xl border border-border object-cover"
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {logs.length > 0 && (
          <div className="mt-5">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              执行日志 · 工作流 {workflowLabel}
            </div>
            <div className="max-h-56 overflow-y-auto rounded-xl border border-border bg-bg p-3 font-mono text-xs leading-relaxed">
              {logs.map((l, i) => (
                <div key={i} className={LOG_STYLE[l.level]}>
                  <span className="mr-2 text-muted/60">
                    {new Date(l.t).toLocaleTimeString("zh-CN", { hour12: false })}
                  </span>
                  {l.msg}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Fullscreen node-graph modal */}
      {graphFullscreen && wfDetail && layout && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black/70 p-4"
          onClick={() => setGraphFullscreen(false)}
        >
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-medium text-white/90">
              节点图 · {wfDetail.nodes.length} 个节点
            </h3>
            <button
              onClick={() => setGraphFullscreen(false)}
              className="rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white/80 hover:bg-white/20 hover:text-white"
            >
              关闭（Esc）
            </button>
          </div>
          <div className="flex-1 overflow-auto rounded-xl border border-white/10 bg-[#0a0a12] p-6">
            <svg
              width={layout.width}
              height={layout.height}
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              className="block mx-auto"
              style={{ minWidth: layout.width }}
            >
              {layout.edges.map((e, i) => {
                const a = layout.pos[e.from];
                const b = layout.pos[e.to];
                if (!a || !b) return null;
                const x1 = a.x + layout.NODE_W;
                const y1 = a.y + layout.NODE_H / 2;
                const x2 = b.x;
                const y2 = b.y + layout.NODE_H / 2;
                const mx = (x1 + x2) / 2;
                return (
                  <path
                    key={`fs-e-${i}`}
                    d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                    fill="none"
                    stroke="#334155"
                    strokeWidth={1.5}
                  />
                );
              })}
              {wfDetail.nodes.map((n) => {
                const p = layout.pos[n.id];
                if (!p) return null;
                const roleKey = (Object.keys(paramMap) as (keyof ParamMap)[]).find(
                  (k) => paramMap[k] === n.id
                );
                const roleColor = roleKey ? ROLE_COLORS[roleKey] : "#475569";
                const roleLabel = roleKey
                  ? roleKey === "positiveNode"
                    ? "正向"
                    : roleKey === "negativeNode"
                      ? "负向"
                      : roleKey === "checkpointNode"
                        ? "模型"
                        : "采样"
                  : null;
                return (
                  <g key={`fs-${n.id}`}>
                    <rect
                      x={p.x}
                      y={p.y}
                      width={layout.NODE_W}
                      height={layout.NODE_H}
                      rx={8}
                      fill="#161625"
                      stroke={roleColor}
                      strokeWidth={roleKey ? 2.5 : 1.2}
                    />
                    <text
                      x={p.x + 10}
                      y={p.y + 19}
                      fill="#e2e8f0"
                      fontSize={12}
                      fontFamily="monospace"
                    >
                      {n.class_type.length > 18 ? n.class_type.slice(0, 17) + "…" : n.class_type}
                    </text>
                    <text x={p.x + 10} y={p.y + 36} fill="#94a3b8" fontSize={11}>
                      #{n.id}
                    </text>
                    {roleLabel && (
                      <g>
                        <rect
                          x={p.x + layout.NODE_W - 38}
                          y={p.y + 6}
                          width={32}
                          height={16}
                          rx={8}
                          fill={roleColor}
                        />
                        <text x={p.x + layout.NODE_W - 22} y={p.y + 17} fill="#fff" fontSize={10} textAnchor="middle">
                          {roleLabel}
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      )}

      {/* Import workflow modal */}
      {showImport && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
          onClick={() => setShowImport(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-border bg-surface p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="u-title mb-3">导入 ComfyUI 工作流</h3>
            <label className="mb-1 block text-sm font-medium">工作流名称</label>
            <input
              value={importName}
              onChange={(e) => setImportName(e.target.value)}
              placeholder="例如：我的二次元工作流"
              className="mb-3 w-full rounded-lg border border-border bg-bg p-2.5 text-sm outline-none focus:border-primary"
            />
            <label className="mb-1 block text-sm font-medium">API JSON</label>
            <textarea
              value={importJson}
              onChange={(e) => setImportJson(e.target.value)}
              rows={6}
              placeholder='粘贴 ComfyUI「导出（API 格式）」的 JSON…'
              className="mb-2 w-full resize-none rounded-lg border border-border bg-bg p-3 font-mono text-xs outline-none focus:border-primary"
            />
            <div className="mb-3">
              <input
                type="file"
                accept=".json,application/json"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) f.text().then(setImportJson);
                }}
                className="block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-primary-soft file:px-3 file:py-1.5 file:text-primary"
              />
            </div>
            {importError && <p className="mb-2 text-sm text-red-500">{importError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowImport(false)}>
                取消
              </Button>
              <Button size="sm" onClick={importWorkflow}>
                保存工作流
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RoleSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: WfNode[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 shrink-0 text-xs text-muted">{label}</span>
      <DarkSelect
        className="flex-1 !bg-white/[0.03] !border-white/[0.08] text-xs py-1.5"
        value={value}
        onChange={(v) => onChange(v)}
        options={options.map((n) => n.id)}
        labels={Object.fromEntries(options.map((n) => [n.id, `#${n.id} · ${n.class_type}`]))}
        placeholder="自动"
      />
    </div>
  );
}
