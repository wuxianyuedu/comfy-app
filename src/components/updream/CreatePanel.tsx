"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { SkillSelector } from "@/components/skill";
import type { SkillData } from "@/components/skill";
import type { WorkspaceView } from "@/components/updream";
import { useToast } from "@/components/updream/Toast";
import { vanillaApi } from "~/trpc/vanilla";
import { NumberField } from "@/components/updream/ui/NumberField";
import { DarkSelect } from "@/components/updream/ui/DarkSelect";
import { Icon } from "@/components/ui/Icon";
import { ValidationErrorList } from "@/components/updream/shared/ValidationErrorList";
import type { ValidationError } from "@/lib/comfyui/validation";
import {
  WORKFLOW_CATEGORIES,
  IMAGE_WORKFLOW_TYPES,
  VIDEO_WORKFLOW_TYPES,
  AUDIO_WORKFLOW_TYPES,
  getWorkflowTypesByCategory,
  getWorkflowType,
  normalizeTaskType,
  type WorkflowCategory,
  type WorkflowTypeDefinition,
} from "@/lib/workflow-types";
import { WorkflowParamConfig } from "@/components/workflow/WorkflowParamConfig";
import { DynamicWorkflowForm } from "@/components/updream/shared/DynamicWorkflowForm";
import {
  toWorkflowInputsPayload,
  reconcileInputValues,
  type WorkflowIOMap,
} from "@/components/updream/shared/workflow-io";

const WorkflowCanvas = dynamic(
  () => import("@/components/workflow-canvas").then((m) => ({ default: m.WorkflowCanvas })),
  { ssr: false }
);

type ModelOpt = { id: string; fileName: string; name: string };
type WorkflowOpt = { id: string; name: string; taskType: string; typeLabel?: string; typeCategory?: string };
type LogEntry = { t: number; level: string; msg: string };
type ParamMap = {
  positiveNode?: string;
  negativeNode?: string;
  checkpointNode?: string;
  samplerNode?: string;
};
type WfNode = { id: string; class_type: string; title: string };

const SAMPLERS = ["euler", "euler_ancestral", "dpmpp_2m", "dpmpp_2m_sde", "ddim", "uni_pc"];
const SCHEDULERS = ["normal", "karras", "exponential", "simple", "beta"];
const SIZES = ["1024x1024", "768x768", "512x512", "832x1216", "1216x832", "1344x768"];
const VIDEO_SIZES = ["832x480", "1280x720", "480x832", "720x1280", "1024x576"];

const TABS = [
  ["txt2img", "文生图"],
  ["img2img", "图生图"],
  ["video", "视频"],
  ["edit", "编辑"],
  ["custom", "自定义"],
] as const;

const TAB_LABEL: Record<string, string> = {
  // Legacy
  txt2img: "文生图",
  img2img: "图生图",
  video: "视频",
  edit: "编辑",
  custom: "自定义",
  // Image types (13)
  T2I: "文生图", I2I: "图生图", TI2I: "图文混合条件生图", R2I: "参考图生图",
  E2I: "边缘图生图", D2I: "深度图生图", P2I: "姿态骨架生图", S2I: "线稿生图",
  M2I: "掩码生图", Inpaint: "局部重绘", Outpaint: "扩图", Upscale: "超分放大",
  // Video types (18)
  T2V: "文生视频", I2V: "单图生视频", TI2V: "图文联合生视频", FLF2V: "首尾帧生视频",
  FMF2V: "首中尾三帧生视频", V2V: "视频生视频", R2V: "参考图生视频", RV2V: "参考视频改视频",
  VI2V: "指令改视频", MV2V: "遮罩改视频", VRC2V: "区域动作微调", ADS2V: "广告植入改视频",
  S2V: "音频/语音驱生视频", IA2V: "图+音频生唇形视频", A2V: "音生视频", V2A: "生音频",
  // Audio types (7)
  T2A: "文生音频/音效", T2M: "文生音乐", T2S: "文生语音", S2S: "语音变语音",
  A2A: "音频转音频", V2T: "视频生描述", I2T: "图生文",
};

/** Map any workflow type code to a legacy render category for panel conditionals */
function resolveTabCategory(tab: string): "txt2img" | "img2img" | "video" | "edit" | "custom" {
  if (tab === "txt2img" || tab === "img2img" || tab === "video" || tab === "edit" || tab === "custom") return tab;
  const def = getWorkflowType(tab);
  if (!def) return "txt2img";
  switch (def.category) {
    case "image":
      if (def.code === "Inpaint") return "edit";
      if (def.code === "Outpaint") return "edit";
      if (def.code === "Upscale") return "edit";
      if (def.code === "I2I" || def.code === "TI2I" || def.code === "R2I" ||
          def.code === "E2I" || def.code === "D2I" || def.code === "P2I" ||
          def.code === "S2I" || def.code === "M2I") return "img2img";
      return "txt2img"; // T2I and other generative image modes
    case "video":
      if (def.code === "V2A") return "custom"; // video-to-audio is post-processing
      return "video";
    case "audio":
      return "custom";
    default:
      return "txt2img";
  }
}

export interface SkillShort {
  id: string;
  name: string;
  slug: string;
  promptTemplate?: string;
  negativePrompt?: string;
  defaultParams?: Record<string, unknown>;
  recommendedModel?: string;
}

