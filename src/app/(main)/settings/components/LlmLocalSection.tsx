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
import { Loader2 } from "lucide-react";

import {
  TEMPERATURE_TASKS,
  type ReadySettingsPageController,
} from "../hooks/use-settings-page";
import type { TaskType } from "~/lib/llm/types";
import { OLLAMA_DEFAULT_BASE_URL } from "~/lib/endpoints";

import {
  STATUS_ROW_CLASS,
  STATUS_TEXT_CLASS,
} from "../settings-status-row-config";

import { AnsiLogText, Btn, Card, Field } from "./SettingsPrimitives";

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

      {/* Ollama status row */}
      <div
        className={`border-border bg-surface-1 mb-4 rounded-lg border px-3 py-2.5 ${STATUS_ROW_CLASS}`}
      >
        {c.ollamaStatus === "checking" && (
          <>
            <Loader2 size={14} className="text-muted-foreground animate-spin" />
            <span className={`text-muted-foreground ${STATUS_TEXT_CLASS}`}>
              检测 Ollama 服务…
            </span>
          </>
        )}
        {c.ollamaStatus === "starting" && (
          <>
            <Loader2 size={14} className="text-muted-foreground animate-spin" />
            <span className={`text-muted-foreground ${STATUS_TEXT_CLASS}`}>
              Ollama 启动中，正在等待服务就绪…
            </span>
          </>
        )}
        {c.ollamaStatus === "up" && (
          <>
            <span className="inline-block size-2 shrink-0 rounded-full bg-emerald-400" />
            <span className={`text-ink/80 ${STATUS_TEXT_CLASS}`}>
              Ollama 运行中（{c.ollamaModels.length} 个模型可用）
            </span>
            <Btn
              onClick={() => void c.stopOllama()}
              disabled={c.ollamaStopping}
              className="ml-auto shrink-0"
            >
              {c.ollamaStopping ? "关闭中…" : "关闭 Ollama"}
            </Btn>
          </>
        )}
        {c.ollamaStatus === "down" && (
          <>
            <span className="inline-block size-2 shrink-0 rounded-full bg-rose-400" />
            <span className={`text-ink/80 ${STATUS_TEXT_CLASS}`}>
              Ollama 未运行
            </span>
            <Btn
              onClick={() => void c.startOllama()}
              disabled={c.ollamaStarting}
              className="ml-auto shrink-0"
            >
              {c.ollamaStarting ? "启动中…" : "启动 Ollama"}
            </Btn>
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
              <span className="inline-flex items-center gap-1.5 text-[10px] font-normal text-emerald-600 dark:text-emerald-400">
                <span className="inline-block size-1.5 animate-pulse rounded-full bg-emerald-400" />
                跟随中
              </span>
            )}
          </span>
          <div className="flex items-center gap-2">
            {!logFollow && (
              <button
                type="button"
                onClick={() => setLogFollow(true)}
                className="bg-primary/90 hover:bg-primary rounded px-2 py-0.5 text-[11px] font-medium text-white"
              >
                恢复自动滚动
              </button>
            )}
            <button
              type="button"
              onClick={() => void c.refreshOllamaLog()}
              className="border-border text-muted-foreground hover:bg-subtle rounded border px-2 py-0.5 text-[11px] transition-colors"
            >
              刷新
            </button>
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
                    <button
                      key={model.name}
                      type="button"
                      title={
                        model.name === c.drafts.llm.model
                          ? "当前模型（始终可用）"
                          : "勾选后工坊各阶段可直接切换"
                      }
                      onClick={() => c.toggleExtraModel(model.name)}
                      className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                        checked
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-border text-muted-foreground hover:bg-subtle"
                      }`}
                    >
                      {checked ? "✓ " : ""}
                      {model.name}
                    </button>
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
        <button
          type="button"
          onClick={() => setShowTaskTemps((v) => !v)}
          className="text-ink/80 hover:text-ink mb-3 flex w-full items-center justify-between text-sm font-medium"
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
        </button>
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
                        <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                          推荐
                        </span>
                      )}
                    </div>
                    <p className="text-muted-foreground text-[11px]">
                      {meta.desc}（推荐 {meta.hint}）
                    </p>
                  </div>
                  {isOverridden && (
                    <button
                      type="button"
                      title="恢复推荐默认"
                      onClick={() => {
                        clearTaskEdit(key);
                        c.setTaskTemperature(key, "");
                      }}
                      className="border-border text-muted-foreground hover:bg-subtle rounded border px-1.5 py-0.5 text-[11px]"
                    >
                      ↺
                    </button>
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

      <Btn onClick={() => void c.saveLlm()} disabled={c.saving}>
        保存 LLM 配置
      </Btn>
    </Card>
  );
}
