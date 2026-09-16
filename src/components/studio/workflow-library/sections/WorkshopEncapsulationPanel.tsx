"use client";

// ── 工作流库详情「工坊封装」页签（规范 §17.2 第③层：只渲染 + 上抛）────────
// 替代旧的「可配置参数」草稿表单：工坊不把工作流的全部参数摊给用户，这里
// 展示的是**工坊会用哪些控件驱动这条工作流**（提示词 / 尺寸【宽高比+百万像素】/
// 负向提示词 / 参考图…），每个口落到哪个 IO 端口、哪些还没落（未配置显式可见）。
// 「流程测试」按封装口径真实跑一次生成（提示词 + 尺寸 → ComfyUI），验证它在
// 工坊里的可用性 —— 与定妆照 / 镜头生图同一条 buildLibraryWorkflowInput 链路。

import React from "react";

import { ShotSizePicker } from "@/components/workshop/ShotSizePicker";
import {
  buildLibraryWorkflowInput,
  startLocalGenerate,
  watchTask,
} from "@/lib/workshop/generation-client";
import {
  deriveEncapsulationStatus,
  type EncapsulationEntryStatus,
} from "@/lib/workshop/workshop-encapsulation-status";
import { useModeContracts } from "~/components/workshop/mode-contract/hooks/use-mode-contracts";
import { modeContractEntries } from "@/lib/workshop/model-mode-contract";
import { getWorkflowType } from "~/lib/workflow-types";
import {
  DEFAULT_SHOT_SIZE,
  type ShotSizeState,
} from "@/components/workshop/shot-size-config";
import type { WorkflowIOMap } from "~/components/studio/shared/workflow-io";

interface WorkshopEncapsulationPanelProps {
  workflowId: string;
  /** 工坊下拉/徽标展示名（模型标签优先；仅用于文案）。 */
  displayName: string;
  workflowIO: WorkflowIOMap | null;
  paramMap: Record<string, unknown> | null;
  mode: string | null | undefined;
}

/** 契约口 → 徽标配色（与执行日志的 kind 徽标同一观感）。 */
function entryBadge(entry: EncapsulationEntryStatus): string {
  if (entry.targetIoKey === null) {
    return "bg-amber-100 text-amber-800 dark:text-amber-300";
  }
  return entry.id === "negative"
    ? "bg-indigo-100 text-indigo-800 dark:text-indigo-300"
    : "bg-emerald-100 text-emerald-800 dark:text-emerald-300";
}

