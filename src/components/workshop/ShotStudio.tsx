"use client";
import React from "react";
import { Icon } from "@/components/ui/icon";
import type { Character, Scene, Shot, StyleRef } from "@/lib/workshop/types";
import { buildShotNegative, buildShotPrompt } from "@/lib/workshop/prompt-builder";
import {
  apiGenerateImage,
  buildLibraryWorkflowInput,
  startLocalGenerate,
  watchTask,
  type GenerateInput,
} from "@/lib/workshop/generation-client";
import type { ApiChannelsView } from "@/lib/workshop/api-channel-shared";
import {
  parseShotSize,
  shotSizeToParam,
  shotSizeToRelay,
  type ShotSizeState,
} from "./shot-size-config";
import { ShotSizePicker } from "./ShotSizePicker";

/** catch 抛出值（unknown）→ 消息提取：带 string message 的对象取 message，其余回退。 */
function errorMessage(e: unknown, fallback: string): string {
  if (typeof e === "object" && e !== null && "message" in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string" && m) return m;
  }
  return fallback;
}

function strParam(value: unknown, fallback: string): string {
  return typeof value === "string" && value ? value : fallback;
}

function numParam(value: unknown, fallback: number): number {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) ? n : fallback;
}

interface Props {
  shots: Shot[];
  scenes: Scene[];
  characters: Character[];
  styles: StyleRef[];
  checkpoints: string[];
  checkpoint: string;
  onCheckpointChange: (name: string) => void;
  /** 选定的工作流库工作流 id；空串 = 内置 txt2img（ISSUE #145）。 */
  workflowId: string;
  /** Masked API channel config; image channel gate comes from here. */
  apiChannels: ApiChannelsView | null;
  onOpenApiSettings: () => void;
  /** Shot-list owner (WorkshopPipeline setShots) — functional patches welcome. */
  onShotsChange: React.Dispatch<React.SetStateAction<Shot[]>>;
  onNextStage: () => void;
}

type Channel = "local" | "api";

/**
 * 镜头生图 stage: consumes the shot list produced by 场景分镜 (prompts already
 * auto-built upstream; empty ones are re-filled here from scene + character
 * cards), and generates each shot image on the local ComfyUI chain or the
 * configured API channel. Results are written back onto Shot.imageUrl so the
 * video stage / FinalComposer can consume them unchanged.
 */
