"use client";
import React from "react";
import { randomSeed } from "~/lib/comfyui/random-seed";
import { useThrottledProgressMap } from "~/components/ui/use-throttled-progress";
import { EmptyState } from "~/components/ui/empty-state";
import { useBusyAction } from "~/components/ui/use-busy-action";
import { useItemAction } from "~/components/ui/use-item-action";
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import { Alert } from "~/components/ui/alert";
import { SelectChip } from "~/components/ui/select-chip";
import { StatusBadge as StatusBadgePrimitive } from "~/components/ui/status-badge";
import { ProgressBar } from "~/components/ui/progress-bar";
import type { Character, Scene, Shot, StyleRef } from "~/lib/workshop/types";
import { autoselectShot } from "~/lib/production/run-client";
import { reviewScoreMean } from "~/lib/production/review-types";
import { fixed } from "~/lib/number-format";
import { withTimeoutResult } from "~/lib/with-timeout";
import { buildShotNegative, buildShotPrompt } from "~/lib/workshop/prompt-builder";
import {
  apiGenerateImage,
  buildLibraryWorkflowInput,
  WORKSHOP_BATCH_CONCURRENCY,
  LOCAL_TASK_TIMEOUT_MS,
  preparePortraitReferences,
  startLocalGenerate,
  withGenerationAttribution,
  watchTask,
  type GenerateInput,
} from "~/lib/workshop/generation-client";
import { describeUnmatchedInputs } from "~/lib/workshop/workflow-encapsulation";
import { runWithConcurrency } from "~/lib/async-pool";
import type { ApiChannelsView } from "~/lib/workshop/api-channel-shared";
import {
  parseShotSize,
  shotSizeToParam,
  shotSizeToRelay,
  type ShotSizeState,
} from "./shot-size-config";
import { ShotSizePicker } from "./ShotSizePicker";
import { ShotFilmStrip } from "./ShotFilmStrip";
import { SHOT_STATUS_LABEL } from "./shot-status-config";
import { SeedAdvancedField } from "./SeedAdvancedField";
import { MediaThumbnail } from "~/components/ui/media-thumbnail";
import { Textarea } from "~/components/ui/textarea";
import { errorMessage } from "~/lib/error-message";
import { IndexDot } from "~/components/workshop/IndexDot";
import { paramString } from "~/lib/workshop/param-coerce";

type Props = {
  /** 掩码后的 API 通道配置；图片通道的放行判据来自这里。 */
  apiChannels: ApiChannelsView | null;
  characters: Array<Character>;
  /** 取消一个进行中的本机任务（控制器统一出口）。 */
  onCancelShot: (shot: Shot) => void;
  onNextStage: () => void;
  /** 写一条用户可见提示（错误 / 警告）：走控制器统一的提示条，不自建通道。 */
  onNotice: (message: string) => void;
  onOpenModelAdapters: () => void;
  /** 镜头列表所有者（WorkshopPipeline setShots）—— 欢迎函数式补丁。 */
  onShotsChange: React.Dispatch<React.SetStateAction<Array<Shot>>>;
  /** 当前项目 id（空串 = 尚无活跃项目）：与镜头号一起写进任务行做归属。 */
  projectId: string;
  scenes: Array<Scene>;
  shots: Array<Shot>;
  styles: Array<StyleRef>;
  /** 选定的工作流库工作流 id：本地通道的唯一可执行来源（内置模板已移除）。 */
  workflowId: string;
};

type Channel = "local" | "api";

/** 空操作（订阅句柄的初值）。 */
function noop(): void {
  /* 无操作。 */
}

/** 解析高级种子的输入框值：空 / 非数字 → 每次一个新的随机 seed（默认随机）；
 *  有限数字 → 用该固定 seed（pin 住以复现）。 */
function resolveSeed(raw: string): number {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return randomSeed();
  }
  const n = Number(trimmed);
  return Number.isFinite(n) ? Math.trunc(n) : randomSeed();
}