export function WorkshopEncapsulationPanel({
  workflowId,
  displayName,
  workflowIO,
  paramMap,
  mode,
}: WorkshopEncapsulationPanelProps) {
  /* 模式契约注册表：用户改过的模式用自定义口径，未改过的用内置默认 ——
   * 封装视图与远端适配器、实际生成链路同说一套话。清单本身经
   * `modeContractEntries` 取，与「画布节点」页签的卡片列**同一份**
   * （ISSUE #596：两个页签各读各的，口径就对不上了）。 */
  const { contracts: storedContracts } = useModeContracts();
  const status = React.useMemo(
    () =>
      deriveEncapsulationStatus({
        io: workflowIO,
        paramMap,
        mode: mode ?? null,
        contractEntries: modeContractEntries(mode, storedContracts),
      }),
    [workflowIO, paramMap, mode, storedContracts],
  );

  /* 流程测试的对外输入（与工坊同口径）：提示词 / 负向 / 尺寸。 */
  const [prompt, setPrompt] = React.useState(
    "一只戴宇航员头盔的柴犬，写实风格，高清",
  );
  const [negative, setNegative] = React.useState("");
  const [size, setSize] = React.useState<ShotSizeState>(DEFAULT_SHOT_SIZE);
  const [running, setRunning] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [logLines, setLogLines] = React.useState<string[]>([]);
  const [resultUrl, setResultUrl] = React.useState<string | null>(null);
  const [testError, setTestError] = React.useState("");

  const entryById = React.useMemo(
    () => new Map(status.entries.map((e) => [e.id, e])),
    [status],
  );
  const negativeEntry = entryById.get("negative");
  const sizeEntry = entryById.get("size");
  const promptEntry = entryById.get("prompt");
  const runTest = React.useCallback(async () => {
    if (running || !status.ready) return;
    setRunning(true);
    setProgress(0);
    setLogLines([]);
    setResultUrl(null);
    setTestError("");
    try {
      const { input } = await buildLibraryWorkflowInput(workflowId, {
        prompt,
        ...(negative.trim() ? { negativePrompt: negative.trim() } : {}),
        /* 库工作流吃尺寸表达（比例 + 档位 [+ 倍数]），不下发 "WxH" 字符串。 */
        size,
      });
      const taskId = await startLocalGenerate(input);
      await new Promise<void>((resolve) => {
        let imageUrl: string | null = null;
        watchTask(taskId, {
          onProgress: (pct) => setProgress(pct),
          onLog: (entry) => {
            if (entry.level === "progress") return;
            setLogLines((prev) => [...prev, entry.msg].slice(-100));
          },
          onOutput: (output) => {
            if (output.kind !== "video" && !imageUrl) imageUrl = output.url;
          },
          onSettled: (result) => {
            if (!result.ok) setTestError(result.message ?? "流程测试失败");
            else if (imageUrl) setResultUrl(imageUrl);
            else setTestError("任务完成但没有产出图片");
            resolve();
          },
        });
      });
    } catch (e) {
      setTestError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [running, status.ready, workflowId, prompt, negative, size]);

  return (
    <div className="border-border bg-panel-deep mx-auto max-w-2xl space-y-4 rounded-2xl border p-4">
      {/* 封装状态总览 */}
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-ink-strong text-sm font-medium">工坊封装</h3>
        {status.ready ? (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-800 dark:text-emerald-300">
            已配置 · 工坊可用
          </span>
        ) : (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800 dark:text-amber-300">
            未配置
          </span>
        )}
        {mode && (
          <span className="text-muted-foreground text-[11px]">
            {getWorkflowType(mode)?.label ?? mode}
            <span className="font-mono text-[10px]">
              （{mode.toUpperCase()}）
            </span>
          </span>
        )}
        <span className="text-muted-foreground text-[11px]">
          {status.resolvedCount}/{status.entries.length} 个对外口已落到端口
        </span>
      </div>
      {!status.ready && (
        <p className="rounded-lg bg-amber-100 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-300">
          提示词口还没落到任何端口 —— 工坊（角色卡定妆照 /
          镜头生图）无法驱动这条
          工作流。到「画布节点」页签把「提示词」卡片的圆点拖到工作流里承载提示词的
          那一行参数上（或使用自动判定），再回这里跑流程测试。
        </p>
      )}

      {/* 工坊对外口一览：每个口 = 工坊控件形态 + 生效落点 */}
      <div className="space-y-2">
        {status.entries.map((entry) => (
          <div
            key={entry.id}
            className="border-border/60 bg-surface rounded-lg border px-3 py-2"
          >
            <div className="flex items-center gap-2">
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${entryBadge(entry)}`}
              >
                {entry.targetIoKey === null ? "未配置" : "已配置"}
              </span>
              <span className="text-ink text-[12px] font-medium">
                {entry.label}
                {/* 口 id 与中文字面并列：配置 / 日志 / 代码里用的是 id，
                    而契约口与适配器口是两套 id，只写中文对不上。 */}
                <span className="text-muted-foreground/60 ml-1 font-mono text-[10px]">
                  {entry.id}
                </span>
              </span>
              <span className="text-muted-foreground/70 min-w-0 flex-1 truncate font-mono text-[10px]">
                {entry.targetIoKey ?? "—"}
              </span>
              {entry.manual && (
                <span className="text-muted-foreground text-[10px]">
                  手动落点
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* 流程测试：按封装口径真实跑一次（提示词 + 尺寸 → ComfyUI） */}
      <div className="border-primary-soft bg-primary-soft/30 rounded-xl border p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-primary text-xs font-medium">流程测试</p>
          <span className="text-muted-foreground text-[10px]">
            按工坊口径生成一张图，验证封装可用性
          </span>
        </div>
        <div className="space-y-2">
          {promptEntry?.targetIoKey && (
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={2}
              className="border-border bg-bg focus:border-primary w-full rounded-lg border px-3 py-2 text-xs outline-none"
              placeholder="测试提示词"
            />
          )}
          {negativeEntry?.targetIoKey && (
            <textarea
              value={negative}
              onChange={(event) => setNegative(event.target.value)}
              rows={1}
              className="border-border bg-bg focus:border-primary w-full rounded-lg border px-3 py-2 text-xs outline-none"
              placeholder="负向提示词（可选）"
            />
          )}
          {sizeEntry?.targetIoKey && (
            <ShotSizePicker
              value={size}
              onChange={setSize}
              disabled={running}
            />
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void runTest()}
              disabled={running || !status.ready}
              title={
                status.ready
                  ? undefined
                  : "提示词口未落到端口，工坊无法驱动这条工作流"
              }
              className="bg-primary rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-opacity disabled:opacity-40"
            >
              {running ? "测试中…" : "执行流程测试"}
            </button>
            <span className="text-muted-foreground text-[11px]">
              会真实调用本机 ComfyUI 生成一张图
            </span>
          </div>
          {running && (
            <div className="bg-elevated h-1 w-full overflow-hidden rounded-full">
              <div
                className="bg-primary h-full rounded-full transition-all"
                style={{ width: `${Math.max(4, progress)}%` }}
              />
            </div>
          )}
          {testError && (
            <p className="rounded-lg bg-red-100 px-3 py-2 text-[11px] text-red-800 dark:text-red-300">
              {testError}
            </p>
          )}
          {logLines.length > 0 && (
            <pre className="bg-bg/70 text-muted-foreground max-h-32 overflow-y-auto rounded px-2 py-1.5 text-[10.5px] leading-relaxed break-all whitespace-pre-wrap">
              {logLines.join("\n")}
            </pre>
          )}
          {resultUrl && (
            <div className="space-y-1">
              <p className="text-primary text-[11px]">
                流程测试通过 —— {displayName} 在工坊中可用。
              </p>
              <img
                src={resultUrl}
                alt="流程测试产物"
                className="border-border max-h-56 rounded-lg border"
              />
            </div>
          )}
          <p className="text-muted-foreground/70 text-[10px]">
            其余参数按工作流默认值执行，不在工坊对外暴露。
          </p>
        </div>
      </div>
    </div>
  );
}
