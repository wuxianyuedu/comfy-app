"use client";

/**
 * 本地模型（Ollama）分区与任务温度配置（规范 17 §17.2 第③层）。
 *
 * 视图自持两个纯交互态（无副作用、不入库）：
 *   - 「按任务类型配置温度」的展开态；
 *   - 任务温度输入的编辑期缓冲 —— 若直接改受控值，「清空重输」会被推荐值
 *     瞬间顶回；缓冲兜住击键，blur 后丢弃、回落到「覆盖 ?? 推荐」。
 * 其余读写都经 controller（Ollama 状态 / 草稿 / 保存动作）。
 */

import { useEffect, useRef, useState } from "react";

import {
  TEMPERATURE_TASKS,
  type ReadySettingsPageController,
} from "../hooks/use-settings-page";
import type { TaskType } from "~/lib/llm/types";
import { OLLAMA_DEFAULT_BASE_URL } from "~/lib/endpoints";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/page-loading";
import { StatusDot } from "~/components/ui/status-dot";

import {
  STATUS_ROW_CLASS,
  STATUS_TEXT_CLASS,
} from "../settings-status-row-config";

import { AnsiLogText, StatusButton, Card, Field } from "./SettingsPrimitives";

export function LlmLocalSection({ c }: { c: ReadySettingsPageController }) {
  /* 本地 Ollama 下任务温度是主配置区，默认展开。 */
  const [showTaskTemps, setShowTaskTemps] = useState(true);
  const [taskTempEdits, setTaskTempEdits] = useState<
    Partial<Record<TaskType, string>>
  >({});
  const setTaskEdit = (task: TaskType, raw: string) =>
    setTaskTempEdits((prev) => ({ ...prev, [task]: raw }));
  const clearTaskEdit = (task: TaskType) =>
    setTaskTempEdits((prev) => {
      const next = { ...prev };
      delete next[task];
      return next;
    });

  /* Ollama 启动日志的滚动跟随（同 ComfyUI / Drizzle Studio 的纯视觉偏好）。 */
  const logBoxRef = useRef<HTMLDivElement>(null);
  const [logFollow, setLogFollow] = useState(true);
  useEffect(() => {
    const el = logBoxRef.current;
    if (el && logFollow) el.scrollTop = el.scrollHeight;
  }, [c.ollamaLogText, logFollow]);
  const onLogScroll = () => {
    const el = logBoxRef.current;
    if (!el) return;
    setLogFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 32);
  };

  return (
    <Card title="本地模型（Ollama）">
      {/* Base URL 仅本地 Ollama 需要；远端的连接参数由模型条目各自携带 */}
      <Field
        label="Base URL"
        value={c.drafts.llm.baseUrl}
        onChange={(value) => c.patchLlm({ baseUrl: value })}
        placeholder={OLLAMA_DEFAULT_BASE_URL}
      />

      {/* Ollama 状态行 */}
      <div
        className={`border-border bg-surface-1 mb-4 rounded-lg border px-3 py-2.5 ${STATUS_ROW_CLASS}`}
      >
        {c.ollamaStatus === "checking" && (
          <>
            <Spinner className="size-3.5" />
            <span className={`text-muted-foreground ${STATUS_TEXT_CLASS}`}>
              检测 Ollama 服务…
            </span>
          </>
        )}
        {c.ollamaStatus === "starting" && (
          <>
            <Spinner className="size-3.5" />
            <span className={`text-muted-foreground ${STATUS_TEXT_CLASS}`}>
              Ollama 启动中，正在等待服务就绪…
            </span>
          </>
        )}
        {c.ollamaStatus === "up" && (
          <>
            <StatusDot state="up" />
            <span className={`text-ink/80 ${STATUS_TEXT_CLASS}`}>
              Ollama 运行中（{c.ollamaModels.length} 个模型可用）
            </span>
            <StatusButton
              onClick={() => void c.stopOllama()}
              disabled={c.ollamaStopping}
              className="ml-auto"
            >
              {c.ollamaStopping ? "关闭中…" : "关闭 Ollama"}
            </StatusButton>
          </>
        )}
        {c.ollamaStatus === "down" && (
          <>
            <StatusDot state="down" />
            <span className={`text-ink/80 ${STATUS_TEXT_CLASS}`}>
              Ollama 未运行
            </span>
            <StatusButton
              onClick={() => void c.startOllama()}
              disabled={c.ollamaStarting}
              className="ml-auto"
            >
              {c.ollamaStarting ? "启动中…" : "启动 Ollama"}
            </StatusButton>
          </>
        )}
      </div>

      {/* Ollama 启动日志：启动期间每秒跟随 log/services/ollama-runtime.log，
          让「启动中…」不再是黑盒（同 ComfyUI / Drizzle Studio 的用户
          可见出口）。 */}

      <div className="border-border bg-surface-1 mb-4 rounded-xl border">
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-ink/80 flex items-center gap-2 text-sm font-medium">
            启动日志（ollama-runtime.log）
            {c.ollamaLogActive && (
              <span className="text-success-strong inline-flex items-center gap-1.5 text-[10px] font-normal">
                <StatusDot state="up" sizeClass="size-1.5" pulse />
                跟随中
              </span>
            )}
          </span>
          <div className="flex items-center gap-2">
            {!logFollow && (
              <Button
                size="xs"
                onClick={() => setLogFollow(true)}
                className="h-auto rounded px-2 py-0.5 text-[11px] font-medium"
              >
                恢复自动滚动
              </Button>
            )}
            <Button
              variant="outline"
              size="xs"
              onClick={() => void c.refreshOllamaLog()}
              className="text-muted-foreground h-auto rounded px-2 py-0.5 text-[11px]"
            >
              刷新
            </Button>
          </div>
        </div>
        <div
          ref={logBoxRef}
          onScroll={onLogScroll}
          className="border-border-subtle bg-canvas-deep text-ink-field custom-scrollbar mx-3 mb-3 max-h-44 overflow-y-auto rounded-lg border px-3 py-2 font-mono text-[11px] leading-relaxed"
        >
          {c.ollamaLogText ? (
            <span className="break-all whitespace-pre-wrap">
              <AnsiLogText segments={c.ollamaLogSegments} />
            </span>
          ) : (
            <span className="text-muted-foreground">
              暂无日志 —— 点「启动 Ollama」后这里会实时输出拉起过程（spawn
              参数、启动输出与退出状态）；也可点「刷新」查看 最近一次运行日志。
            </span>
          )}
        </div>
      </div>

      {/* Model area — 探测到模型时用下拉 + 候选多选；否则退化为手填 */}
      {c.ollamaStatus === "up" && c.ollamaModels.length > 0 ? (
        <div className="mb-3">
          <label className="text-ink/80 mb-1.5 block text-sm font-medium">
            当前模型
          </label>
          <select
            value={c.drafts.llm.model}
            onChange={(event) => c.patchLlm({ model: event.target.value })}
            className="border-border text-ink focus:border-primary bg-surface-2 w-full rounded-lg border px-3 py-2 text-sm outline-none"
          >
            {c.ollamaModels.map((model) => (
              <option key={model.name} value={model.name}>
                {model.name}
              </option>
            ))}
          </select>
          {c.ollamaModels.length > 1 && (
            <>
              <label className="text-ink/80 mt-3 mb-1.5 block text-sm font-medium">
                工坊候选模型（可多选）
              </label>
              <div className="flex flex-wrap gap-2">
                {c.ollamaModels.map((model) => {
                  const checked =
                    model.name === c.drafts.llm.model ||
                    c.drafts.llm.localCandidates.includes(model.name);
                  return (
                    <Button
                      key={model.name}
                      variant="ghost"
                      size="xs"
                      title={
                        model.name === c.drafts.llm.model
                          ? "当前模型（始终可用）"
                          : "勾选后工坊各阶段可直接切换"
                      }
                      aria-pressed={checked}
                      onClick={() => c.toggleExtraModel(model.name)}
                      className={`h-auto rounded-lg border px-2.5 py-1 text-xs ${
                        checked
                          ? "bg-primary/15 text-primary border-primary"
                          : "text-muted-foreground hover:bg-subtle border-border"
                      }`}
                    >
                      {checked ? "✓ " : ""}
                      {model.name}
                    </Button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      ) : (
        <Field
          label="模型"
          value={c.drafts.llm.model}
          onChange={(value) => c.patchLlm({ model: value })}
          placeholder="请填写要使用的模型名，如 qwen3:14b"
        />
      )}

      <div className="mb-4 grid grid-cols-2 gap-3">
        <Field
          label="全局默认温度"
          value={String(c.drafts.llm.temperature)}
          onChange={(value) => c.patchLlm({ temperature: Number(value) || 0 })}
        />
        <Field
          label="最大 Token"
          value={String(c.drafts.llm.maxTokens)}
          onChange={(value) => c.patchLlm({ maxTokens: Number(value) || 0 })}
        />
      </div>

      {/* 按任务类型配置温度 —— 远端调用同样按这套推荐默认取温度，
          但不在此暴露配置项 */}
      <div className="border-border bg-surface-1 mb-4 rounded-xl border p-4">
        <Button
          variant="ghost"
          onClick={() => setShowTaskTemps((v) => !v)}
          aria-expanded={showTaskTemps}
          className="text-ink/80 hover:text-ink mb-3 flex h-auto w-full items-center justify-between rounded-none px-0 text-sm font-medium"
        >
          <span>
            按任务类型配置温度
            <span className="text-muted-foreground ml-2 text-[11px] font-normal">
              未覆盖的任务按推荐默认生效
            </span>
          </span>
          <span className="text-muted-foreground">
            {showTaskTemps ? "▾" : "▸"}
          </span>
        </Button>
        {showTaskTemps && (
          <div className="space-y-3">
            {TEMPERATURE_TASKS.map(([key, meta]) => {
              const override = c.drafts.llm.temperatureByTask?.[key];
              const isOverridden = override !== undefined && override !== null;
              const shown =
                taskTempEdits[key] ??
                String(isOverridden ? override : meta.defaultTemperature);
              return (
                <div
                  key={key}
                  className="border-border/50 bg-surface-1 flex items-center gap-3 rounded-lg border px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-ink text-sm font-medium">
                        {meta.label}
                      </span>
                      {isOverridden ? (
                        <span className="bg-primary/15 text-primary rounded-full px-1.5 py-0.5 text-[10px] font-medium">
                          已覆盖
                        </span>
                      ) : (
                        <span className="bg-success/10 text-success-strong rounded-full px-1.5 py-0.5 text-[10px] font-medium">
                          推荐
                        </span>
                      )}
                    </div>
                    <p className="text-muted-foreground text-[11px]">
                      {meta.desc}（推荐 {meta.hint}）
                    </p>
                  </div>
                  {isOverridden && (
                    <Button
                      variant="outline"
                      size="xs"
                      title="恢复推荐默认"
                      onClick={() => {
                        clearTaskEdit(key);
                        c.setTaskTemperature(key, "");
                      }}
                      className="text-muted-foreground h-auto rounded px-1.5 py-0.5 text-[11px]"
                    >
                      ↺
                    </Button>
                  )}
                  <input
                    type="number"
                    step={0.05}
                    min={0}
                    max={2}
                    value={shown}
                    onChange={(event) => {
                      setTaskEdit(key, event.target.value);
                      c.setTaskTemperature(key, event.target.value);
                    }}
                    onBlur={() => clearTaskEdit(key)}
                    className="border-border text-ink focus:border-primary bg-surface-2 w-24 rounded-lg border px-2 py-1.5 text-right text-sm outline-none"
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      <StatusButton onClick={() => void c.saveLlm()} disabled={c.saving}>
        保存 LLM 配置
      </StatusButton>
    </Card>
  );
}