/** 自动预填：分镜输出 → 图片提示词。
 *
 *  从「场景分镜」来的镜头已带构建好的提示词；任何为空的（例如导入的裸镜头）
 *  从场景 + 角色卡一次性填上；被用户手改过的镜头（`editedRef`）不覆盖。
 *
 *  `scenes` / `characters` / `styles` 是父级每次渲染可能重建的数组，走 ref
 *  读最新值（每次渲染后同步），触发源只留 `shots` —— 否则父级任何一次
 *  重渲染都会让它跑一遍 O(N) 扫描（`onShotsChange` 是 setState，引用稳定）。 */
function useAutoFillPrompts(
  shots: Array<Shot>,
  inputs: { characters: Array<Character>; scenes: Array<Scene>; styles: Array<StyleRef> },
  onShotsChange: React.Dispatch<React.SetStateAction<Array<Shot>>>,
  editedRef: React.RefObject<Set<string>>,
): void {
  const inputsRef = React.useRef(inputs);
  React.useEffect(() => {
    inputsRef.current = inputs;
  });
  React.useEffect(() => {
    const needsFill = shots.some((s) => !s.prompt.trim() && !editedRef.current.has(s.id));
    if (!needsFill) {
      return;
    }
    const { scenes, characters, styles } = inputsRef.current;
    onShotsChange((prev) =>
      prev.map((shot) => {
        if (shot.prompt.trim() || editedRef.current.has(shot.id)) {
          return shot;
        }
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
  }, [shots, onShotsChange, editedRef]);
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
  projectId,
  apiChannels,
  onOpenModelAdapters,
  onShotsChange,
  onNotice,
  onCancelShot,
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
  const { progress, report: reportProgress, flush: flushProgress } = useThrottledProgressMap();
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  /* 批处理的忙碌位走唯一出口（规范 16 §16.2.4.71）：它此前复位写在循环之后，
   * 循环里抛错就永远停在「批处理中」。 */
  const batch = useBusyAction();
  /** 提示词被用户手改过的镜头 —— 自动预填不得覆盖。 */
  const editedRef = React.useRef<Set<string>>(new Set());

  const apiReady = apiChannels?.image.configured === true;
  const busyCount = shots.filter((s) => s.status === "running").length;
  const doneCount = shots.filter((s) => s.imageUrl !== undefined && s.imageUrl !== "").length;
  const pending = shots.filter(
    (s) =>
      (s.imageUrl === undefined || s.imageUrl === "") &&
      (s.status === "idle" || s.status === "failed"),
  );

  // ── 自动预填：分镜输出 → 图片提示词（逻辑收在 useAutoFillPrompts）──
  useAutoFillPrompts(shots, { scenes, characters, styles }, onShotsChange, editedRef);

  function patchShot(id: string, p: Partial<Shot>) {
    onShotsChange((prev) => prev.map((s) => (s.id === id ? { ...s, ...p } : s)));
  }

  function setShotError(id: string, message: string | undefined) {
    setErrors((prev) => {
      const next = { ...prev };
      if (message !== undefined && message !== "") {
        next[id] = message;
      } else {
        delete next[id];
      }
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
            if (out.kind !== "video") {
              patchShot(shotId, { imageUrl: out.url });
            }
          },
          onSettled: (r) => {
            /* 落定即写终值（见 VideoStudio 同处注释）。 */
            flushProgress(shotId, 100);
            patchShot(shotId, { status: r.ok ? "done" : "failed" });
            if (!r.ok) {
              setShotError(shotId, r.message ?? "生成失败");
            }
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

  /** 返回本机任务的 taskId（抽卡优选要收集候选；API 直连与门禁早退为 null）。 */
  async function generateShot(shot: Shot): Promise<string | null> {
    if (!shot.prompt.trim()) {
      setShotError(shot.id, "提示词为空,请先填写或完成上一阶段提取");
      return null;
    }
    /* 本地通道没有内置模板可回落：必须先在工作流库选好一个生图工作流。
     * 门禁放在入口，避免带着空 workflow id 去拉详情（会得到一条无落点的请求）。 */
    if (channel === "local" && !workflowId) {
      setShotError(
        shot.id,
        "本地通道需要先在右侧「生成资源」选择一个生图工作流；或切到远端 API 通道",
      );
      return null;
    }
    setShotError(shot.id, undefined);
    patchShot(shot.id, { status: "running" });
    try {
      if (channel === "local") {
        /* 镜头存的是尺寸表达（老数据可能是"832x1216"，回读时归一）——
         * 尺寸只表达一次，两种目标形状都由它现算。 */
        const sizeSpec = parseShotSize(
          shot.params.size !== undefined && shot.params.size !== "" ? shot.params.size : shotSize,
        );
        /* 定妆照 → 参考图（流程 §4 的口径）：镜头相关角色选了定妆照就带上；
         * 没连参考图口的工作流会经 unmatched 提示，上传失败只提示失败数。 */
        const refs = await preparePortraitReferences(characters, shot.characterIds);
        if (refs.failedCount > 0) {
          onNotice(`${refs.failedCount} 张定妆照参考图上传失败，本次生成未使用它们`);
        }
        /* 没有内置模板作为回落：本地通道必须先在工作流库选好一个生图工作流
         *（封装口径只暴露 提示词 / 尺寸 / 参考图，其余走工作流默认值），否则
         * 没有可执行的图。见 generateShot 入口的门禁。 */
        /* 角色 LoRA（FR-QA-02③ · #2622）：出场角色里第一个绑定的生效
         * （多角色链式加载另立）；工作流没连 lora 口 → unmatched 提示。 */
        const loraChar = characters
          .filter((c) => shot.characterIds.includes(c.id))
          .find((c) => c.loraName !== undefined && c.loraName !== "");
        const built = await buildLibraryWorkflowInput(workflowId, {
          prompt: shot.prompt,
          negativePrompt: shot.negativePrompt || undefined,
          size: sizeSpec,
          ...(loraChar !== undefined && loraChar.loraName !== undefined && loraChar.loraName !== ""
            ? {
                loraName: loraChar.loraName,
                ...(loraChar.loraStrength === undefined
                  ? {}
                  : { loraStrength: loraChar.loraStrength }),
              }
            : {}),
          // 高级 · 种子：默认随机（留空每次新 seed），填数字则 pin 住（见 resolveSeed）。
          seed: resolveSeed(seedInput),
          ...(refs.files.length > 0 ? { referenceImages: refs.files } : {}),
        });
        /* 没落到任何端口的口本次不生效（工作流用图内默认值）—— 静默就是
         * 「改了没反应」（规范 10 §10.3.1），走控制器提示条说清楚。 */
        const unmatchedWarning = describeUnmatchedInputs(built.unmatched);
        if (unmatchedWarning !== null && unmatchedWarning !== "") {
          onNotice(unmatchedWarning);
        }
        const input: GenerateInput = built.input;

        const taskId = await startLocalGenerate(
          withGenerationAttribution(input, { projectId, shotId: shot.id }),
        );
        patchShot(shot.id, { taskId, status: "running" });
        await runLocalTask(shot.id, taskId);
        return taskId;
      }
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
      return null;
    } catch (error: unknown) {
      patchShot(shot.id, { status: "failed" });
      setShotError(shot.id, errorMessage(error, "生成失败"));
      return null;
    }
  }

  /** 抽卡优选（FR-QA-04④ · #2612）：连发 N 次单镜生成收集候选任务号，
   *  服务端逐张视觉评审选均分最高者；赢家 imageUrl / taskId / 评审判定
   *  patch 回镜头草稿（草稿自动保存落 production）。仅本地通道有任务行可评。
   *  忙标记走 useItemAction（P37 出口），不自己养一条「某一条在忙」。 */
  const gachaAction = useItemAction();
  const gachaShot = (shot: Shot, count: number): Promise<void> =>
    gachaAction.run(shot.id, async () => {
      const taskIds: Array<string> = [];
      for (let i = 0; i < count; i++) {
        const tid = await generateShot(shot);
        if (tid !== null && tid !== "") {
          taskIds.push(tid);
        }
      }
      if (taskIds.length < 2) {
        onNotice("有效候选不足 2 张（生成失败或无任务行），无法优选");
        return;
      }
      try {
        const res = await autoselectShot(projectId, shot.id, taskIds);
        patchShot(shot.id, {
          taskId: res.winnerTaskId,
          imageUrl: res.winnerImageUrl,
          status: "done",
        });
        const summary = res.candidates
          .map((c) => {
            const mean = c.verdict ? reviewScoreMean(c.verdict) : null;
            return `${c.taskId.slice(-4)}：${mean === null ? "无产物" : (fixed(mean, 1) ?? "?")}`;
          })
          .join(" / ");
        onNotice(`优选完成：…${res.winnerTaskId.slice(-4)} 胜出（${summary}）`);
      } catch (error: unknown) {
        onNotice(errorMessage(error, "优选失败"));
      }
    });

  async function generateBatch() {
    if (pending.length === 0) {
      return;
    }
    await batch.run(() =>
      /* 有界并发（见 WORKSHOP_BATCH_CONCURRENCY）：在跑的与排队的同存，
       * 不再「await 一条到底再提交下一条」地空转。 */
      runWithConcurrency([...pending], WORKSHOP_BATCH_CONCURRENCY, async (shot) => {
        // 每轮重新检查存活 —— 用户可能在运行中编辑 / 删除。
        if (shot.status === "running" || (shot.imageUrl !== undefined && shot.imageUrl !== "")) {
          return;
        }
        await generateShot(shot);
      }),
    );
  }

  return (
    <div className="flex-col gap-4">
      {/* 通道切换（本地 ComfyUI / 配置的 API） */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-xs">生成通道</span>
        {/* 一排里选一个 → `ui/select-chip`（规范 16 §16.2.4.75）。
            此前是手搓的 `variant="outline"` + 选中三元：选中分支只写了
            「未选中之外」的那一半，而 `outline` 自带
            `hover:bg-muted hover:text-foreground` —— 划过**已选中**的那一枚
            时悬停档胜出，紫色选中翻成白字灰底。 */}
        <div aria-label="生成通道" className="flex gap-2" role="radiogroup">
          <SelectChip
            onClick={() => setChannel("local")}
            selected={channel === "local"}
            shape="segment"
          >
            本地 · ComfyUI 工作流
          </SelectChip>
          <SelectChip
            onClick={() => setChannel("api")}
            selected={channel === "api"}
            shape="segment"
          >
            API 直连{apiChannels ? (apiReady ? " · 已配置" : " · 未配置") : ""}
          </SelectChip>
        </div>
        <Button
          className="text-muted-foreground hover:text-ink bg-subtle hover:bg-surface-2 h-auto gap-1 rounded-lg px-3 py-1.5"
          onClick={onOpenModelAdapters}
          size="xs"
          variant="ghost"
        >
          <Icon data-icon="inline-start" name="settings" size={12} />
          模型适配
        </Button>
        {/* 不用 <label> 包住选择器：它内部会挂尺寸表配置弹窗，弹窗里的输入框
 会被 label 的点击行为抢焦点（弹窗开着、背后的下拉被一起触发）。 */}
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">尺寸</span>
          <ShotSizePicker disabled={batch.busy} onChange={setShotSize} value={shotSize} />
        </div>
        {channel === "local" && (
          <SeedAdvancedField disabled={batch.busy} onChange={setSeedInput} value={seedInput} />
        )}
        <Button
          className="ml-auto h-auto rounded-lg px-3 py-1.5"
          disabled={
            batch.busy ||
            pending.length === 0 ||
            (channel === "local" && !workflowId) ||
            (channel === "api" && !apiReady)
          }
          // oxlint-disable-next-line no-void -- reject 由 action 内部捕获
          onClick={() => void generateBatch()}
          size="xs"
          variant="primary-solid"
        >
          {batch.busy ? "批量生成中…" : `批量生图 (${pending.length})`}
        </Button>
        <Button
          className="text-ink bg-subtle hover:bg-surface-2 h-auto rounded-lg px-3 py-1.5"
          onClick={onNextStage}
          size="xs"
          variant="secondary"
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
          API 生图通道未配置 — 点击上方「模型适配」配置该模型的接口与字段映射 后即可使用。
        </div>
      )}

      {shots.length === 0 ? (
        <EmptyState
          className="py-10 text-sm"
          description="暂无镜头数据。请先在「场景分镜」阶段提取或生成分镜 — 镜头提示词会自动带入本阶段。"
          variant="hint"
        />
      ) : (
        <div className="flex flex-col gap-3">
          {/* 胶片带：纵向列表逐镜看很合适，但回答不了「16 镜跑到哪了、哪几镜挂了」。
              点一帧只负责把那张卡滚到眼前，不引入「当前镜头」这个新状态。 */}
          <ShotFilmStrip
            onJump={(shot) => {
              document
                .querySelector(`[data-shot-index="${shot.index}"]`)
                ?.scrollIntoView({ behavior: "smooth", block: "center" });
            }}
            shots={shots}
          />
          {shots.map((shot) => (
            <ShotCardRow
              apiReady={apiReady}
              busyCount={busyCount}
              channel={channel}
              error={errors[shot.id]}
              gachaBusy={gachaAction.isBusy(shot.id)}
              key={shot.id}
              // oxlint-disable-next-line no-void -- reject 由 action 内部捕获
              onCancel={(s) => void onCancelShot(s)}
              // oxlint-disable-next-line no-void -- reject 由 action 内部捕获
              onGacha={(s, n) => void gachaShot(s, n)}
              // oxlint-disable-next-line no-void -- reject 由 action 内部捕获
              onGenerate={(s) => void generateShot(s)}
              onPromptChange={(id, prompt) => {
                editedRef.current.add(id);
                patchShot(id, { prompt });
              }}
              progress={progress[shot.id] ?? 0}
              shot={shot}
              workflowId={workflowId}
            />
          ))}
        </div>
      )}

      {shots.length > 0 && (
        <p className="text-muted-foreground text-2xs">
          已生成 {doneCount}/{shots.length} 镜 —
          图片会自动作为下一阶段「视频生成」的首帧;缺失镜头仍可回上一阶段补齐。
        </p>
      )}
    </div>
  );
}

/* 镜头状态 → 文案：表在 `./shot-status-config`（与胶片带共用一份）。
 * 这里只 import，不再持有 —— 胶片带要被本文件 import，反向取就成了一组循环依赖。 */

function StatusBadge({ status }: { status: Shot["status"] }) {
  return (
    <StatusBadgePrimitive
      className="text-3xs px-2 py-0.5"
      dot={false}
      label={SHOT_STATUS_LABEL[status]}
      status={status}
    />
  );
}

/** 单个镜头卡片行：状态 / 进度 / 提示词编辑 / 生成按钮 / 成图预览。
 *  从 ShotStudio 主体拆出（规范 §12.13 函数长度）：主组件只留编排与工具行，
 *  「一条镜头长什么样」收在这里。 */
type ShotCardRowProps = {
  apiReady: boolean;
  /** 全表在跑的条目数（>0 且本条在跑时显示百分比 / 排队中）。 */
  busyCount: number;
  channel: Channel;
  /** 本条目的失败原因；undefined = 无错误。 */
  error: string | undefined;
  /** 本条抽卡进行中（按钮禁用 + 文案）。 */
  gachaBusy: boolean;
  /** 取消本条进行中的本机任务（有 taskId 才显示按钮）。 */
  onCancel: (shot: Shot) => void;
  /** 抽卡优选（仅本地通道有任务行可评）：连发 N 张后服务端选最优。 */
  onGacha: (shot: Shot, count: number) => void;
  onGenerate: (shot: Shot) => void;
  /** 提示词被手改：父层记入 editedRef（自动预填不再覆盖）并写回镜头。 */
  onPromptChange: (id: string, prompt: string) => void;
  /** 本条目的实时进度（0~100）。 */
  progress: number;
  shot: Shot;
  workflowId: string;
};

function ShotCardRow({
  shot,
  progress,
  error,
  busyCount,
  channel,
  workflowId,
  apiReady,
  onGenerate,
  onGacha,
  gachaBusy,
  onCancel,
  onPromptChange,
}: ShotCardRowProps) {
  const [gachaCount, setGachaCount] = React.useState(2);
  return (
    <div className="border-border bg-surface rounded-xl border p-4" data-shot-index={shot.index}>
      <div className="mb-2 flex items-center gap-2">
        <IndexDot index={shot.index} />
        <span className="text-muted-foreground truncate text-xs">{shot.sceneHeading}</span>
        <StatusBadge status={shot.status} />
        {busyCount > 0 && shot.status === "running" && (
          <span className="text-muted-foreground text-3xs">
            {progress > 0 ? `${Math.round(progress)}%` : "排队中…"}
          </span>
        )}
        <span className="text-faint text-3xs ml-auto">{channel === "local" ? "本地" : "API"}</span>
      </div>

      {shot.status === "running" && (
        <ProgressBar
          className="mb-2"
          /* 同 VideoStudio.parts：起点 0 时留一格可见。 */
          minVisible={4}
          showValue={false}
          trackClassName="bg-elevated h-1"
          value={progress}
        />
      )}

      <Textarea
        className="field-sizing-normal border-border bg-bg text-ink placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/30 min-h-0 rounded-md px-2 py-1.5 text-xs"
        onChange={(e) => onPromptChange(shot.id, e.target.value)}
        placeholder="生图提示词(自动预填自分镜与角色卡,可手动修改)"
        rows={2}
        value={shot.prompt}
      />
      {error !== undefined && error !== "" && (
        <Alert
          /* 行内错误行：紧凑尺寸 + 无可见边框（同 CharacterPortraitStudio）。 */
          className="text-2xs mt-1 block rounded-md border-transparent px-2 py-1"
          variant="danger"
        >
          {error}
        </Alert>
      )}

      <div className="mt-2 flex items-center gap-3">
        <Button
          className="h-auto rounded-lg px-4 py-1.5"
          disabled={
            shot.status === "running" ||
            !shot.prompt ||
            (channel === "local" && !workflowId) ||
            (channel === "api" && !apiReady)
          }
          onClick={() => onGenerate(shot)}
          size="xs"
          variant="primary-solid"
        >
          {shot.status === "running"
            ? "生成中…"
            : shot.imageUrl !== undefined && shot.imageUrl !== ""
              ? "重新生成"
              : "生成此镜头"}
        </Button>
        {channel === "local" && (
          /* 抽卡优选（FR-QA-04④）：本地通道才有任务行可评；N=连发张数。 */
          <div aria-label="抽卡张数" className="flex items-center gap-1" role="radiogroup">
            {[2, 3, 4].map((n) => (
              <SelectChip
                className="text-2xs"
                disabled={gachaBusy || shot.status === "running"}
                key={n}
                onClick={() => setGachaCount(n)}
                selected={gachaCount === n}
                shape="segment"
              >
                ×{n}
              </SelectChip>
            ))}
          </div>
        )}
        {channel === "local" && (
          <Button
            className="h-auto rounded-lg px-3 py-1.5"
            disabled={
              gachaBusy ||
              shot.status === "running" ||
              !shot.prompt ||
              (channel === "local" && !workflowId)
            }
            onClick={() => onGacha(shot, gachaCount)}
            size="xs"
            variant="secondary"
          >
            {gachaBusy ? "优选中…" : "抽卡优选"}
          </Button>
        )}
        {shot.status === "running" && shot.taskId !== undefined && shot.taskId !== "" && (
          /* 只对本机任务可取消（API 直连没有可取消的任务 id）：
             点击后 task.cancel 置 CANCELLED，观察循环收终态收尾。 */
          <Button
            className="text-muted-foreground hover:text-ink bg-subtle hover:bg-surface-2 h-auto rounded-lg px-3 py-1.5"
            onClick={() => onCancel(shot)}
            size="xs"
            variant="secondary"
          >
            取消
          </Button>
        )}
        {shot.taskId !== undefined && shot.taskId !== "" && (
          <span className="text-faint text-3xs truncate">任务 {shot.taskId.slice(0, 12)}…</span>
        )}
      </div>

      {shot.imageUrl !== undefined && shot.imageUrl !== "" && (
        <MediaThumbnail
          alt={shot.sceneHeading}
          className="border-border mt-2 max-h-64 w-auto rounded-lg border"
          src={shot.imageUrl}
        />
      )}
    </div>
  );
}
