"use client";

import React, { useEffect, useState } from "react";
import { Handle, Position, useReactFlow, type NodeProps } from "@xyflow/react";
import {
  CanvasNodeData,
  CanvasNodeType,
  NODE_META,
  IMAGE_SIZES,
  VIDEO_SIZES,
  defaultData,
} from "./canvas-types";
import {
  uploadImageFile,
  startGenerate,
  pollTask,
  runScript,
} from "./canvas-helpers";
import { chatAgent } from "@/lib/agent/agentic";

/* ── Small shared UI primitives ── */
const inputCls =
  "w-full rounded-md border border-white/[0.08] bg-black/30 px-2 py-1 text-[12px] text-gray-200 outline-none focus:border-violet-400/60";
const btnCls =
  "rounded-md bg-violet-500/90 px-2.5 py-1 text-[12px] font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-40";
const ghostBtnCls =
  "rounded-md border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[12px] text-gray-300 transition-colors hover:bg-white/[0.06]";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-gray-400">{label}</span>
      {children}
    </label>
  );
}

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
    <div className="flex rounded-md bg-black/30 p-0.5 text-[11px]">
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

function ResultThumb({ path, mediaType }: { path?: string; mediaType?: string }) {
  if (!path) return null;
  const src = path.startsWith("/") ? path : `/${path}`;
  if (mediaType === "video" || /\.(mp4|webm|ogg)$/i.test(src)) {
    return (
      <video
        src={src}
        controls
        autoPlay
        loop
        muted
        className="mt-2 w-full rounded-lg"
        style={{ maxHeight: 240 }}
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt="result"
      className="mt-2 w-full rounded-lg"
      style={{ maxHeight: 240, objectFit: "cover" }}
    />
  );
}

function StatusDot({ status }: { status: CanvasNodeData["status"] }) {
  const color =
    status === "running"
      ? "#FBBF24"
      : status === "done"
      ? "#34D399"
      : status === "error"
      ? "#F87171"
      : "#6B7280";
  return (
    <span
      className="inline-block h-2 w-2 rounded-full"
      style={{ background: color, boxShadow: `0 0 6px ${color}` }}
    />
  );
}

/* ── Main node component ── */
export function CanvasNode({ id, data }: NodeProps<CanvasNodeType>) {
  const d = data as CanvasNodeData;
  const { setNodes, getNode } = useReactFlow();
  const meta = NODE_META[d.kind];

  const patch = (p: Partial<CanvasNodeData>) =>
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id ? { ...n, data: { ...(n.data as CanvasNodeData), ...p } } : n
      )
    );
  const deleteSelf = () => setNodes((nds) => nds.filter((n) => n.id !== id));

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
  const [wfList, setWfList] = useState<{ id: string; name: string; taskType?: string }[]>([]);
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
          prompt: d.prompt,
          negative: d.negative || undefined,
          steps: d.steps,
          cfg: d.cfg,
        };
        if (d.seed.trim()) payload.seed = Number(d.seed);
        // Feed an upstream-generated image into this workflow (auto-chained).
        if (d.inputImage) payload.inputImage = d.inputImage;
        const taskId = await startGenerate(payload);
        patch({ taskId });
        const result = await pollTask(taskId);
        if (result) {
          patch({
            status: "done",
            resultPath: result.localPath,
            resultMediaType: result.mediaType,
          });
          window.dispatchEvent(
            new CustomEvent("canvas:produce", {
              detail: { id, resultPath: result.localPath, resultMediaType: result.mediaType },
            })
          );
        } else patch({ status: "error", error: "生成失败或无结果" });
      } catch (e: any) {
        patch({ status: "error", error: e?.message ?? "生成失败" });
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
      if (result) {
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
      } else patch({ status: "error", error: "生成失败或无结果" });
    } catch (e: any) {
      patch({ status: "error", error: e?.message ?? "生成失败" });
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
      if (result) {
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
      } else patch({ status: "error", error: "生成失败" });
    } catch (e: any) {
      patch({ status: "error", error: e?.message ?? "生成失败" });
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
    body = (
      <div className="space-y-2">
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

        {(d.mode === "img2img" ||
          (isVideo && d.mode === "i2v") ||
          (isVideo && d.mode === "flf")) && (
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

        <Field label="提示词">
          <textarea
            className={inputCls}
            rows={3}
            value={d.prompt}
            placeholder="描述你想要画面…"
            onChange={(e) => patch({ prompt: e.target.value })}
          />
        </Field>
        <Field label="反向提示词">
          <input
            className={inputCls}
            value={d.negative}
            placeholder="可选"
            onChange={(e) => patch({ negative: e.target.value })}
          />
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label="尺寸">
            <select className={inputCls} value={d.size} onChange={(e) => patch({ size: e.target.value })}>
              {sizes.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          {isVideo ? (
            <>
              <Field label="帧数">
                <input
                  type="number"
                  className={inputCls}
                  value={d.frames}
                  min={17}
                  max={241}
                  onChange={(e) => patch({ frames: Number(e.target.value) })}
                />
              </Field>
              <Field label="帧率">
                <input
                  type="number"
                  className={inputCls}
                  value={d.fps}
                  min={8}
                  max={30}
                  onChange={(e) => patch({ fps: Number(e.target.value) })}
                />
              </Field>
            </>
          ) : null}
          <Field label="步数">
            <input
              type="number"
              className={inputCls}
              value={d.steps}
              min={1}
              max={100}
              onChange={(e) => patch({ steps: Number(e.target.value) })}
            />
          </Field>
          <Field label="CFG">
            <input
              type="number"
              step="0.5"
              className={inputCls}
              value={d.cfg}
              min={0}
              max={30}
              onChange={(e) => patch({ cfg: Number(e.target.value) })}
            />
          </Field>
        </div>
        <Field label="种子（留空随机）">
          <input
            className={inputCls}
            value={d.seed}
            placeholder="random"
            onChange={(e) => patch({ seed: e.target.value })}
          />
        </Field>

        <button type="button" className={btnCls + " w-full"} disabled={d.status === "running"} onClick={runGenerate}>
          {d.status === "running" ? "生成中…" : `▶ 生成${isVideo ? "视频" : "图像"}`}
        </button>
        <ResultThumb path={d.resultPath} mediaType={d.resultMediaType} />
      </div>
    );
  } else if (d.kind === "script") {
    body = (
      <div className="space-y-2">
        <Field label="主题 / 梗概">
          <textarea
            className={inputCls}
            rows={2}
            value={d.theme}
            placeholder="例如：一个老人重拾年轻时的音乐梦"
            onChange={(e) => patch({ theme: e.target.value })}
          />
        </Field>
        <button type="button" className={btnCls + " w-full"} disabled={d.status === "running"} onClick={genScript}>
          {d.status === "running" ? "扩写中…" : "✍️ 生成剧本"}
        </button>
        {d.scriptText && (
          <>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-white/[0.08] bg-black/30 p-2 text-[11px] leading-relaxed text-gray-300">
              {d.scriptText}
            </pre>
            <div className="flex gap-2">
              <button
                type="button"
                className={ghostBtnCls}
                onClick={() => navigator.clipboard?.writeText(d.scriptText ?? "")}
              >
                复制
              </button>
              <button type="button" className={btnCls} onClick={addVideoFromScript}>
                → 生成视频节点
              </button>
            </div>
          </>
        )}
      </div>
    );
  } else if (d.kind === "workflow") {
    body = (
      <div className="space-y-2">
        <Field label="选择上传的工作流">
          <select
            className={inputCls}
            value={d.workflowId ?? ""}
            onChange={(e) => {
              const wf = wfList.find((w) => w.id === e.target.value);
              patch({
                workflowId: e.target.value || undefined,
                workflowName: wf?.name,
                workflowTaskType: wf?.taskType,
              });
            }}
          >
            <option value="">— 请选择工作流 —</option>
            {wfList.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
                {w.taskType ? `（${w.taskType}）` : ""}
              </option>
            ))}
          </select>
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

        {d.upstreamId && (
          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <span className="rounded bg-emerald-400/10 px-1.5 py-0.5 text-[10px] text-emerald-300">
                ⇠ 已接收上游图
              </span>
              <button
                type="button"
                className={ghostBtnCls}
                onClick={() => patch({ inputImage: undefined, upstreamId: undefined })}
              >
                断开
              </button>
            </div>
            {d.inputImage && (
              <p className="truncate text-[10px] text-gray-500">参考图：{d.inputImage}</p>
            )}
            <p className="text-[10px] text-gray-600">
              若工作流含图像输入节点（LoadImage），将自动作为参考图
            </p>
          </div>
        )}

        <Field label="提示词">
          <textarea
            className={inputCls}
            rows={3}
            value={d.prompt}
            placeholder="描述画面（部分工作流可留空）"
            onChange={(e) => patch({ prompt: e.target.value })}
          />
        </Field>
        <Field label="反向提示词">
          <input
            className={inputCls}
            value={d.negative}
            placeholder="可选"
            onChange={(e) => patch({ negative: e.target.value })}
          />
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label="步数">
            <input
              type="number"
              className={inputCls}
              value={d.steps}
              min={1}
              max={100}
              onChange={(e) => patch({ steps: Number(e.target.value) })}
            />
          </Field>
          <Field label="CFG">
            <input
              type="number"
              step="0.5"
              className={inputCls}
              value={d.cfg}
              min={0}
              max={30}
              onChange={(e) => patch({ cfg: Number(e.target.value) })}
            />
          </Field>
        </div>
        <Field label="种子（留空随机）">
          <input
            className={inputCls}
            value={d.seed}
            placeholder="random"
            onChange={(e) => patch({ seed: e.target.value })}
          />
        </Field>

        <button type="button" className={btnCls + " w-full"} disabled={d.status === "running"} onClick={runGenerate}>
          {d.status === "running" ? "生成中…" : "▶ 用此工作流生成"}
        </button>
        <ResultThumb path={d.resultPath} mediaType={d.resultMediaType} />
      </div>
    );
  } else if (d.kind === "agent") {
    body = (
      <div className="space-y-2">
        <div className="max-h-44 space-y-1 overflow-auto rounded-md border border-white/[0.08] bg-black/20 p-2">
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
        <ResultThumb path={d.resultPath} mediaType={d.resultMediaType} />
      </div>
    );
  }

  return (
    <div
      className="w-[300px] rounded-xl border bg-[#0d0a16]/95 shadow-xl shadow-black/40 backdrop-blur"
      style={{ borderColor: meta.color + "55" }}
    >
      <Handle type="target" position={Position.Left} style={{ background: meta.color }} />
      <div
        className="flex items-center justify-between rounded-t-xl px-3 py-2"
        style={{ background: meta.color + "1A" }}
      >
        <div className="flex items-center gap-2">
          <span className="text-base">{meta.icon}</span>
          <span className="text-[13px] font-semibold text-gray-100">{meta.label}</span>
          <StatusDot status={d.status} />
        </div>
        <button
          type="button"
          onClick={deleteSelf}
          className="text-gray-500 transition-colors hover:text-red-400"
          title="删除节点"
        >
          ✕
        </button>
      </div>
      <div className="max-h-[60vh] overflow-auto px-3 py-2.5">{body}</div>
      {d.error && d.status === "error" && (
        <div className="px-3 pb-2 text-[11px] text-red-400">⚠ {d.error}</div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onFile}
      />
      <Handle type="source" position={Position.Right} style={{ background: meta.color }} />
    </div>
  );
}
