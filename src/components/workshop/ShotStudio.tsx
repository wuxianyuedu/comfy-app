"use client";
import React from "react";
import { randomSeed } from "~/lib/comfyui/random-seed";
import { useThrottledProgressMap } from "~/components/ui/use-throttled-progress";
import { useBusyAction } from "~/components/ui/use-busy-action";
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import { Alert } from "~/components/ui/alert";
import { StatusBadge as StatusBadgePrimitive } from "~/components/ui/status-badge";
import { ProgressBar } from "~/components/ui/progress-bar";
import type { Character, Scene, Shot, StyleRef } from "~/lib/workshop/types";
import { withTimeoutResult } from "~/lib/with-timeout";
import {
  buildShotNegative,
  buildShotPrompt,
} from "~/lib/workshop/prompt-builder";
import {
  apiGenerateImage,
  buildLibraryWorkflowInput,
  startLocalGenerate,
  watchTask,
  type GenerateInput,
} from "~/lib/workshop/generation-client";
import type { ApiChannelsView } from "~/lib/workshop/api-channel-shared";
import {
  parseShotSize,
  shotSizeToParam,
  shotSizeToRelay,
  type ShotSizeState,
} from "./shot-size-config";
import { ShotSizePicker } from "./ShotSizePicker";
import { SeedAdvancedField } from "./SeedAdvancedField";
import { MediaThumbnail } from "~/components/ui/media-thumbnail";
import { Textarea } from "~/components/ui/textarea";
import { errorMessage } from "~/lib/error-message";
import { paramString } from "~/lib/workshop/param-coerce";

interface Props {
  shots: Shot[];
  scenes: Scene[];
  characters: Character[];
  styles: StyleRef[];
  /** 选定的工作流库工作流 id：本地通道的唯一可执行来源（内置模板已移除）。 */
  workflowId: string;
  /** 掩码后的 API 通道配置；图片通道的放行判据来自这里。 */
  apiChannels: ApiChannelsView | null;
  onOpenApiSettings: () => void;
  /** 镜头列表所有者（WorkshopPipeline setShots）—— 欢迎函数式补丁。 */
  onShotsChange: React.Dispatch<React.SetStateAction<Shot[]>>;
  onNextStage: () => void;
}

type Channel = "local" | "api";

/** 本地 ComfyUI 单镜头的安全阀（30 分钟无响应即判超时）。 */
const LOCAL_TASK_TIMEOUT_MS = 30 * 60 * 1000;

/** 空操作（订阅句柄的初值）。 */
function noop(): void {
  /* 无操作。 */
}

/** 解析高级种子的输入框值：空 / 非数字 → 每次一个新的随机 seed（默认随机）；
 *  有限数字 → 用该固定 seed（pin 住以复现）。 */
function resolveSeed(raw: string): number {
  const trimmed = raw.trim();
  if (trimmed === "") return randomSeed();
  const n = Number(trimmed);
  return Number.isFinite(n) ? Math.trunc(n) : randomSeed();
}

/**
 * 镜头生图 stage：消费「场景分镜」产出的镜头列表（提示词已在上游
 * 自动构建；空的在这里从场景 + 角色卡回填），并在本地 ComfyUI 链或
 * 配置的 API 通道上生成每个镜头图片。结果写回 Shot.imageUrl，好让
 * 视频 stage / FinalComposer 原样消费。
 */