export function ShotStudio({
  shots,
  scenes,
  characters,
  styles,
  checkpoints,
  checkpoint,
  onCheckpointChange,
  workflowId,
  apiChannels,
  onOpenApiSettings,
  onShotsChange,
  onNextStage,
}: Props) {
  const [channel, setChannel] = React.useState<Channel>("local");
  /** 全镜头共用的「比例 + 像素 + 对齐」尺寸三段状态（issue #145 需求 3）。
   *  初值取第一条镜头已带的 WxH 参数反解，历史尺寸不丢。 */
  const [shotSize, setShotSize] = React.useState<ShotSizeState>(() =>
    parseShotSize(shots[0]?.params.size ?? undefined),
  );
  const [progress, setProgress] = React.useState<Record<string, number>>({});
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [batchRunning, setBatchRunning] = React.useState(false);
  /** Shots whose prompt the user hand-edited — auto-prefill must not clobber. */
  const editedRef = React.useRef<Set<string>>(new Set());

  const apiReady = apiChannels?.image.configured === true;
  const busyCount = shots.filter((s) => s.status === "running").length;
  const doneCount = shots.filter((s) => !!s.imageUrl).length;
  const pending = shots.filter(
    (s) => !s.imageUrl && (s.status === "idle" || s.status === "failed"),
  );

  // ── Auto-prefill: storyboard output → image prompts ──────────────────────
  // Shots arriving from 场景分镜 already carry built prompts; anything empty
  // (e.g. imported bare shots) is filled from scene + character cards once.
  React.useEffect(() => {
    const needsFill = shots.some(
      (s) => !s.prompt.trim() && !editedRef.current.has(s.id),
    );
    if (!needsFill) return;
    onShotsChange((prev) =>
      prev.map((shot) => {
        if (shot.prompt.trim() || editedRef.current.has(shot.id)) return shot;
        const scene = scenes.find((sc) => sc.id === shot.sceneId);
        const chars = characters.filter((c) => shot.characterIds.includes(c.id));
        const style = styles.find((st) => st.slug === shot.skillSlug);
        return {
          ...shot,
          prompt: buildShotPrompt(shot, scene, chars, style),
          negativePrompt: shot.negativePrompt || buildShotNegative(chars, style),
        };
      }),
    );
  }, [shots, scenes, characters, styles, onShotsChange]);

  function patchShot(id: string, p: Partial<Shot>) {
    onShotsChange((prev) => prev.map((s) => (s.id === id ? { ...s, ...p } : s)));
  }

  function setShotError(id: string, message: string | undefined) {
    setErrors((prev) => {
      const next = { ...prev };
      if (message) next[id] = message;
      else delete next[id];
      return next;
    });
  }

  /** Wait for one local ComfyUI task; resolves when the SSE stream settles. */
  function runLocalTask(shotId: string, taskId: string): Promise<void> {
    return new Promise<void>((resolve) => {
      const close = watchTask(taskId, {
        onProgress: (p) => setProgress((prev) => ({ ...prev, [shotId]: p })),
        onOutput: (out) => {
          if (out.kind !== "video") patchShot(shotId, { imageUrl: out.url });
        },
        onSettled: (r) => {
          clearTimeout(timeout);
          patchShot(shotId, { status: r.ok ? "done" : "failed" });
          if (!r.ok) setShotError(shotId, r.message ?? "生成失败");
          resolve();
        },
      });
      // Safety valve: never wedge the batch loop on a silent stream.
      const timeout = setTimeout(() => {
        close();
        patchShot(shotId, { status: "failed" });
        setShotError(shotId, "任务超时(30 分钟无响应)");
        resolve();
      }, 30 * 60 * 1000);
    });
  }

  async function generateShot(shot: Shot): Promise<void> {
    if (!shot.prompt.trim()) {
      setShotError(shot.id, "提示词为空,请先填写或完成上一阶段提取");
      return;
    }
    setShotError(shot.id, undefined);
    patchShot(shot.id, { status: "running" });
    try {
      if (channel === "local") {
        /* 镜头存的是尺寸表达（老数据可能是 "832x1216"，回读时归一）——
         * 尺寸只表达一次，两种目标形状都由它现算。 */
        const sizeSpec = parseShotSize(
          shot.params.size !== undefined && shot.params.size !== ""
            ? shot.params.size
            : shotSize,
        );
        /* 选定工作流库工作流时，按 ISSUE #145 只暴露 提示词 / 尺寸 / 参考图，
         * 其余参数用工作流默认值；否则用内置 txt2img。
         *
         * 尺寸对这两条通路表达不同：内置 txt2img 接的是 WxH 字符串（由尺寸表达
         * 折算），工作流库的工作流直接吃「比例 + 分辨率 / 比例 + 百万像素 + 倍数」，
         * 宽高由封装层按场景尺寸表现算。 */
        const input: GenerateInput = workflowId
          ? (
              await buildLibraryWorkflowInput(workflowId, {
                prompt: shot.prompt,
                negativePrompt: shot.negativePrompt || undefined,
                size: sizeSpec,
              })
            ).input
          : {
              workflow: "txt2img",
              prompt: shot.prompt,
              negative: shot.negativePrompt || undefined,
              checkpoint: checkpoint || undefined,
              steps: Math.round(numParam(shot.params.steps, 28)),
              cfg: numParam(shot.params.cfg, 7),
              sampler: strParam(shot.params.sampler, "euler_ancestral"),
              scheduler: strParam(shot.params.scheduler, "normal"),
              size: shotSizeToParam(sizeSpec),
              count: 1,
            };
        const taskId = await startLocalGenerate(input);
        patchShot(shot.id, { taskId, status: "running" });
        await runLocalTask(shot.id, taskId);
      } else {
        const url = await apiGenerateImage({
          prompt: shot.prompt,
          negative: shot.negativePrompt || undefined,
          size: shot.params.size !== undefined && shot.params.size !== ""
            ? strParam(shot.params.size, shotSizeToParam(shotSize))
            : shotSizeToParam(shotSize),
          mode: "T2I",
          /* 远端通道认「宽高比 + 百万像素」：分辨率档也换算成实际总像素再下发
           * （透传 "1k" 这类档位名对远端没有意义）。 */
          ...shotSizeToRelay(shotSize),
        });
        patchShot(shot.id, { status: "done", imageUrl: url });
      }
    } catch (e: unknown) {
      patchShot(shot.id, { status: "failed" });
      setShotError(shot.id, errorMessage(e, "生成失败"));
    }
  }

  async function generateBatch() {
    if (batchRunning || pending.length === 0) return;
    setBatchRunning(true);
    for (const shot of [...pending]) {
      // Re-check liveness each round — the user may edit/delete mid-run.
      if (shot.status === "running" || shot.imageUrl) continue;
      await generateShot(shot);
    }
    setBatchRunning(false);
  }

  return (
    <div className="space-y-4">
      {/* Channel switch (local ComfyUI / configured API) */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-xs">生成通道</span>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setChannel("local")}
            className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
              channel === "local"
                ? "border-primary bg-primary-soft text-primary"
                : "border-border text-muted-foreground hover:bg-subtle"
            }`}
          >
            本地 · ComfyUI 工作流
          </button>
          <button
            type="button"
            onClick={() => setChannel("api")}
            className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
              channel === "api"
                ? "border-primary bg-primary-soft text-primary"
                : "border-border text-muted-foreground hover:bg-subtle"
            }`}
          >
            API 直连{apiChannels ? (apiReady ? " · 已配置" : " · 未配置") : ""}
          </button>
        </div>
        <button
          type="button"
          onClick={onOpenApiSettings}
          className="text-muted-foreground hover:text-ink flex items-center gap-1 rounded-lg bg-(--color-subtle) px-3 py-1.5 text-xs hover:bg-(--color-surface-2)"
        >
          <Icon name="settings" size={12} />
          API 通道设置
        </button>
        {/* 不用 <label> 包住选择器：它内部会挂尺寸表配置弹窗，弹窗里的输入框
            会被 label 的点击行为抢焦点（弹窗开着、背后的下拉被一起触发）。 */}
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">尺寸</span>
          <ShotSizePicker value={shotSize} onChange={setShotSize} disabled={batchRunning} />
        </div>
        {channel === "local" && checkpoints.length > 0 && (
          <label className="ml-auto flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Checkpoint</span>
            <select
              value={checkpoint}
              onChange={(e) => onCheckpointChange(e.target.value)}
              className="border-border bg-bg text-ink max-w-[220px] rounded-lg border px-2 py-1 text-xs outline-none"
            >
              <option value="">选择模型…</option>
              {checkpoints.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="button"
          onClick={() => void generateBatch()}
          disabled={batchRunning || pending.length === 0 || (channel === "local" && !checkpoint) || (channel === "api" && !apiReady)}
          className="bg-primary ml-auto rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-opacity disabled:opacity-40"
        >
          {batchRunning ? "批量生成中…" : `批量生图 (${pending.length})`}
        </button>
        <button
          type="button"
          onClick={onNextStage}
          className="text-ink rounded-lg bg-(--color-subtle) px-3 py-1.5 text-xs font-medium hover:bg-(--color-surface-2)"
        >
          下一阶段 →
        </button>
      </div>

      {/* Channel-specific gating hints (gentle, stage stays usable) */}
      {channel === "local" && !checkpoint && (
        <div className="text-muted-foreground rounded-lg bg-subtle px-3 py-2 text-xs">
          本地通道需要选择 Checkpoint(ComfyUI 需在本机运行)。生成任务走与画布一致的本地工作流链路。
        </div>
      )}
      {channel === "api" && !apiReady && (
        <div className="flex items-center gap-2 rounded-lg bg-(--color-amber)/10 px-3 py-2 text-xs text-(--color-amber)">
          <Icon name="info" size={12} />
          API 生图通道未配置 — 点击上方「API 通道设置」填写 Base URL 与 API Key 后即可使用。
        </div>
      )}

      {shots.length === 0 ? (
        <div className="border-border text-muted-foreground rounded-xl border border-dashed py-10 text-center text-sm">
          暂无镜头数据。请先在「场景分镜」阶段提取或生成分镜 — 镜头提示词会自动带入本阶段。
        </div>
      ) : (
        <div className="space-y-3">
          {shots.map((shot) => {
            const p = progress[shot.id] ?? 0;
            const err = errors[shot.id];
            return (
              <div key={shot.id} className="border-border bg-surface rounded-xl border p-4">
                <div className="mb-2 flex items-center gap-2">
                  <span className="bg-primary-soft text-primary grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold">
                    {shot.index}
                  </span>
                  <span className="text-muted-foreground truncate text-xs">{shot.sceneHeading}</span>
                  <StatusBadge status={shot.status} />
                  {busyCount > 0 && shot.status === "running" && (
                    <span className="text-muted-foreground text-[10px]">{p > 0 ? `${Math.round(p)}%` : "排队中…"}</span>
                  )}
                  <span className="text-faint ml-auto text-[10px]">{channel === "local" ? "本地" : "API"}</span>
                </div>

                {shot.status === "running" && (
                  <div className="bg-elevated mb-2 h-1 w-full overflow-hidden rounded-full">
                    <div className="bg-primary h-full rounded-full transition-all" style={{ width: `${Math.max(4, p)}%` }} />
                  </div>
                )}

                <textarea
                  value={shot.prompt}
                  onChange={(e) => {
                    editedRef.current.add(shot.id);
                    patchShot(shot.id, { prompt: e.target.value });
                  }}
                  rows={2}
                  className="border-border bg-bg text-ink focus:border-primary w-full rounded-md border px-2 py-1.5 text-xs outline-none"
                  placeholder="生图提示词(自动预填自分镜与角色卡,可手动修改)"
                />
                {err && <p className="mt-1 rounded-md bg-red-100 px-2 py-1 text-[11px] text-red-700">{err}</p>}

                <div className="mt-2 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void generateShot(shot)}
                    disabled={shot.status === "running" || !shot.prompt || (channel === "local" && !checkpoint) || (channel === "api" && !apiReady)}
                    className="bg-primary/90 rounded-lg px-4 py-1.5 text-xs font-medium text-white transition-opacity disabled:opacity-40"
                  >
                    {shot.status === "running" ? "生成中…" : shot.imageUrl ? "重新生成" : "生成此镜头"}
                  </button>
                  {shot.taskId && (
                    <span className="text-faint truncate text-[10px]">任务 {shot.taskId.slice(0, 12)}…</span>
                  )}
                </div>

                {shot.imageUrl && (
                  <img
                    src={shot.imageUrl}
                    alt={shot.sceneHeading}
                    className="border-border mt-2 max-h-64 w-auto rounded-lg border"
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {shots.length > 0 && (
        <p className="text-muted-foreground text-[11px]">
          已生成 {doneCount}/{shots.length} 镜 — 图片会自动作为下一阶段「视频生成」的首帧;缺失镜头仍可回上一阶段补齐。
        </p>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: Shot["status"] }) {
  const map: Record<Shot["status"], { label: string; cls: string }> = {
    idle: { label: "待生成", cls: "bg-subtle text-muted-foreground" },
    queued: { label: "排队中", cls: "bg-amber-100 text-amber-700" },
    running: { label: "生成中", cls: "bg-blue-100 text-blue-700" },
    done: { label: "已完成", cls: "bg-emerald-100 text-emerald-700" },
    failed: { label: "失败", cls: "bg-red-100 text-red-700" },
    stale: { label: "待更新", cls: "bg-red-100 text-red-700" },
  };
  const s = map[status];
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${s.cls}`}>{s.label}</span>;
}