export function CreatePanel({
  initialSkill,
  initialMode = "txt2img",
  initialWorkflowId,
  initialPrompt,
  initialNegative,
  initialParams,
  initialImage,
  autoStart = false,
  onBack,
  onNavigate,
}: {
  initialSkill?: SkillShort | null;
  initialMode?: string;
  initialWorkflowId?: string;
  initialPrompt?: string;
  initialNegative?: string;
  initialParams?: Partial<{ steps: number; cfg: number; sampler: string; scheduler: string; size: string }>;
  initialImage?: string;
  autoStart?: boolean;
  onBack?: () => void;
  onNavigate?: (v: WorkspaceView) => void;
}) {
  const toast = useToast();

  const [tab, setTab] = useState<string>(initialMode);
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
  const [seedMode, setSeedMode] = useState<"random" | "fixed" | "manual">("random");
  const [denoise, setDenoise] = useState(0.65);
  const [inputImage, setInputImage] = useState("");

  // ── video state ──
  const [videoMode, setVideoMode] = useState<"t2v" | "i2v" | "flf">("t2v");
  const [frames, setFrames] = useState(81);
  const [fps, setFps] = useState(16);
  const [firstFrame, setFirstFrame] = useState("");
  const [lastFrame, setLastFrame] = useState("");
  const [wanModel, setWanModel] = useState("");
  const [wanVae, setWanVae] = useState("");
  const [t5Model, setT5Model] = useState("");
  const [showAdvVideo, setShowAdvVideo] = useState(false);

  // ── edit state ──
  const [editMode, setEditMode] = useState<"inpaint" | "upscale">("inpaint");
  const [maskImage, setMaskImage] = useState("");
  const [upscaleModel, setUpscaleModel] = useState("4x-UltraSharp.pth");

  const [checkpoints, setCheckpoints] = useState<ModelOpt[]>([]);
  const [loraOpts, setLoraOpts] = useState<ModelOpt[]>([]);
  const [customWorkflows, setCustomWorkflows] = useState<WorkflowOpt[]>([]);
  const [customId, setCustomId] = useState("");
  // Dynamic runtime values for the selected custom workflow's exposed pins.
  const [customInputs, setCustomInputs] = useState<Record<string, unknown>>({});

  // ── Workflow type filter state ──
  const [wfCategory, setWfCategory] = useState<WorkflowCategory>("image");
  const [wfTypeFilter, setWfTypeFilter] = useState<string>("");

  // ── Model-supported workflow types (fetched when checkpoint changes) ──
  const [modelSupportedTypes, setModelSupportedTypes] = useState<Set<string>>(new Set());
  const [modeCategoryExpanded, setModeCategoryExpanded] = useState<Record<string, boolean>>({
    image: true,
    video: false,
    audio: false,
  });

  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  /** R-Next (2026-08-17): structured ComfyUI /prompt validation errors,
   *  surfaced inline below the error banner so the user can locate the bad
   *  input instead of parsing the English summary. */
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [images, setImages] = useState<string[]>([]);
  const [taskId, setTaskId] = useState("");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [uploading, setUploading] = useState(false);

  // custom workflow graph
  const [wfDetail, setWfDetail] = useState<{
    graph: Record<string, any>;
    nodes: WfNode[];
    paramMap: ParamMap;
    workflowIO?: WorkflowIOMap;
  } | null>(null);
  const [paramMap, setParamMap] = useState<ParamMap>({});
  const [canvasGraph, setCanvasGraph] = useState<Record<string, any> | null>(null);

  const [selectedSkill, setSelectedSkill] = useState<SkillData | null>(null);
  const appliedSkillRef = useRef<string | null>(null);
  const autoStartRef = useRef(false);

  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // Apply external initial values (e.g. from the Agent conversation) exactly
  // once on mount, before any auto-start fires.
  const appliedInitRef = useRef(false);
  useEffect(() => {
    if (appliedInitRef.current) return;
    appliedInitRef.current = true;
    if (initialPrompt) setPrompt(initialPrompt);
    if (initialNegative) setNegative(initialNegative);
    if (initialImage) {
      setInputImage(initialImage);
      setTab("edit");
    }
    if (initialParams) {
      if (initialParams.size) setSize(initialParams.size);
      if (typeof initialParams.steps === "number") setSteps(initialParams.steps);
      if (typeof initialParams.cfg === "number") setCfg(initialParams.cfg);
      if (initialParams.sampler) setSampler(initialParams.sampler);
      if (initialParams.scheduler) setScheduler(initialParams.scheduler);
    }
  }, [initialPrompt, initialNegative, initialParams]);

  // Optionally auto-generate after the initial prompt is applied.
  useEffect(() => {
    if (autoStart && initialPrompt && !autoStartRef.current) {
      autoStartRef.current = true;
      const t = setTimeout(() => {
        if (status === "idle") generate();
      }, 1500);
      return () => clearTimeout(t);
    }
  }, [initialPrompt, autoStart, status, generate]);

  // Open directly in "custom" mode with a pre-selected imported workflow
  // (launched from the Workflow Library "使用" action).
  useEffect(() => {
    if (initialWorkflowId) {
      setTab("custom");
      setCustomId(initialWorkflowId);
    }
  }, [initialWorkflowId]);

  const fetchModels = useCallback(() => {
    vanillaApi.model.list
      .query({ type: "CHECKPOINT" })
      .then((d) => setCheckpoints(d.models ?? []));
    vanillaApi.model.list
      .query({ type: "LORA" })
      .then((d) => setLoraOpts(d.models ?? []));
    // Fetch workflows with optional type filter
    const typeParam = wfTypeFilter ? { type: wfTypeFilter } : { category: wfCategory };
    vanillaApi.workflow.list
      .query(typeParam)
      .then((d) => setCustomWorkflows(d.workflows ?? []));
  }, [wfCategory, wfTypeFilter]);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  // ── When a checkpoint is selected, fetch which workflow types it supports ──
  useEffect(() => {
    if (!checkpoint) {
      setModelSupportedTypes(new Set());
      return;
    }
    // Fetch all workflows and collect unique taskTypes as the "supported" set for this model.
    // In future this could be replaced by a dedicated /api/models/[id]/types endpoint.
    vanillaApi.workflow.list
      .query({})
      .then((d) => {
        const types: Set<string> = new Set(
          (d.workflows ?? []).map((w: { taskType: string }) => normalizeTaskType(w.taskType))
        );
        setModelSupportedTypes(types);
      })
      .catch(() => setModelSupportedTypes(new Set<string>()));
  }, [checkpoint]);

  /* ── Mode category display config ── */
  const MODE_CATEGORY_CONFIG: Record<WorkflowCategory, { label: string; color: string; icon: string }> = {
    image:  { label: "图像", color: "#a78bfa", icon: "image" },
    video:  { label: "视频", color: "#fbbf24", icon: "film" },
    audio:  { label: "音频", color: "#34d399", icon: "music" },
  };

  // Apply initial skill (from Skills grid) once checkpoints are loaded.
  useEffect(() => {
    if (!initialSkill) return;
    if (appliedSkillRef.current === initialSkill.id) return;
    appliedSkillRef.current = initialSkill.id;
    setPrompt(initialSkill.promptTemplate ?? "");
    if (initialSkill.negativePrompt) setNegative(initialSkill.negativePrompt);
    const p = initialSkill.defaultParams ?? {};
    if (typeof p.steps === "number") setSteps(p.steps);
    if (typeof p.cfg === "number") setCfg(p.cfg);
    if (typeof p.sampler === "string" && SAMPLERS.includes(p.sampler)) setSampler(p.sampler);
    if (typeof p.scheduler === "string" && SCHEDULERS.includes(p.scheduler)) setScheduler(p.scheduler);
    if (typeof p.width === "number" && typeof p.height === "number") {
      setSize(`${p.width}x${p.height}`);
    }
    if (initialSkill.recommendedModel && checkpoints.some((c) => c.fileName === initialSkill.recommendedModel)) {
      setCheckpoint(initialSkill.recommendedModel);
    }
  }, [initialSkill, checkpoints]);

  // Load custom workflow detail.
  useEffect(() => {
    if (tab !== "custom" || !customId) {
      setWfDetail(null);
      setParamMap({});
      return;
    }
    let cancelled = false;
    vanillaApi.workflow.detail
      .query({ id: customId })
      .then((d) => {
        if (cancelled) return;
        const tpl = d.template;
        if (tpl.graph) {
          const nodes: WfNode[] = Object.entries(tpl.graph).map(([id, n]) => ({
            id,
            class_type: (n as any)?.class_type ?? "?",
            title: (n as any)?.title ?? (n as any)?.class_type ?? id,
          }));
          setWfDetail({
            graph: tpl.graph as Record<string, any>,
            nodes,
            paramMap: (tpl.paramMap as ParamMap) ?? {},
            workflowIO: (tpl.workflowIO as unknown as WorkflowIOMap) ?? undefined,
          });
          setParamMap((tpl.paramMap as ParamMap) ?? {});
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [tab, customId]);

  // Seed the custom-workflow form with the workflow's default values once its IO
  // loads, so the user sees a populated (not blank) form and the payload carries
  // every exposed pin's current value.
  const seededCustom = useRef<string | null>(null);
  useEffect(() => {
    if (tab !== "custom" || !customId || !wfDetail?.workflowIO) return;
    if (seededCustom.current === customId) return;
    seededCustom.current = customId;
    setCustomInputs(reconcileInputValues(wfDetail.workflowIO, customInputs));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wfDetail, customId, tab]);

  async function uploadFile(file: File, setter: (name: string) => void, label = "文件") {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const d = await res.json();
      if (d.name) {
        setter(d.name);
        toast.success(`${label}已上传`);
      } else {
        toast.error("上传失败", d.error);
      }
    } finally {
      setUploading(false);
    }
  }

  async function generate() {
    setError("");
    if (!prompt.trim() && !(tabCat === "edit" && editMode === "upscale")) {
      setError("请输入正向提示词");
      toast.error("请输入提示词");
      return;
    }
    // Default to the first available checkpoint so Agent/auto flows don't stall.
    const effCkpt = checkpoint || (checkpoints[0]?.fileName ?? "");
    if (tabCat === "custom") {
      if (!customId) {
        setError("请先选择或导入一个自定义工作流");
        toast.error("请选择工作流");
        return;
      }
    } else if (tabCat === "edit") {
      if (!inputImage) {
        setError("请先上传参考图");
        toast.error("请上传参考图");
        return;
      }
    } else if (tabCat === "video") {
      if (videoMode === "i2v" && !inputImage) {
        setError("图生视频请先上传首帧参考图");
        toast.error("请上传首帧参考图");
        return;
      }
      if (videoMode === "flf" && (!firstFrame || !lastFrame)) {
        setError("首尾帧模式请先上传首帧与尾帧参考图");
        toast.error("请上传首帧与尾帧");
        return;
      }
    } else if (!effCkpt) {
      setError("请先选择一个大模型（Checkpoint）");
      toast.error("请选择大模型");
      return;
    }

    const payload: Record<string, unknown> = {
      workflow:
        tabCat === "custom"
          ? customId
          : tabCat === "video"
          ? videoMode === "t2v"
            ? "txt2video"
            : videoMode === "i2v"
            ? "img2video"
            : "flfvideo"
          : tabCat === "edit"
          ? editMode
          : tab, // Pass the actual type code (T2I/I2V/etc.) to API
      prompt: prompt.trim(),
      negative: negative.trim() || undefined,
    };
    if (selectedSkill) {
      payload.skillId = selectedSkill.id;
      payload.skillName = selectedSkill.name;
      payload.skillSlug = selectedSkill.slug;
    }

    if (tabCat === "video") {
      payload.frames = frames;
      payload.fps = fps;
      payload.size = size;
      if (videoMode === "i2v") payload.inputImage = inputImage;
      if (videoMode === "flf") {
        payload.firstFrame = firstFrame;
        payload.lastFrame = lastFrame;
      }
      if (wanModel) payload.wanModel = wanModel;
      if (wanVae) payload.wanVae = wanVae;
      if (t5Model) payload.t5Model = t5Model;
      Object.assign(payload, { steps, cfg, sampler, scheduler });
      if (seed) payload.seed = Number(seed);
    } else if (tabCat === "edit") {
      if (editMode === "upscale") {
        payload.upscaleModel = upscaleModel;
        payload.inputImage = inputImage;
      } else {
        payload.checkpoint = checkpoint;
        payload.inputImage = inputImage;
        if (maskImage) payload.mask = maskImage;
        Object.assign(payload, { steps, cfg, sampler, scheduler, denoise });
        if (seed) payload.seed = Number(seed);
      }
    } else if (tabCat === "custom") {
      if (canvasGraph && Object.keys(canvasGraph).length) payload.canvasGraph = canvasGraph;
      if (Object.keys(paramMap).length) payload.paramMap = paramMap;
      if (effCkpt) payload.checkpoint = effCkpt;
      // Dynamic, IO-driven values drive the workflow (not hardcoded 步数/CFG/种子).
      payload.workflowInputs = toWorkflowInputsPayload(wfDetail?.workflowIO ?? undefined, customInputs);
    } else {
      Object.assign(payload, {
        checkpoint: effCkpt,
        sampler,
        scheduler,
        steps,
        cfg,
        size,
        count,
        seed: seed ? Number(seed) : undefined,
        loras: loras.length ? loras : undefined,
      });
      if (tabCat === "img2img") {
        payload.denoise = denoise;
        payload.inputImage = inputImage;
      }
    }

    setStatus("running");
    setProgress(0);
    setImages([]);
    setLogs([]);
    setValidationErrors([]);

    const loadId = toast.loading("正在提交生成任务…");

    // R-Next (2026-08-17): the SSE `msg` only carries `error`; re-fetch the
    //  task to grab structured `validationErrors` for the inline panel.
    const fetchValidationErrors = async (tid: string) => {
      try {
        const td = await vanillaApi.task.detail.query({ id: tid });
        const ve = (td as any)?.validationErrors;
        if (Array.isArray(ve)) setValidationErrors(ve as ValidationError[]);
      } catch {}
    };

    const d = await vanillaApi.generate.generate.mutate(payload as any);
    if (!d.taskId) {
      setStatus("error");
      setError("提交失败");
      toast.update(loadId, { kind: "error", title: "提交失败", description: "生成请求未返回任务 ID", duration: 4000 });
      return;
    }

    setTaskId(d.taskId);
    toast.update(loadId, { kind: "loading", title: "生成中…", description: "正在调用本机 ComfyUI", duration: 0 });

    const es = new EventSource(`/api/tasks/${d.taskId}/stream`);
    es.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "progress") {
        setProgress(msg.progress ?? 0);
      } else if (msg.type === "log") {
        setLogs((prev) => [...prev, msg.entry]);
      } else if (msg.type === "state") {
        setProgress(msg.progress ?? 0);
        if (msg.status === "FAILED") {
          setStatus("error");
          setError(msg.error ?? "生成失败");
          void fetchValidationErrors(d.taskId);
          es.close();
          toast.update(loadId, { kind: "error", title: "生成失败", description: msg.error, duration: 5000 });
        }
      } else if (msg.type === "done") {
        setStatus("done");
        setProgress(100);
        vanillaApi.task.detail
          .query({ id: d.taskId })
          .then((td) => {
            const imgs = (td.images ?? []).map((i: any) => i.localPath) as string[];
            setImages(imgs);
            // R-Next (2026-08-17): keep any structured validation errors in sync
            const ve = td.validationErrors;
            setValidationErrors(Array.isArray(ve) ? (ve as ValidationError[]) : []);
            toast.update(loadId, {
              kind: "success",
              title: tab === "video" ? "视频已生成" : "生成完成",
              description: `${imgs.length} 个文件已生成`,
              duration: 4000,
            });
          });
        es.close();
      } else if (msg.type === "error") {
        setStatus("error");
        setError(msg.error ?? "生成失败");
        void fetchValidationErrors(d.taskId);
        es.close();
        toast.update(loadId, { kind: "error", title: "生成失败", description: msg.error, duration: 5000 });
      }
    };
    es.onerror = () => {
      if (status !== "done") {
        setStatus("error");
        setError("连接中断，请稍后刷新查看结果");
        toast.update(loadId, { kind: "error", title: "连接中断", description: "请稍后刷新查看结果", duration: 5000 });
      }
      es.close();
    };
  }

  const inputClass =
    "w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-gray-200 outline-none transition-colors focus:border-violet-500/40";
  const labelClass = "mb-1 block text-xs font-medium text-gray-400";
  const selectClass = inputClass;

  /* ── PortIndicator: ComfyUI-style connection port dot ── */
  interface PortIndicatorProps {
    /** Port type determines color: prompt=purple, image=cyan, condition=orange, latent=pink */
    type?: "prompt" | "image" | "condition" | "latent" | "seed" | "model";
    /** Position: "left" shows on the left edge, "right" on the right */
    side?: "left" | "right";
    /** Whether a connection is currently attached to this port */
    connected?: boolean;
    /** Label shown on hover / next to the port */
    label?: string;
    /** Optional click handler (for connecting/disconnecting) */
    onClick?: () => void;
  }
  const PORT_COLORS: Record<string, { bg: string; ring: string; glow: string }> = {
    prompt:   { bg: "#a78bfa", ring: "#7c3aed", glow: "rgba(167,139,250,0.35)" },
    image:    { bg: "#22d3ee", ring: "#06b6d4", glow: "rgba(34,211,238,0.35)" },
    condition:{ bg: "#fb923c", ring: "#f97316", glow: "rgba(251,146,60,0.35)" },
    latent:   { bg: "#f472b6", ring: "#ec4899", glow: "rgba(244,114,182,0.35)" },
    seed:     { bg: "#4ade80", ring: "#22c55e", glow: "rgba(74,222,128,0.35)" },
    model:    { bg: "#60a5fa", ring: "#3b82f6", glow: "rgba(96,165,250,0.35)" },
  };

  function PortIndicator({ type = "prompt", side = "left", connected = false, label, onClick }: PortIndicatorProps) {
    const c = PORT_COLORS[type] ?? PORT_COLORS.prompt;
    return (
      <button
        type="button"
        onClick={onClick}
        title={label ?? (connected ? "已连接 — 点击断开" : "连接端口 — 点击连线")}
        className={`group relative flex shrink-0 items-center justify-center transition-all ${
          side === "left" ? "mr-2 order-first" : "ml-2 order-last"
        }`}
      >
        {/* Outer ring (visible when connected or hovered) */}
        <div
          className={`absolute inset-0 rounded-full transition-all ${
            connected ? "scale-100 opacity-100" : "scale-50 opacity-0 group-hover:scale-100 group-hover:opacity-60"
          }`}
          style={{ background: c!.glow, boxShadow: `0 0 8px ${c!.glow}` }}
        />
        {/* Inner dot */}
        <div
          className={`relative z-10 h-[10px] w-[10px] rounded-full border-2 transition-colors ${
            connected ? "shadow-sm" : ""
          }`}
          style={{
            backgroundColor: connected ? c!.bg : "transparent",
            borderColor: c!.ring,
            boxShadow: connected ? `0 0 6px ${c!.glow}` : "none",
          }}
        />
        {/* Tooltip label */}
        {label && (
          <span className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md bg-black/85 px-2 py-0.5 text-[10px] text-gray-300 opacity-0 shadow-lg backdrop-blur-sm transition-opacity group-hover:opacity-100">
            {label}
          </span>
        )}
      </button>
    );
  }

  interface FileInputProps {
    label: string;
    onChange: (f: File) => void;
    accept?: string;
  }

  function fileInput({ label, onChange, accept = "image/*" }: FileInputProps) {
    return (
      <input
        type="file"
        accept={accept}
        onChange={(e) => e.target.files?.[0] && onChange(e.target.files[0])}
        className="block w-full text-xs text-gray-400 file:mr-3 file:rounded-lg file:border-0 file:bg-violet-500/15 file:px-3 file:py-1.5 file:text-violet-200"
      />
    );
  }

  const showNegative = resolveTabCategory(tab) !== "video" && resolveTabCategory(tab) !== "edit" && resolveTabCategory(tab) !== "custom";
  const showPrompt = !(resolveTabCategory(tab) === "edit" && editMode === "upscale");
  const tabCat = resolveTabCategory(tab); // shorthand for template conditionals

  return (
    <div className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-[#0a0a0f]">
      {/* Aurora background */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div
          className="absolute -right-[10%] -top-[15%] h-[60%] w-[50%] rounded-full opacity-50 mix-blend-screen"
          style={{ background: "radial-gradient(circle, rgba(139,92,246,0.38) 0%, rgba(139,92,246,0) 70%)" }}
        />
        <div
          className="absolute -left-[15%] bottom-[10%] h-[55%] w-[45%] rounded-full opacity-50 mix-blend-screen"
          style={{ background: "radial-gradient(circle, rgba(34,211,238,0.24) 0%, rgba(34,211,238,0) 70%)" }}
        />
      </div>

      {/* ── Top Toolbar ── */}
      <header className="relative z-10 flex h-12 shrink-0 items-center gap-3 border-b border-white/[0.05] bg-[#14141a]/88 px-4 backdrop-blur-md">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-white/5 hover:text-gray-100"
            title="返回"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
        )}
        <div className="flex items-center gap-2">
          <span className="u-title">创作台</span>
          <span className="text-xs text-[#6b7088]">· {TAB_LABEL[tab]}</span>
        </div>

        {/* Current mode indicator — full picker lives in the param panel */}
        <button
          type="button"
          onClick={() => {
            const el = document.getElementById("mode-picker-section");
            el?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
          className="ml-1 flex items-center gap-1 rounded-lg bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-violet-200 transition-colors hover:bg-white/[0.06]"
          title="点击跳转到模式选择"
        >
          {getWorkflowType(tab)?.label ?? TAB_LABEL[tab] ?? tab}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 9l6 6 6-6"/></svg>
        </button>

        <div className="flex-1" />

        {/* Backend indicator */}
        <div className="flex items-center gap-1.5 rounded-full bg-emerald-500/12 px-2.5 py-1 text-[11px] text-emerald-300">
          <span className="inline-block h-[7px] w-[7px] rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/40" />
          本机 ComfyUI · 8188
        </div>
      </header>

      {/* ── Three-Column Body ── */}
      <div className="relative z-10 flex min-h-0 flex-1 overflow-hidden">
        {/* ═══ Left: 灵感 · 技能 (300px) ═══ */}
        <aside className="flex w-[300px] shrink-0 flex-col border-r border-white/[0.04] bg-[#0f0f16]/85 backdrop-blur-sm">
          <div className="flex h-11 items-center border-b border-white/[0.04] px-4">
            <span className="text-[13px] font-semibold text-[#e5e7eb]">灵感 · 技能</span>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {/* Selected skill card */}
            <div className="rounded-xl border border-violet-500/30 bg-violet-500/[0.06] p-3">
              <p className="text-[11px] font-semibold text-violet-300/80">已选技能</p>
              <p className="mt-1 text-sm font-semibold text-[#e5e7eb]">
                {selectedSkill?.name ?? initialSkill?.name ?? "自由创作"}
              </p>
            </div>

            {/* Skill selector */}
            <SkillSelector
              value={selectedSkill?.id ?? null}
              onSelect={(skill) => {
                setSelectedSkill(skill);
                if (skill) {
                  setPrompt(skill.promptTemplate ?? "");
                  if (skill.negativePrompt) setNegative(skill.negativePrompt);
                  const p = (skill.defaultParams ?? {}) as Record<string, unknown>;
                  if (typeof p.steps === "number") setSteps(p.steps);
                  if (typeof p.cfg === "number") setCfg(p.cfg);
                  if (typeof p.sampler === "string" && SAMPLERS.includes(p.sampler)) setSampler(p.sampler);
                  if (typeof p.scheduler === "string" && SCHEDULERS.includes(p.scheduler)) setScheduler(p.scheduler);
                  if (typeof p.width === "number" && typeof p.height === "number") setSize(`${p.width}x${p.height}`);
                  if (skill.recommendedModel && checkpoints.some((c) => c.fileName === skill.recommendedModel)) {
                    setCheckpoint(skill.recommendedModel);
                  }
                  toast.info("已应用技能", skill.name);
                }
              }}
            />

            {/* Reference zone (img2img) */}
            {tabCat === "img2img" && (
              <div className="rounded-xl border border-violet-500/30 bg-violet-500/[0.05] p-3.5">
                <div className="flex items-center gap-2">
                  <PortIndicator type="image" label="图像输入端口 (LATENT)" />
                  <p className="text-[12px] font-semibold text-violet-300/90">＋ 参考图（图生图）</p>
                </div>
                <p className="mb-2 mt-1 text-[10px] text-[#6b7088]">上传图片作为构图 / 风格参考</p>
                <div className="flex items-start gap-2">
                  <PortIndicator type="image" side="left" label="接收上游节点图像输出" />
                  <div className="flex-1">
                    {fileInput({ label: "参考图", onChange: (f) => uploadFile(f, setInputImage), accept: "image/*" })}
                    {inputImage && <p className="mt-1 truncate text-[11px] text-violet-300">已上传：{inputImage}</p>}
                  </div>
                  <PortIndicator type="latent" side="right" label="LATENT 输出 → 采样器/VAE" />
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* ═══ Center: 生成结果 (flex) ═══ */}
        <main className="relative flex min-w-0 flex-1 flex-col bg-[#0a0a0f]">
          <div className="flex h-11 shrink-0 items-center border-b border-white/[0.04] px-4">
            <span className="text-[13px] font-semibold text-[#e5e7eb]">生成结果</span>
          </div>

          {tabCat === "custom" && wfDetail ? (
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
              }}
            />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
              {/* Prompt card */}
              {showPrompt && (
                <div className="rounded-2xl border border-white/[0.05] bg-[#0f0f16]/70 p-4">
                  <div className="flex items-center gap-2">
                    <PortIndicator type="prompt" label="正向提示词输入" />
                    <label className={labelClass} style={{ marginBottom: 0 }}>正向提示词</label>
                  </div>
                  <div className="flex items-start gap-2">
                    <PortIndicator type="prompt" side="left" label="从其他节点接收文本" />
                    <textarea
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      rows={3}
                      placeholder={tab === "video" ? "描述你想要的视频画面与运镜…" : "描述你想要的图像…"}
                      className={`${inputClass} resize-none flex-1`}
                    />
                    <PortIndicator type="condition" side="right" label="输出到条件输入" />
                  </div>
                  {showNegative && (
                    <>
                      <div className="mt-3 flex items-center gap-2">
                        <PortIndicator type="condition" label="反向提示词（排除）" />
                        <label className={`${labelClass}`} style={{ marginBottom: 0 }}>反向提示词</label>
                      </div>
                      <div className="flex items-start gap-2">
                        <PortIndicator type="condition" side="left" label="从其他节点接收排除条件" />
                        <textarea
                          value={negative}
                          onChange={(e) => setNegative(e.target.value)}
                          rows={2}
                          placeholder="low quality, blurry…"
                          className={`${inputClass} resize-none flex-1`}
                        />
                        <PortIndicator type="latent" side="right" label="输出到 Latent 空间" />
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Output area */}
              <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-white/[0.05] bg-[#0f0f16]/50 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-[12px] font-semibold text-[#b6bccf]">本次生成</span>
                  <span className="rounded-md bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-violet-300">
                    {tab === "video" ? "视频" : `${images.length > 0 ? images.length : count} 张`}
                  </span>
                </div>

                {status === "running" && (
                  <div className="mb-3 rounded-lg border border-white/[0.06] bg-black/30 p-2.5">
                    <div className="mb-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                      <div className="h-full rounded-full bg-violet-500 transition-all" style={{ width: `${progress}%` }} />
                    </div>
                    <p className="text-center text-[11px] text-gray-400">生成中… {progress}%</p>
                  </div>
                )}

                {images.length > 0 ? (
                  <div className="grid grid-cols-2 gap-3">
                    {images.map((src, i) => {
                      const isVideo = /\.(mp4|webm|gif)$/i.test(src);
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setPreviewImage(src)}
                          className="group relative aspect-square overflow-hidden rounded-xl border border-white/[0.06]"
                        >
                          {isVideo ? (
                            <video src={src} muted className="h-full w-full object-cover" />
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={src} alt={`result ${i}`} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
                          )}
                          <span className="absolute inset-x-0 bottom-0 flex justify-center gap-2 bg-gradient-to-t from-black/70 to-transparent p-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                            <a
                              href={src}
                              download
                              onClick={(e) => e.stopPropagation()}
                              className="rounded bg-white/15 px-2 py-0.5 text-[11px] text-white hover:bg-white/25"
                            >
                              {isVideo ? "下载视频" : "下载"}
                            </a>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="grid flex-1 grid-cols-2 gap-3">
                    {[0, 1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className="relative overflow-hidden rounded-xl border border-white/[0.06] bg-gradient-to-br from-violet-500/10 to-cyan-400/[0.05]"
                      >
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(139,92,246,0.18),transparent_60%)]" />
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_80%,rgba(34,211,238,0.12),transparent_60%)]" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </main>

        {/* ═══ Right: 参数 (320px) ═══ */}
        <aside className="flex w-[320px] shrink-0 flex-col border-l border-white/[0.04] bg-[#0f0f16]/85 backdrop-blur-sm">
          <div className="flex h-11 items-center border-b border-white/[0.04] px-4">
            <span className="text-[13px] font-semibold text-[#e5e7eb]">参数</span>
          </div>

          <div className="flex-1 space-y-3.5 overflow-y-auto p-4">
            {/* ═════ MODE PICKER: 全部 38 种类型按大类分组 ═════ */}
            <div id="mode-picker-section" className="rounded-2xl border border-white/[0.06] bg-[#0f0f16]/80 p-3.5">
              <div className="mb-2.5 flex items-center justify-between">
                <span className="text-[12px] font-semibold text-[#b6bccf]">模式</span>
                {checkpoint && (
                  <span className="text-[10px] text-emerald-400/80">
                    已关联 {modelSupportedTypes.size} 种工作流
                  </span>
                )}
              </div>

              {/* Category accordion headers */}
              <div className="space-y-1.5">
                {WORKFLOW_CATEGORIES.map((cat) => {
                  const types = getWorkflowTypesByCategory(cat);
                  const cfg = MODE_CATEGORY_CONFIG[cat];
                  const expanded = modeCategoryExpanded[cat] ?? false;
                  // When model is selected, count how many types in this category are supported
                  const supportedInCat = checkpoint
                    ? types.filter((t) => modelSupportedTypes.has(t.code)).length
                    : types.length;

                  return (
                    <div key={cat}>
                      {/* Category header row */}
                      <button
                        type="button"
                        onClick={() => setModeCategoryExpanded((prev) => ({ ...prev, [cat]: !prev[cat] }))}
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/[0.03]"
                      >
                        <Icon name={cfg.icon} size={12} style={{ color: cfg.color }} />
                        <span className="flex-1 text-[11.5px] font-medium text-gray-300">{cfg.label}</span>
                        <span className="text-[10px] text-gray-600">
                          {checkpoint ? `${supportedInCat}/${types.length}` : `${types.length}种`}
                        </span>
                        <svg
                          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
                          className={`text-gray-500 transition-transform ${expanded ? "rotate-180" : ""}`}
                        >
                          <path d="M6 9l6 6 6-6" />
                        </svg>
                      </button>

                      {/* Type chips (expanded) */}
                      {expanded && (
                        <div className="ml-4 mt-1 flex flex-wrap gap-1">
                          {types.map((t) => {
                            const isSupported = !checkpoint || modelSupportedTypes.has(t.code);
                            const isActive = tab === t.code;
                            return (
                              <button
                                key={t.code}
                                type="button"
                                disabled={!isSupported}
                                onClick={() => {
                                  // Map workflow code to legacy tab value
                                  setTab(t.code as any);
                                  // Auto-switch to video tab for video types, custom for audio
                                  if (t.category === "video") {
                                    /* keep as-is; video sub-modes handled separately */
                                  }
                                }}
                                title={`${t.label} — ${t.description}${!isSupported ? "（当前模型不支持）" : ""}`}
                                className={`rounded-md px-1.5 py-0.5 text-[10.5px] font-medium transition-all ${
                                  isActive
                                    ? "bg-violet-500/25 text-violet-200 ring-1 ring-violet-500/30"
                                    : isSupported
                                      ? "text-gray-400 hover:bg-white/[0.05] hover:text-gray-200"
                                      : "cursor-not-allowed text-gray-700 opacity-40"
                                }`}
                              >
                                {t.label}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Quick-access: always show current mode badge */}
              <div className="mt-2.5 border-t border-white/[0.04] pt-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-600">当前</span>
                  <span
                    className="rounded-md bg-violet-500/15 px-2 py-0.5 text-[11px] font-medium text-violet-300"
                  >
                    {getWorkflowType(tab)?.label ?? TAB_LABEL[tab] ?? tab}
                  </span>
                  {checkpoint && !modelSupportedTypes.has(tab) && (
                    <span className="inline-flex items-center text-[10px] text-amber-400/80">
                      <Icon name="alert" size={11} className="mr-0.5" /> 未关联
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* ── VIDEO mode ── */}
            {tabCat === "video" && (
              <>
                <div className="flex rounded-lg bg-white/[0.04] p-0.5 text-[11px]">
                  {(
                    [
                      ["t2v", "文生视频"],
                      ["i2v", "图生视频"],
                      ["flf", "首尾帧"],
                    ] as const
                  ).map(([m, l]) => (
                    <button
                      key={m}
                      onClick={() => setVideoMode(m)}
                      className={`flex-1 rounded-md py-1 font-medium transition-colors ${
                        videoMode === m ? "bg-violet-500/20 text-violet-200" : "text-gray-400 hover:text-gray-200"
                      }`}
                    >
                      {l}
                    </button>
                  ))}
                </div>

                {videoMode === "i2v" && (
                  <div>
                    <label className={labelClass}>首帧参考图</label>
                    {fileInput({ label: "首帧参考图", onChange: (f) => uploadFile(f, setInputImage, "首帧"), accept: "image/*" })}
                    {inputImage && <p className="mt-1 truncate text-[11px] text-violet-300">已上传：{inputImage}</p>}
                  </div>
                )}

                {videoMode === "flf" && (
                  <>
                    <div>
                      <label className={labelClass}>首帧参考图</label>
                      {fileInput({ label: "首帧参考图", onChange: (f) => uploadFile(f, setFirstFrame, "首帧"), accept: "image/*" })}
                      {firstFrame && <p className="mt-1 truncate text-[11px] text-violet-300">已上传：{firstFrame}</p>}
                    </div>
                    <div>
                      <label className={labelClass}>尾帧参考图</label>
                      {fileInput({ label: "尾帧参考图", onChange: (f) => uploadFile(f, setLastFrame, "尾帧"), accept: "image/*" })}
                      {lastFrame && <p className="mt-1 truncate text-[11px] text-violet-300">已上传：{lastFrame}</p>}
                    </div>
                    <p className="text-[10px] leading-relaxed text-gray-600">
                      视频将从「首帧」开始、到「尾帧」结束，中间由提示词与运镜驱动生成。需安装 WanVideoWrapper 且使用图生视频（i2v）模型。
                    </p>
                  </>
                )}

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className={labelClass}>帧数</label>
                    <NumberField value={frames} onChange={setFrames} min={17} max={241} step={2} />
                  </div>
                  <div>
                    <label className={labelClass}>帧率</label>
                    <NumberField value={fps} onChange={setFps} min={8} max={30} step={1} />
                  </div>
                </div>

                <div>
                  <label className={labelClass}>分辨率（宽x高）</label>
                  <DarkSelect value={size} onChange={setSize} options={VIDEO_SIZES} />
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className={labelClass}>步数</label>
                    <NumberField value={steps} onChange={setSteps} min={1} max={50} step={1} />
                  </div>
                  <div>
                    <label className={labelClass}>CFG</label>
                    <NumberField value={cfg} onChange={setCfg} min={1} max={20} step={0.5} decimalPlaces={1} />
                  </div>
                </div>

                <div>
                  <label className={labelClass}>种子（留空随机）</label>
                    <div className="mb-1.5 flex gap-1">
                      {([
                        ["random", "dice", "随机", "每次生成自动随机"],
                        ["fixed", "lock", "固定", "手动指定固定值"],
                        ["manual", "pen", "手动", "自由输入数值"],
                      ] as const).map(([mode, iconKey, textLabel, tip]) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => { setSeedMode(mode); if (mode === "random") setSeed(""); }}
                          title={tip}
                          className={`flex items-center rounded-md px-2 py-0.5 text-[10.5px] font-medium transition-all ${
                            seedMode === mode
                              ? "bg-violet-500/20 text-violet-200 ring-1 ring-violet-500/25"
                              : "text-gray-500 hover:bg-white/[0.04] hover:text-gray-300"
                          }`}
                        >
                          <Icon name={iconKey} size={11} className="mr-1 inline align-[-1px]" />{textLabel}
                        </button>
                      ))}
                    </div>
                    {seedMode !== "random" && (
                      <div className="flex gap-1">
                        <input
                          value={seed}
                          onChange={(e) => setSeed(e.target.value.replace(/[^0-9]/g, ""))}
                          placeholder={seedMode === "fixed" ? "输入固定种子值…" : "输入种子…"}
                          className={`${inputClass} font-mono text-xs`}
                        />
                        {seedMode === "fixed" && (
                          <button
                            onClick={() => setSeed(String(Math.floor(Math.random() * 1e15)))}
                            className="rounded-lg border border-white/10 px-2 text-xs text-gray-400 hover:text-gray-200"
                            title="生成随机值填入"
                          >
                            <Icon name="dice" size={12} />
                          </button>
                        )}
                      </div>
                    )}
                </div>

                <button
                  onClick={() => setShowAdvVideo(!showAdvVideo)}
                  className="text-[11px] text-gray-500 hover:text-violet-300"
                >
                  {showAdvVideo ? "▾" : "▸"} 高级：视频模型（WanVideoWrapper）
                </button>
                {showAdvVideo && (
                  <div className="space-y-2 rounded-lg border border-white/[0.06] p-2.5">
                    <div>
                      <label className={labelClass}>Wan 模型</label>
                      <input value={wanModel} onChange={(e) => setWanModel(e.target.value)} placeholder="wan2.1_t2v_1.3B_fp16.safetensors" className={inputClass} />
                    </div>
                    <div>
                      <label className={labelClass}>VAE</label>
                      <input value={wanVae} onChange={(e) => setWanVae(e.target.value)} placeholder="wan_2.1_vae.safetensors" className={inputClass} />
                    </div>
                    <div>
                      <label className={labelClass}>T5 文本编码器</label>
                      <input value={t5Model} onChange={(e) => setT5Model(e.target.value)} placeholder="umt5_xxl_fp16.safetensors" className={inputClass} />
                    </div>
                    <p className="text-[10px] leading-relaxed text-gray-600">
                      需安装 ComfyUI-WanVideoWrapper 及对应模型。你也可在「自定义」中导入自己的视频工作流。
                    </p>
                  </div>
                )}
              </>
            )}

            {/* ── EDIT mode ── */}
            {tabCat === "edit" && (
              <>
                <div className="flex rounded-lg bg-white/[0.04] p-0.5 text-[11px]">
                  {(
                    [
                      ["inpaint", "局部重绘"],
                      ["upscale", "高清修复"],
                    ] as const
                  ).map(([m, l]) => (
                    <button
                      key={m}
                      onClick={() => setEditMode(m)}
                      className={`flex-1 rounded-md py-1 font-medium transition-colors ${
                        editMode === m ? "bg-violet-500/20 text-violet-200" : "text-gray-400 hover:text-gray-200"
                      }`}
                    >
                      {l}
                    </button>
                  ))}
                </div>

                <div>
                  <div className="flex items-center gap-2">
                    <PortIndicator type="image" label="编辑输入图像" />
                    <label className={labelClass} style={{ marginBottom: 0 }}>参考图</label>
                  </div>
                  <div className="flex items-start gap-2">
                    <PortIndicator type="image" side="left" />
                    <div className="flex-1">
                      {fileInput({ label: "参考图", onChange: (f) => uploadFile(f, setInputImage), accept: "image/*" })}
                      {inputImage && <p className="mt-1 truncate text-[11px] text-violet-300">已上传：{inputImage}</p>}
                    </div>
                  </div>
                </div>

                {editMode === "inpaint" && (
                  <>
                    <div>
                      <div className="flex items-center gap-2">
                        <PortIndicator type="image" label="重绘蒙版（MASK）" />
                        <label className={labelClass} style={{ marginBottom: 0 }}>重绘蒙版（可选，PNG 透明通道即重绘区）</label>
                      </div>
                      <div className="flex items-start gap-2">
                        <PortIndicator type="image" side="left" />
                        <div className="flex-1">
                          {fileInput({ label: "蒙版", onChange: (f) => uploadFile(f, setMaskImage), accept: "image/*" })}
                          {maskImage && <p className="mt-1 truncate text-[11px] text-violet-300">已上传：{maskImage}</p>}
                        </div>
                      </div>
                    </div>
                    <div>
                      <label className={labelClass}>大模型（Checkpoint）</label>
                      <DarkSelect
                        value={checkpoint}
                        onChange={setCheckpoint}
                        options={["", ...checkpoints.map((m) => m.fileName)]}
                        labels={Object.fromEntries(checkpoints.map((m) => [m.fileName, m.name]))}
                        placeholder="请选择…"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className={labelClass}>步数</label>
                        <NumberField value={steps} onChange={setSteps} min={1} max={50} step={1} />
                      </div>
                      <div>
                        <label className={labelClass}>重绘幅度</label>
                        <NumberField value={denoise} onChange={setDenoise} min={0} max={1} step={0.05} decimalPlaces={2} />
                      </div>
                    </div>
                  </>
                )}

                {editMode === "upscale" && (
                  <div>
                    <label className={labelClass}>放大模型</label>
                    <input value={upscaleModel} onChange={(e) => setUpscaleModel(e.target.value)} placeholder="4x-UltraSharp.pth" className={inputClass} />
                  </div>
                )}
              </>
            )}

            {/* ── Checkpoint (txt2img / img2img / custom) ── */}
            {(tabCat === "txt2img" || tabCat === "img2img" || tabCat === "custom") && (
              <div>
                <label className={labelClass}>
                  大模型（Checkpoint）{tabCat === "custom" && <span className="text-gray-600">· 可选</span>}
                </label>
                <DarkSelect
                  value={checkpoint}
                  onChange={setCheckpoint}
                  options={["", ...checkpoints.map((m) => m.fileName)]}
                  labels={Object.fromEntries(checkpoints.map((m) => [m.fileName, m.name]))}
                  placeholder={tabCat === "custom" ? "使用工作流自带模型" : "请选择…"}
                />
              </div>
            )}

            {/* ── img2img denoise ── */}
            {tabCat === "img2img" && (
              <div>
                <label className={labelClass}>重绘幅度</label>
                <NumberField value={denoise} onChange={setDenoise} min={0} max={1} step={0.05} decimalPlaces={2} />
              </div>
            )}

            {/* ── Sampler / Scheduler (image modes) ── */}
            {(tabCat === "txt2img" || tabCat === "img2img" || tabCat === "custom") && (
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className={labelClass}>采样器</label>
                  <DarkSelect value={sampler} onChange={setSampler} options={SAMPLERS} />
                </div>
                <div>
                  <label className={labelClass}>调度器</label>
                  <DarkSelect value={scheduler} onChange={setScheduler} options={SCHEDULERS} />
                </div>
              </div>
            )}

            {/* ── Steps / CFG / Count (image modes) ── */}
            {(tabCat === "txt2img" || tabCat === "img2img") && (
              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label className={labelClass}>步数</label>
                  <NumberField value={steps} onChange={setSteps} min={1} max={50} step={1} />
                </div>
                <div>
                  <label className={labelClass}>CFG</label>
                  <NumberField value={cfg} onChange={setCfg} min={1} max={20} step={0.5} decimalPlaces={1} />
                </div>
                <div>
                  <label className={labelClass}>数量</label>
                  <NumberField value={count} onChange={setCount} min={1} max={4} step={1} />
                </div>
              </div>
            )}

            {/* ── Size / Seed (image modes) ── */}
            {(tabCat === "txt2img" || tabCat === "img2img") && (
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className={labelClass}>尺寸</label>
                  <DarkSelect value={size} onChange={setSize} options={SIZES} />
                </div>
                <div>
                  <label className={labelClass}>种子（留空随机）</label>
                  {/* Tips-style seed mode selector */}
                  <div className="mb-1.5 flex gap-1">
                    {([
                      ["random", "dice", "随机", "每次生成自动随机"],
                      ["fixed", "lock", "固定", "手动指定固定值"],
                      ["manual", "pen", "手动", "自由输入数值"],
                    ] as const).map(([mode, iconKey, textLabel, tip]) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => { setSeedMode(mode); if (mode === "random") setSeed(""); }}
                        title={tip}
                        className={`flex items-center rounded-md px-2 py-0.5 text-[10.5px] font-medium transition-all ${
                          seedMode === mode
                            ? "bg-violet-500/20 text-violet-200 ring-1 ring-violet-500/25"
                            : "text-gray-500 hover:bg-white/[0.04] hover:text-gray-300"
                        }`}
                      >
                        <Icon name={iconKey} size={11} className="mr-1 inline align-[-1px]" />{textLabel}
                      </button>
                    ))}
                  </div>
                  {/* Seed value input (shown only in fixed/manual mode) */}
                  {seedMode !== "random" && (
                    <div className="flex gap-1">
                      <input
                        value={seed}
                        onChange={(e) => setSeed(e.target.value.replace(/[^0-9]/g, ""))}
                        placeholder={seedMode === "fixed" ? "输入固定种子值…" : "输入种子…"}
                        className={`${inputClass} font-mono text-xs`}
                      />
                      {seedMode === "fixed" && (
                        <button
                          onClick={() => setSeed(String(Math.floor(Math.random() * 1e15)))}
                          className="rounded-lg border border-white/10 px-2 text-xs text-gray-400 hover:text-gray-200"
                          title="生成随机值填入"
                        >
                          <Icon name="dice" size={12} />
                        </button>
                      )}
                    </div>
                  )}
                  {seedMode === "random" && (
                    <p className="text-[10px] text-gray-600">生成时将使用完全随机的种子值</p>
                  )}
                </div>
              </div>
            )}

            {/* ── LoRA (txt2img / img2img) ── */}
            {(tabCat === "txt2img" || tabCat === "img2img") && (
              <div>
                <label className={labelClass}>LoRA（可叠加）</label>
                <div className="space-y-2">
                  {loras.map((l, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <DarkSelect
                        value={l.name}
                        onChange={(v) => { const next = [...loras]; next[i]!.name = v; setLoras(next); }}
                        options={["", ...loraOpts.map((m) => m.fileName)]}
                        labels={Object.fromEntries(loraOpts.map((m) => [m.fileName, m.name]))}
                        placeholder="选择 LoRA…"
                        className="flex-1"
                      />
                      <NumberField
                        value={l.weight}
                        onChange={(v) => { const next = [...loras]; next[i]!.weight = v; setLoras(next); }}
                        min={-2} max={2} step={0.05} decimalPlaces={2}
                        className="w-16"
                      />
                      <button onClick={() => setLoras(loras.filter((_, j) => j !== i))} className="text-gray-500 hover:text-gray-200">
                        ✕
                      </button>
                    </div>
                  ))}
                  <button onClick={() => setLoras([...loras, { name: "", weight: 0.8 }])} className="text-xs text-violet-400 hover:underline">
                    + 添加 LoRA
                  </button>
                </div>
              </div>
            )}

            {/* ── custom workflow picker (with type filter) ── */}
            {tabCat === "custom" && (
              <div className="space-y-2.5">
                {/* Category tabs */}
                <div>
                  <label className={labelClass}>工作流类型</label>
                  <div className="flex rounded-lg bg-white/[0.04] p-0.5 text-[11px]">
                    {(["image", "video", "audio"] as WorkflowCategory[]).map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => {
                          setWfCategory(cat);
                          setWfTypeFilter("");
                        }}
                        className={`flex-1 rounded-md py-1.5 font-medium transition-colors ${
                          wfCategory === cat
                            ? "bg-violet-500/20 text-violet-200"
                            : "text-gray-400 hover:text-gray-200"
                        }`}
                      >
                        <Icon
                          name={cat === "image" ? "image" : cat === "video" ? "film" : "music"}
                          size={12}
                          className="mr-1 inline align-[-1px]"
                        />
                        {cat === "image" ? "图像" : cat === "video" ? "视频" : "音频"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Type chips within category */}
                {(() => {
                  const typesInCat = getWorkflowTypesByCategory(wfCategory);
                  return (
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => setWfTypeFilter("")}
                        className={`rounded-full border px-2 py-0.5 text-[10.5px] font-medium transition-colors ${
                          !wfTypeFilter
                            ? "border-violet-500/50 bg-violet-500/15 text-violet-300"
                            : "border-white/[0.08] text-gray-500 hover:text-gray-300"
                        }`}
                      >
                        全部
                      </button>
                      {typesInCat.map((t) => (
                        <button
                          key={t.code}
                          type="button"
                          onClick={() => setWfTypeFilter(t.code)}
                          className={`rounded-full border px-2 py-0.5 text-[10.5px] font-medium transition-colors ${
                            wfTypeFilter === t.code
                              ? "border-violet-500/50 bg-violet-500/15 text-violet-300"
                              : "border-white/[0.08] text-gray-500 hover:text-gray-300"
                          }`}
                          title={t.description}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  );
                })()}

                {/* Workflow select */}
                <div>
                  <label className={labelClass}>
                    自定义工作流
                    {wfTypeFilter && (
                      <span className="ml-1.5 text-violet-400">
                        · {getWorkflowType(wfTypeFilter)?.label ?? wfTypeFilter}
                      </span>
                    )}
                  </label>
                  <DarkSelect
                    value={customId}
                    onChange={setCustomId}
                    options={["", ...customWorkflows.map((w) => w.id)]}
                    labels={Object.fromEntries(customWorkflows.map((w) => [w.id, w.name + (w.typeLabel ? ` [${w.typeLabel}]` : "")]))}
                    placeholder="选择已导入工作流…"
                  />
                  {customWorkflows.length === 0 && (
                    <p className="mt-1 text-[10.5px] text-gray-600">
                      该类型暂无已导入工作流。可在「工作流库」中导入 ComfyUI API 格式 JSON。
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* ── Param mapping config (when custom workflow selected) ── */}
            {tabCat === "custom" && customId && wfDetail && (
              <WorkflowParamConfig
                workflowId={customId}
                nodes={wfDetail.nodes}
                initialParamMap={wfDetail.paramMap ?? paramMap}
                compact
                onSave={(pm) => setParamMap(pm)}
              />
            )}

            {tabCat === "custom" && customId && wfDetail && (
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                <p className="mb-2 text-[12px] font-semibold text-gray-200">工作流参数</p>
                <DynamicWorkflowForm
                  io={wfDetail.workflowIO ?? undefined}
                  values={customInputs}
                  onChange={setCustomInputs}
                  workflowId={customId}
                  /* R-ardot22 (2026-08-14): 取消 showOutputs —— 紫圆点
                     (images output PortHandle) 在 CreatePanel 上是视觉污染，
                     工作流的输出在 IO-edit modal 里配置，这里只展示用户
                     能填的表单。画布 workflow 节点同样默认 false (R-ardot21)。*/
                  emptyHint={
                    <>
                      该工作流尚未标记对外参数。
                      <br />
                      点击上方「参数配置」勾选要暴露的输入/输出，保存后这里会出现对应的表单。
                    </>
                  }
                />
              </div>
            )}

            {error && (
              <div className="space-y-1.5">
                <p className="text-xs text-red-400">{error}</p>
                <ValidationErrorList errors={validationErrors} className="text-red-300" />
              </div>
            )}

            <button
              onClick={generate}
              disabled={status === "running" || uploading}
              className="w-full rounded-xl bg-violet-500 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-violet-400 disabled:opacity-50"
            >
              {status === "running" ? `生成中… ${progress}%` : tab === "video" ? "开始生成视频" : "开始生成"}
            </button>

            {/* Logs */}
            {logs.length > 0 && (
              <div className="rounded-lg border border-white/[0.06] bg-black/30 p-2.5 font-mono text-[11px] leading-relaxed">
                {logs.map((l, i) => (
                  <div
                    key={i}
                    className={
                      l.level === "error"
                        ? "text-red-400"
                        : l.level === "success"
                        ? "text-emerald-400"
                        : l.level === "progress"
                        ? "text-violet-300"
                        : "text-gray-400"
                    }
                  >
                    {l.msg}
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* ── Status Bar ── */}
      <footer className="relative z-10 flex h-6 shrink-0 items-center justify-center gap-2 border-t border-white/[0.04] bg-[#0f0f16]/95 backdrop-blur-sm">
        <span className="inline-block h-[7px] w-[7px] rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/40" />
        <span className="text-[11px] text-[#6b788f]">
          {status === "running" ? `生成中 · ${progress}%` : status === "error" ? "生成失败 · 请重试" : status === "done" ? `已完成 · ${images.length} 个文件` : "本机 ComfyUI 就绪 · 本地算力 · 零授权"}
        </span>
      </footer>

      {/* ── Image preview modal ── */}
      {previewImage && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 p-6"
          onClick={() => setPreviewImage(null)}
        >
          <div className="relative max-h-full max-w-4xl" onClick={(e) => e.stopPropagation()}>
            {/\.(mp4|webm|gif)$/i.test(previewImage) ? (
              <video src={previewImage} controls autoPlay className="max-h-[85vh] w-auto rounded-xl border border-white/10" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewImage} alt="preview" className="max-h-[85vh] w-auto rounded-xl border border-white/10" />
            )}
            <div className="mt-3 flex justify-center gap-3">
              <a
                href={previewImage}
                download
                className="rounded-lg bg-violet-500 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-400"
              >
                下载原文件
              </a>
              <button
                onClick={() => setPreviewImage(null)}
                className="rounded-lg border border-white/15 px-4 py-2 text-sm text-gray-200 hover:bg-white/5"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