export function ShotStudio({
  shots,
  scenes,
  characters,
  styles,
  workflowId,
  apiChannels,
  onOpenApiSettings,
  onShotsChange,
  onNextStage,
}: Props) {
  const [channel, setChannel] = React.useState<Channel>("local");
  /** 高级 · 种子输入（空 = 每次自动随机；数字 = pin 住复现）。 */
  const [seedInput, setSeedInput] = React.useState("");
  /** 全镜头共用的「比例 + 像素 + 对齐」尺寸三段状态（issue #145 需求 3）。
   * 初值取第一条镜头已带的 WxH 参数反解，历史尺寸不丢。 */
  const [shotSize, setShotSize] = React.useState<ShotSizeState>(() =>
    parseShotSize(shots[0]?.params.size ?? undefined),
  );
  /* 多镜头同时在跑时的**按条目**进度表（节流 + 同值短路 + 卸载守卫都收在
   * 出口里，规范 16 §16.2.4.68）。此前这一行在两个文件里逐字相同。 */
  const {
    progress,
    report: reportProgress,
    flush: flushProgress,
  } = useThrottledProgressMap();
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  /* 批处理的忙碌位走唯一出口（规范 16 §16.2.4.71）：它此前复位写在循环之后，
   * 循环里抛错就永远停在「批处理中」。 */
  const batch = useBusyAction();
  /** 提示词被用户手改过的镜头 —— 自动预填不得覆盖。 */
  const editedRef = React.useRef<Set<string>>(new Set());

  const apiReady = apiChannels?.image.configured === true;
  const busyCount = shots.filter((s) => s.status === "running").length;
  const doneCount = shots.filter((s) => !!s.imageUrl).length;
  const pending = shots.filter(
    (s) => !s.imageUrl && (s.status === "idle" || s.status === "failed"),
  );

  // ── 自动预填：分镜输出 → 图片提示词 ──────────────────────
  // 从「场景分镜」来的镜头已带构建好的提示词；任何为空的
  //（例如导入的裸镜头）从场景 + 角色卡一次性填上。
  React.useEffect(() => {
    const needsFill = shots.some(
      (s) => !s.prompt.trim() && !editedRef.current.has(s.id),
    );
    if (!needsFill) return;
    onShotsChange((prev) =>
      prev.map((shot) => {
        if (shot.prompt.trim() || editedRef.current.has(shot.id)) return shot;
        const scene = scenes.find((sc) => sc.id === shot.sceneId);
        const chars = characters.filter((c) =>
          shot.characterIds.includes(c.id),
        );
        const style = styles.find((st) => st.slug === shot.skillSlug);
        return {
          ...shot,
          prompt: buildShotPrompt(shot, scene, chars, style),
          negativePrompt:
            shot.negativePrompt || buildShotNegative(chars, style),
        };
      }),
    );
  }, [shots, scenes, characters, styles, onShotsChange]);

  function patchShot(id: string, p: Partial<Shot>) {
    onShotsChange((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...p } : s)),
    );
  }

  function setShotError(id: string, message: string | undefined) {
    setErrors((prev) => {
      const next = { ...prev };
      if (message) next[id] = message;
      else delete next[id];
      return next;
    });
  }

  /** 等一个本地 ComfyUI 任务；SSE 流落定后 resolve。
   *
   * 与「安全阀」赛跑的那一半交给`withTimeoutResult`：超时给兜底（不抛），
   *`onTimeout` 里退订 —— 放弃等待之后流还挂着才是真问题。 */
  function runLocalTask(shotId: string, taskId: string): Promise<void> {
    /* 订阅句柄 —— watchTask 返回前先给一个空实现，settle 路径上一定已赋值。 */
    let close: () => void = noop;
    return withTimeoutResult(
      new Promise<void>((resolve) => {
        close = watchTask(taskId, {
          onProgress: (p) => reportProgress(shotId, p),
          onOutput: (out) => {
            if (out.kind !== "video") patchShot(shotId, { imageUrl: out.url });
          },
          onSettled: (r) => {
            /* 落定即写终值（见 VideoStudio 同处注释）。 */
            flushProgress(shotId, 100);
            patchShot(shotId, { status: r.ok ? "done" : "failed" });
            if (!r.ok) setShotError(shotId, r.message ?? "生成失败");
            resolve();
          },
        });
      }),
      LOCAL_TASK_TIMEOUT_MS,
      undefined,
      {
        onTimeout: () => {
          // 安全阀：永不让批量循环卡在一个沉默的流上。
          close();
          patchShot(shotId, { status: "failed" });
          setShotError(shotId, "任务超时(30 分钟无响应)");
        },
      },
    );
  }

  async function generateShot(shot: Shot): Promise<void> {
    if (!shot.prompt.trim()) {
      setShotError(shot.id, "提示词为空,请先填写或完成上一阶段提取");
      return;
    }
    /* 本地通道没有内置模板可回落：必须先在工作流库选好一个生图工作流。
     * 门禁放在入口，避免带着空 workflow id 去拉详情（会得到一条无落点的请求）。 */
    if (channel === "local" && !workflowId) {
      setShotError(
        shot.id,
        "本地通道需要先在右侧「生成资源」选择一个生图工作流；或切到远端 API 通道",
      );
      return;
    }
    setShotError(shot.id, undefined);
    patchShot(shot.id, { status: "running" });
    try {
      if (channel === "local") {
        /* 镜头存的是尺寸表达（老数据可能是"832x1216"，回读时归一）——
         * 尺寸只表达一次，两种目标形状都由它现算。 */
        const sizeSpec = parseShotSize(
          shot.params.size !== undefined && shot.params.size !== ""
            ? shot.params.size
            : shotSize,
        );
        /* 没有内置模板作为回落：本地通道必须先在工作流库选好一个生图工作流
         *（封装口径只暴露 提示词 / 尺寸 / 参考图，其余走工作流默认值），否则
         * 没有可执行的图。见 generateShot 入口的门禁。 */
        const input: GenerateInput = (
          await buildLibraryWorkflowInput(workflowId, {
            prompt: shot.prompt,
            negativePrompt: shot.negativePrompt || undefined,
            size: sizeSpec,
            // 高级 · 种子：默认随机（留空每次新 seed），填数字则 pin 住（见 resolveSeed）。
            seed: resolveSeed(seedInput),
          })
        ).input;

        const taskId = await startLocalGenerate(input);
        patchShot(shot.id, { taskId, status: "running" });
        await runLocalTask(shot.id, taskId);
      } else {
        const url = await apiGenerateImage({
          prompt: shot.prompt,
          negative: shot.negativePrompt || undefined,
          size:
            shot.params.size !== undefined && shot.params.size !== ""
              ? paramString(shot.params.size, shotSizeToParam(shotSize))
              : shotSizeToParam(shotSize),
          mode: "T2I",
          /* 远端通道认「宽高比 + 百万像素」：分辨率档也换算成实际总像素再下发
           * （透传"1k" 这类档位名对远端没有意义）。 */
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
    if (pending.length === 0) return;
    await batch.run(async () => {
      for (const shot of [...pending]) {
        // 每轮重新检查存活 —— 用户可能在运行中编辑 / 删除。
        if (shot.status === "running" || shot.imageUrl) continue;
        await generateShot(shot);
      }
    });
  }

  return (
    <div className="flex-col gap-4">
      {/* 通道切换（本地 ComfyUI / 配置的 API） */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-xs">生成通道</span>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            size="xs"
            onClick={() => setChannel("local")}
            className={`h-auto rounded-lg px-3 py-1.5 ${
              channel === "local"
                ? "border-primary bg-primary-soft text-primary"
                : "border-border text-muted-foreground hover:bg-subtle"
            }`}
          >
            本地 · ComfyUI 工作流
          </Button>
          <Button
            variant="outline"
            size="xs"
            onClick={() => setChannel("api")}
            className={`h-auto rounded-lg px-3 py-1.5 ${
              channel === "api"
                ? "border-primary bg-primary-soft text-primary"
                : "border-border text-muted-foreground hover:bg-subtle"
            }`}
          >
            API 直连{apiChannels ? (apiReady ? " · 已配置" : " · 未配置") : ""}
          </Button>
        </div>
        <Button
          variant="ghost"
          size="xs"
          onClick={onOpenApiSettings}
          className="text-muted-foreground hover:text-ink bg-subtle hover:bg-surface-2 h-auto gap-1 rounded-lg px-3 py-1.5"
        >
          <Icon name="settings" size={12} />
          API 通道设置
        </Button>
        {/* 不用 <label> 包住选择器：它内部会挂尺寸表配置弹窗，弹窗里的输入框
 会被 label 的点击行为抢焦点（弹窗开着、背后的下拉被一起触发）。 */}
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">尺寸</span>
          <ShotSizePicker
            value={shotSize}
            onChange={setShotSize}
            disabled={batch.busy}
          />
        </div>
        {channel === "local" && (
          <SeedAdvancedField
            value={seedInput}
            onChange={setSeedInput}
            disabled={batch.busy}
          />
        )}
        <Button
          variant="primary-solid"
          size="xs"
          onClick={() => void generateBatch()}
          disabled={
            batch.busy ||
            pending.length === 0 ||
            (channel === "local" && !workflowId) ||
            (channel === "api" && !apiReady)
          }
          className="ml-auto h-auto rounded-lg px-3 py-1.5"
        >
          {batch.busy ? "批量生成中…" : `批量生图 (${pending.length})`}
        </Button>
        <Button
          variant="secondary"
          size="xs"
          onClick={onNextStage}
          className="text-ink bg-subtle hover:bg-surface-2 h-auto rounded-lg px-3 py-1.5"
        >
          下一阶段 →
        </Button>
      </div>

      {/* 通道专属的放行提示（温和，stage 仍可用） */}
      {channel === "local" && !workflowId && (
        <div className="text-muted-foreground bg-subtle rounded-lg px-3 py-2 text-xs">
          本地通道需要先在右侧「生成资源」选择一个生图工作流（工作流库，需配好对外参数；ComfyUI
          需在本机运行）。生成任务走与画布一致的本地工作流链路。
        </div>
      )}
      {channel === "api" && !apiReady && (
        <div className="bg-amber/10 text-amber flex items-center gap-2 rounded-lg px-3 py-2 text-xs">
          <Icon name="info" size={12} />
          API 生图通道未配置 — 点击上方「API 通道设置」填写 Base URL 与 API Key
          后即可使用。
        </div>
      )}

      {shots.length === 0 ? (
        <div className="border-border text-muted-foreground rounded-xl border border-dashed py-10 text-center text-sm">
          暂无镜头数据。请先在「场景分镜」阶段提取或生成分镜 —
          镜头提示词会自动带入本阶段。
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {shots.map((shot) => {
            const p = progress[shot.id] ?? 0;
            const err = errors[shot.id];
            return (
              <div
                key={shot.id}
                className="border-border bg-surface rounded-xl border p-4"
              >
                <div className="mb-2 flex items-center gap-2">
                  <span className="bg-primary-soft text-primary grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold">
                    {shot.index}
                  </span>
                  <span className="text-muted-foreground truncate text-xs">
                    {shot.sceneHeading}
                  </span>
                  <StatusBadge status={shot.status} />
                  {busyCount > 0 && shot.status === "running" && (
                    <span className="text-muted-foreground text-[10px]">
                      {p > 0 ? `${Math.round(p)}%` : "排队中…"}
                    </span>
                  )}
                  <span className="text-faint ml-auto text-[10px]">
                    {channel === "local" ? "本地" : "API"}
                  </span>
                </div>

                {shot.status === "running" && (
                  <ProgressBar
                    value={p}
                    /* 同 VideoStudio.parts：起点 0 时留一格可见。 */
                    minVisible={4}
                    showValue={false}
                    className="mb-2"
                    trackClassName="bg-elevated h-1"
                  />
                )}

                <Textarea
                  value={shot.prompt}
                  onChange={(e) => {
                    editedRef.current.add(shot.id);
                    patchShot(shot.id, { prompt: e.target.value });
                  }}
                  rows={2}
                  className="field-sizing-normal border-border bg-bg text-ink placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/30 min-h-0 rounded-md px-2 py-1.5 text-xs"
                  placeholder="生图提示词(自动预填自分镜与角色卡,可手动修改)"
                />
                {err && (
                  <Alert
                    variant="danger"
                    /* 行内错误行：紧凑尺寸 + 无可见边框（同 CharacterPortraitStudio）。 */
                    className="mt-1 block rounded-md border-transparent px-2 py-1 text-[11px]"
                  >
                    {err}
                  </Alert>
                )}

                <div className="mt-2 flex items-center gap-3">
                  <Button
                    variant="primary-solid"
                    size="xs"
                    onClick={() => void generateShot(shot)}
                    disabled={
                      shot.status === "running" ||
                      !shot.prompt ||
                      (channel === "local" && !workflowId) ||
                      (channel === "api" && !apiReady)
                    }
                    className="h-auto rounded-lg px-4 py-1.5"
                  >
                    {shot.status === "running"
                      ? "生成中…"
                      : shot.imageUrl
                        ? "重新生成"
                        : "生成此镜头"}
                  </Button>
                  {shot.taskId && (
                    <span className="text-faint truncate text-[10px]">
                      任务 {shot.taskId.slice(0, 12)}…
                    </span>
                  )}
                </div>

                {shot.imageUrl && (
                  <MediaThumbnail
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
          已生成 {doneCount}/{shots.length} 镜 —
          图片会自动作为下一阶段「视频生成」的首帧;缺失镜头仍可回上一阶段补齐。
        </p>
      )}
    </div>
  );
}

/* 镜头状态 → 文案。配色走`ui/status-badge` 的同一份状态 → 语义 token 映射；
 * 本地化的标签留在本文件（同批把 StoryboardPlanner / VideoStudio 里那两份
 * 逐字相同的副本一并收口，规范 16 §16.2.4.5）。 */
export const SHOT_STATUS_LABEL: Record<Shot["status"], string> = {
  idle: "待生成",
  queued: "排队中",
  running: "生成中",
  done: "已完成",
  failed: "失败",
  stale: "待更新",
};

function StatusBadge({ status }: { status: Shot["status"] }) {
  return (
    <StatusBadgePrimitive
      status={status}
      label={SHOT_STATUS_LABEL[status]}
      dot={false}
      className="px-2 py-0.5 text-[10px]"
    />
  );
}
