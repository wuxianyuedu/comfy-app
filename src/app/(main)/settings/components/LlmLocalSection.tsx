"use client";

/**
 * 本地模型（Ollama）分区与任务温度配置（规范 17 §17.2 第③层）。
 *
 * 视图自持两个纯交互态（无副作用、不入库）：
 * - 「按任务类型配置温度」的展开态；
 * - 任务温度输入的编辑期缓冲 —— 若直接改受控值，「清空重输」会被推荐值
 * 瞬间顶回；缓冲兜住击键，blur 后丢弃、回落到「覆盖 ?? 推荐」。
 * 其余读写都经 controller（Ollama 状态 / 草稿 / 保存动作）。
 */

import { useState } from "react";
import { textHandler } from "~/lib/form-props";

import {
  TEMPERATURE_TASKS,
  type ReadySettingsPageController,
} from "../hooks/use-settings-page";
import type { TaskType } from "~/lib/llm/types";
import { OLLAMA_DEFAULT_BASE_URL } from "~/lib/endpoints";
import { Button } from "~/components/ui/button";
import { FormField } from "~/components/ui/form-field";
import { Input } from "~/components/ui/input";
import { Spinner } from "~/components/ui/spinner";
import { StatusDot } from "~/components/ui/status-dot";
import { Disclosure } from "~/components/ui/disclosure";

import {
  STATUS_ROW_CLASS,
  STATUS_TEXT_CLASS,
} from "../settings-status-row-config";

import { SettingsCard } from "~/components/ui/settings-card";
import { StatusButton, Field } from "./SettingsPrimitives";
import { RuntimeLogBox } from "./RuntimeLogBox";

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

  return (
    <SettingsCard title="本地模型（Ollama）">
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
 可见出口）。下拉按「每次启动」切换、可全屏，见 RuntimeLogBox。 */}
      <RuntimeLogBox
        fileName="ollama-runtime.log"
        log={c.ollamaLog}
        emptyHint={
          <>
            暂无日志 —— 点「启动 Ollama」后这里会实时输出拉起过程（spawn
            参数、启动输出与退出状态）；也可点「刷新」查看 最近一次运行日志。
          </>
        }
      />

      {/* Model area — 探测到模型时用下拉 + 候选多选；否则退化为手填 */}
      {c.ollamaStatus === "up" && c.ollamaModels.length > 0 ? (
        <div className="mb-3">
          <FormField label="当前模型" id="ollama-current-model">
            {(a11y) => (
              <select
                {...a11y}
                value={c.drafts.llm.model}
                onChange={textHandler((model) => c.patchLlm({ model }))}
                className="border-border text-ink focus:border-primary bg-surface-2 w-full rounded-lg border px-3 py-2 text-sm outline-none"
              >
                {c.ollamaModels.map((model) => (
                  <option key={model.name} value={model.name}>
                    {model.name}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          {c.ollamaModels.length > 1 && (
            <>
              {/* 多选组：没有单一控件，标签行 + 下方候选按钮组。 */}
              <FormField label="工坊候选模型（可多选）" className="mt-3" />
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
                      {checked ? "✓" : ""}
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
        {/* 折叠开关 + 面板：`▸/▾` 与`aria-expanded` 都由基元给
 （规范 16 §16.2.4.13）。基元默认 marker 在标题**左侧**，这里标题
 在左、marker 在右 —— 用`flex-row-reverse` 把 marker 换到右侧，
 标题自身以`flex-1` 撑开，于是两端对齐的观感不变。 */}
        <Disclosure
          open={showTaskTemps}
          onOpenChange={setShowTaskTemps}
          marker="caret"
          className="text-ink/80 hover:text-ink mb-3 flex-row-reverse items-center justify-between text-sm font-medium"
          panelClassName="flex-col gap-3"
          trigger={
            <span className="flex-1 text-left">
              按任务类型配置温度
              <span className="text-muted-foreground ml-2 text-[11px] font-normal">
                未覆盖的任务按推荐默认生效
              </span>
            </span>
          }
        >
          <div className="flex flex-col gap-3">
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
                  <Input
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
                    className="border-border bg-surface-2 text-ink focus-visible:border-primary focus-visible:ring-primary/30 h-auto w-24 rounded-lg px-2 py-1.5 text-right text-sm"
                  />
                </div>
              );
            })}
          </div>
        </Disclosure>
      </div>

      <StatusButton onClick={() => void c.saveLlm()} disabled={c.saving}>
        保存 LLM 配置
      </StatusButton>
    </SettingsCard>
  );
}
