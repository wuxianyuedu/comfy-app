"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { SkillSelector } from "@/components/skill";
import type { SkillData } from "@/components/skill";
import type { WorkspaceView } from "@/components/updream";
import { useToast } from "@/components/updream/Toast";

const WorkflowCanvas = dynamic(
  () => import("@/components/workflow-canvas").then((m) => ({ default: m.WorkflowCanvas })),
  { ssr: false }
);

type ModelOpt = { id: string; fileName: string; name: string };
type WorkflowOpt = { id: string; name: string; taskType: string };
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
  initialPrompt,
  initialNegative,
  initialParams,
  autoStart = false,
  onBack,
  onNavigate,
}: {
  initialSkill?: SkillShort | null;
  initialMode?: "txt2img" | "img2img" | "video" | "edit" | "custom";
  initialPrompt?: string;
  initialNegative?: string;
  initialParams?: Partial<{ steps: number; cfg: number; sampler: string; scheduler: string; size: string }>;
  autoStart?: boolean;
  onBack?: () => void;
  onNavigate?: (v: WorkspaceView) => void;
}) {
  const toast = useToast();

  const [tab, setTab] = useState<"txt2img" | "img2img" | "video" | "edit" | "custom">(initialMode);
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

  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [taskId, setTaskId] = useState("");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [uploading, setUploading] = useState(false);

  // custom workflow graph
  const [wfDetail, setWfDetail] = useState<{ graph: Record<string, any>; nodes: WfNode[]; paramMap: ParamMap } | null>(null);
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

  const fetchModels = useCallback(() => {
    fetch("/api/models?type=CHECKPOINT")
      .then((r) => r.json())
      .then((d) => setCheckpoints(d.models ?? []));
    fetch("/api/models?type=LORA")
      .then((r) => r.json())
      .then((d) => setLoraOpts(d.models ?? []));
    fetch("/api/workflows")
      .then((r) => r.json())
      .then((d) => setCustomWorkflows(d.workflows ?? []));
  }, []);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

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
    fetch(`/api/workflows/${customId}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.graph) {
          setWfDetail({ graph: d.graph, nodes: d.nodes, paramMap: d.paramMap ?? {} });
          setParamMap(d.paramMap ?? {});
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [tab, customId]);

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
    if (!prompt.trim() && !(tab === "edit" && editMode === "upscale")) {
      setError("请输入正向提示词");
      toast.error("请输入提示词");
      return;
    }
    // Default to the first available checkpoint so Agent/auto flows don't stall.
    const effCkpt = checkpoint || (checkpoints[0]?.fileName ?? "");
    if (tab === "custom") {
      if (!customId) {
        setError("请先选择或导入一个自定义工作流");
        toast.error("请选择工作流");
        return;
      }
    } else if (tab === "edit") {
      if (!inputImage) {
        setError("请先上传参考图");
        toast.error("请上传参考图");
        return;
      }
    } else if (tab === "video") {
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
        tab === "custom"
          ? customId
          : tab === "video"
          ? videoMode === "t2v"
            ? "txt2video"
            : videoMode === "i2v"
            ? "img2video"
            : "flfvideo"
          : tab === "edit"
          ? editMode
          : tab,
      prompt: prompt.trim(),
      negative: negative.trim() || undefined,
    };
    if (selectedSkill) {
      payload.skillId = selectedSkill.id;
      payload.skillName = selectedSkill.name;
      payload.skillSlug = selectedSkill.slug;
    }

    if (tab === "video") {
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
    } else if (tab === "edit") {
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
    } else if (tab === "custom") {
      if (canvasGraph && Object.keys(canvasGraph).length) payload.canvasGraph = canvasGraph;
      if (Object.keys(paramMap).length) payload.paramMap = paramMap;
      if (effCkpt) payload.checkpoint = effCkpt;
      Object.assign(payload, { steps, cfg, sampler, scheduler });
      if (seed) payload.seed = Number(seed);
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
      if (tab === "img2img") {
        payload.denoise = denoise;
        payload.inputImage = inputImage;
      }
    }

    setStatus("running");
    setProgress(0);
    setImages([]);
    setLogs([]);

    const loadId = toast.loading("正在提交生成任务…");

    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const d = await res.json();
    if (!res.ok) {
      setStatus("error");
      setError(d.error ?? "提交失败");
      toast.update(loadId, { kind: "error", title: "提交失败", description: d.error, duration: 4000 });
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
          es.close();
          toast.update(loadId, { kind: "error", title: "生成失败", description: msg.error, duration: 5000 });
        }
      } else if (msg.type === "done") {
        setStatus("done");
        setProgress(100);
        fetch(`/api/tasks/${d.taskId}`)
          .then((r) => r.json())
          .then((td) => {
            const imgs = (td.task?.images ?? []).map((i: any) => i.localPath) as string[];
            setImages(imgs);
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

  const fileInput = (
    label: string,
    onChange: (f: File) => void,
    accept = "image/*"
  ) => (
    <input
      type="file"
      accept={accept}
      onChange={(e) => e.target.files?.[0] && onChange(e.target.files[0])}
      className="block w-full text-xs text-gray-400 file:mr-3 file:rounded-lg file:border-0 file:bg-violet-500/15 file:px-3 file:py-1.5 file:text-violet-200"
    />
  );

  return (
    <div className="flex min-w-0 flex-1">
      {/* ── Params aside ── */}
      <aside className="flex w-[400px] shrink-0 flex-col border-r border-white/[0.06] bg-[#0c0c12]">
        {/* top bar */}
        <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2.5">
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
          <h2 className="flex-1 text-sm font-semibold text-gray-100">创作台</h2>
          <div className="flex flex-wrap gap-0.5 rounded-lg bg-white/[0.04] p-0.5 text-[11px]">
            {(
              [
                ["txt2img", "文生图"],
                ["img2img", "图生图"],
                ["video", "视频"],
                ["edit", "编辑"],
                ["custom", "自定义"],
              ] as const
            ).map(([t, label]) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded-md px-2 py-1 font-medium transition-colors ${
                  tab === t ? "bg-violet-500/20 text-violet-200" : "text-gray-400 hover:text-gray-200"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto px-3.5 py-3.5">
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

          {/* ── Prompt (all modes except pure upscale) ── */}
          {tab !== "edit" || editMode !== "upscale" ? (
            <div>
              <label className={labelClass}>正向提示词</label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                placeholder={tab === "video" ? "描述你想要的视频画面与运镜…" : "描述你想要的图像…"}
                className={`${inputClass} resize-none`}
              />
            </div>
          ) : null}

          {tab !== "video" && tab !== "edit" && tab !== "custom" && (
            <div>
              <label className={labelClass}>反向提示词</label>
              <textarea
                value={negative}
                onChange={(e) => setNegative(e.target.value)}
                rows={2}
                placeholder="low quality, blurry…"
                className={`${inputClass} resize-none`}
              />
            </div>
          )}

          {/* ── VIDEO mode ── */}
          {tab === "video" && (
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
                  {fileInput("首帧参考图", (f) => uploadFile(f, setInputImage, "首帧"), "image/*")}
                  {inputImage && <p className="mt-1 truncate text-[11px] text-violet-300">已上传：{inputImage}</p>}
                </div>
              )}

              {videoMode === "flf" && (
                <>
                  <div>
                    <label className={labelClass}>首帧参考图</label>
                    {fileInput("首帧参考图", (f) => uploadFile(f, setFirstFrame, "首帧"), "image/*")}
                    {firstFrame && <p className="mt-1 truncate text-[11px] text-violet-300">已上传：{firstFrame}</p>}
                  </div>
                  <div>
                    <label className={labelClass}>尾帧参考图</label>
                    {fileInput("尾帧参考图", (f) => uploadFile(f, setLastFrame, "尾帧"), "image/*")}
                    {lastFrame && <p className="mt-1 truncate text-[11px] text-violet-300">已上传：{lastFrame}</p>}
                  </div>
                  <p className="text-[10px] leading-relaxed text-gray-600">
                    视频将从「首帧」开始、到「尾帧」结束，中间由提示词与运镜驱动生成。需安装 WanVideoWrapper 且使用图生视频（i2v）模型。
                  </p>
                </>
              )}

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className={labelClass}>帧数 {frames}</label>
                  <input type="range" min={17} max={241} step={2} value={frames} onChange={(e) => setFrames(Number(e.target.value))} className="w-full accent-violet-500" />
                </div>
                <div>
                  <label className={labelClass}>帧率 {fps}</label>
                  <input type="range" min={8} max={30} value={fps} onChange={(e) => setFps(Number(e.target.value))} className="w-full accent-violet-500" />
                </div>
              </div>

              <div>
                <label className={labelClass}>分辨率（宽x高）</label>
                <select value={size} onChange={(e) => setSize(e.target.value)} className={selectClass}>
                  {VIDEO_SIZES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label className={labelClass}>步数 {steps}</label>
                  <input type="range" min={1} max={50} value={steps} onChange={(e) => setSteps(Number(e.target.value))} className="w-full accent-violet-500" />
                </div>
                <div>
                  <label className={labelClass}>CFG {cfg}</label>
                  <input type="range" min={1} max={20} step={0.5} value={cfg} onChange={(e) => setCfg(Number(e.target.value))} className="w-full accent-violet-500" />
                </div>
                <div>
                  <label className={labelClass}>种子</label>
                  <input
                    value={seed}
                    onChange={(e) => setSeed(e.target.value.replace(/[^0-9]/g, ""))}
                    placeholder="随机"
                    className={inputClass}
                  />
                </div>
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
          {tab === "edit" && (
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
                <label className={labelClass}>参考图</label>
                {fileInput("参考图", (f) => uploadFile(f, setInputImage), "image/*")}
                {inputImage && <p className="mt-1 truncate text-[11px] text-violet-300">已上传：{inputImage}</p>}
              </div>

              {editMode === "inpaint" && (
                <>
                  <div>
                    <label className={labelClass}>重绘蒙版（可选，PNG 透明通道即重绘区）</label>
                    {fileInput("蒙版", (f) => uploadFile(f, setMaskImage), "image/*")}
                    {maskImage && <p className="mt-1 truncate text-[11px] text-violet-300">已上传：{maskImage}</p>}
                  </div>
                  <div>
                    <label className={labelClass}>大模型（Checkpoint）</label>
                    <select value={checkpoint} onChange={(e) => setCheckpoint(e.target.value)} className={selectClass}>
                      <option value="">请选择…</option>
                      {checkpoints.map((m) => (
                        <option key={m.id} value={m.fileName}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className={labelClass}>步数 {steps}</label>
                      <input type="range" min={1} max={50} value={steps} onChange={(e) => setSteps(Number(e.target.value))} className="w-full accent-violet-500" />
                    </div>
                    <div>
                      <label className={labelClass}>重绘幅度 {denoise}</label>
                      <input type="range" min={0} max={1} step={0.05} value={denoise} onChange={(e) => setDenoise(Number(e.target.value))} className="w-full accent-violet-500" />
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

          {/* ── REFERENCE image (img2img) ── */}
          {tab === "img2img" && (
            <div>
              <label className={labelClass}>参考图</label>
              {fileInput("参考图", (f) => uploadFile(f, setInputImage), "image/*")}
              {inputImage && <p className="mt-1 truncate text-[11px] text-violet-300">已上传：{inputImage}</p>}
            </div>
          )}

          {/* ── Checkpoint (txt2img / img2img / custom) ── */}
          {tab === "txt2img" || tab === "img2img" || tab === "custom" ? (
            <div>
              <label className={labelClass}>
                大模型（Checkpoint）{tab === "custom" && <span className="text-gray-600">· 可选</span>}
              </label>
              <select value={checkpoint} onChange={(e) => setCheckpoint(e.target.value)} className={selectClass}>
                <option value="">{tab === "custom" ? "使用工作流自带模型" : "请选择…"}</option>
                {checkpoints.map((m) => (
                  <option key={m.id} value={m.fileName}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {/* ── img2img denoise ── */}
          {tab === "img2img" && (
            <div>
              <label className={labelClass}>重绘幅度 {denoise}</label>
              <input type="range" min={0} max={1} step={0.05} value={denoise} onChange={(e) => setDenoise(Number(e.target.value))} className="w-full accent-violet-500" />
            </div>
          )}

          {/* ── Sampler / Scheduler (image modes) ── */}
          {(tab === "txt2img" || tab === "img2img" || tab === "custom") && (
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className={labelClass}>采样器</label>
                <select value={sampler} onChange={(e) => setSampler(e.target.value)} className={selectClass}>
                  {SAMPLERS.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>调度器</label>
                <select value={scheduler} onChange={(e) => setScheduler(e.target.value)} className={selectClass}>
                  {SCHEDULERS.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* ── Steps / CFG / Count (image modes) ── */}
          {(tab === "txt2img" || tab === "img2img") && (
            <div className="grid grid-cols-3 gap-2.5">
              <div>
                <label className={labelClass}>步数 {steps}</label>
                <input type="range" min={1} max={50} value={steps} onChange={(e) => setSteps(Number(e.target.value))} className="w-full accent-violet-500" />
              </div>
              <div>
                <label className={labelClass}>CFG {cfg}</label>
                <input type="range" min={1} max={20} step={0.5} value={cfg} onChange={(e) => setCfg(Number(e.target.value))} className="w-full accent-violet-500" />
              </div>
              <div>
                <label className={labelClass}>数量 {count}</label>
                <input type="range" min={1} max={4} value={count} onChange={(e) => setCount(Number(e.target.value))} className="w-full accent-violet-500" />
              </div>
            </div>
          )}

          {/* ── Size / Seed (image modes) ── */}
          {(tab === "txt2img" || tab === "img2img") && (
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className={labelClass}>尺寸</label>
                <select value={size} onChange={(e) => setSize(e.target.value)} className={selectClass}>
                  {SIZES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>种子</label>
                <div className="flex gap-1">
                  <input
                    value={seed}
                    onChange={(e) => setSeed(e.target.value.replace(/[^0-9]/g, ""))}
                    placeholder="随机"
                    className={inputClass}
                  />
                  <button
                    onClick={() => setSeed(String(Math.floor(Math.random() * 1e15)))}
                    className="rounded-lg border border-white/10 px-2 text-xs text-gray-400 hover:text-gray-200"
                    title="随机种子"
                  >
                    🎲
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── LoRA (txt2img / img2img) ── */}
          {(tab === "txt2img" || tab === "img2img") && (
            <div>
              <label className={labelClass}>LoRA（可叠加）</label>
              <div className="space-y-2">
                {loras.map((l, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <select
                      value={l.name}
                      onChange={(e) => {
                        const next = [...loras];
                        next[i].name = e.target.value;
                        setLoras(next);
                      }}
                      className={`${selectClass} flex-1`}
                    >
                      <option value="">选择 LoRA…</option>
                      {loraOpts.map((m) => (
                        <option key={m.id} value={m.fileName}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      step={0.05}
                      value={l.weight}
                      onChange={(e) => {
                        const next = [...loras];
                        next[i].weight = Number(e.target.value);
                        setLoras(next);
                      }}
                      className={`${inputClass} w-16`}
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

          {/* ── custom workflow picker ── */}
          {tab === "custom" && (
            <div>
              <label className={labelClass}>自定义工作流</label>
              <select value={customId} onChange={(e) => setCustomId(e.target.value)} className={selectClass}>
                <option value="">选择已导入工作流…</option>
                {customWorkflows.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {error && <p className="text-xs text-red-400">{error}</p>}

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

          {/* Results */}
          {(status === "done" || images.length > 0) && (
            <div>
              <p className={labelClass}>生成结果</p>
              <div className="grid grid-cols-2 gap-2">
                {images.map((src, i) => {
                  const isVideo = /\.(mp4|webm|gif)$/i.test(src);
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setPreviewImage(src)}
                      className="group relative aspect-square overflow-hidden rounded-lg border border-white/[0.06]"
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
            </div>
          )}

          {status === "running" && (
            <div className="rounded-lg border border-white/[0.06] bg-black/30 p-3">
              <div className="mb-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-violet-500 transition-all" style={{ width: `${progress}%` }} />
              </div>
              <p className="text-center text-[11px] text-gray-400">生成中… {progress}%</p>
            </div>
          )}
        </div>
      </aside>

      {/* ── Canvas center ── */}
      <main className="relative min-w-0 flex-1 overflow-hidden bg-[#0a0a0f]">
        {tab === "custom" && wfDetail ? (
          <WorkflowCanvas
            initialGraph={wfDetail.graph}
            initialParamMap={wfDetail.paramMap ?? paramMap}
            checkpoints={checkpoints.map((c) => c.fileName)}
            onGraphChange={(graph, pm) => {
              setCanvasGraph(graph);
              setParamMap(pm);
            }}
          />
        ) : (
          <div className="grid h-full place-items-center text-center">
            <div className="max-w-sm px-6">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-500/10 text-2xl">
                {tab === "video" ? "🎬" : tab === "edit" ? "🛠️" : tab === "img2img" ? "🖼️" : "🎨"}
              </div>
              <p className="text-base font-medium text-gray-200">
                {tab === "video"
                  ? videoMode === "t2v"
                    ? "文生视频模式"
                    : videoMode === "flf"
                    ? "首尾帧模式"
                    : "图生视频模式"
                  : tab === "edit"
                  ? editMode === "inpaint"
                    ? "局部重绘模式"
                    : "高清修复模式"
                  : tab === "txt2img"
                  ? "文生图模式"
                  : tab === "img2img"
                  ? "图生图模式"
                  : "自定义工作流"}
              </p>
              <p className="mt-1.5 text-sm text-gray-500">
                在左侧设置参数后点击「{tab === "video" ? "开始生成视频" : "开始生成"}」。
                {tab !== "custom" && tab !== "video" && tab !== "edit" && "生成结果将显示在此处。"}
                {tab === "video" && "视频生成后可在「我的作品」中播放与下载。"}
              </p>
              {checkpoints.length === 0 && tab !== "video" && tab !== "edit" && (
                <p className="mt-3 text-xs text-amber-400/80">提示：尚未检测到本地模型，请先在 ComfyUI 中安装 Checkpoint。</p>
              )}
            </div>
          </div>
        )}
      </main>

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
