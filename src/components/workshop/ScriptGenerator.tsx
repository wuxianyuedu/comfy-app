"use client";
import React from "react";
import { textHandler } from "~/lib/form-props";
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import { useBusyAction } from "~/components/ui/use-busy-action";
import { Textarea } from "~/components/ui/textarea";
import { SelectMenu } from "~/components/ui/select-menu";
import { FormField } from "~/components/ui/form-field";
import type { ProjectMeta, ProjectType } from "~/lib/workshop/types";
import { PROJECT_TYPE_LABELS } from "~/lib/workshop/types";
import { useLLM } from "~/components/workshop/LLMContext";
import { ExtractModelSelect } from "~/components/workshop/ExtractModelSelect";
import {
  channelProviderLabel,
  channelSelectionDisplayValue,
  resolveChannelSelection,
} from "~/lib/workshop/channel-options";
import { streamChat } from "~/lib/llm/browser";
import { buildScriptMarkdownMessages } from "~/lib/llm/prompts";
import { errorMessage } from "~/lib/error-message";

interface Props {
  meta: ProjectMeta;
  onMetaChange: (m: ProjectMeta) => void;
  onScriptChange: (markdown: string) => void;
}

const PROJECT_TYPES: ProjectType[] = [
  "short_video",
  "micro_film",
  "animation",
  "ad",
  "comic",
  "other",
];

/** 剧本工具：输入灵感/梗概 → 产出完整剧本 markdown，直接写入剧本内容。
 * 拆解与场景维护属于后续阶段（角色卡 / 场景分镜），这里只负责产出与修改剧本。 */
export function ScriptGenerator({ meta, onMetaChange, onScriptChange }: Props) {
  const [idea, setIdea] = React.useState("");
  /* 忙碌位走唯一出口（规范 16 §16.2.4.71）。 */
  const ai = useBusyAction();
  const [aiDraft, setAiDraft] = React.useState("");
  const [aiError, setAiError] = React.useState("");
  /** AI 生成成功提示（含本次实际使用的 本地/远端 模型） */
  const [aiStatus, setAiStatus] = React.useState("");
  /** AI 生成独立选择的 本地/远端 模型（下拉值"local::<m>" /"remote::<m>"；
   * 空串 = 未手动选择，沿用全局 config 的 provider/model）。 */
  const [genSel, setGenSel] = React.useState("");
  const { config, openSettings } = useLLM();

  /** 本次生成实际生效的 provider/model 与下拉展示值（换算见 channel-options）。 */
  const genEffective = resolveChannelSelection(genSel, config);
  const genSelectValue = channelSelectionDisplayValue(genSel, config);

  async function handleAI() {
    if (!idea.trim()) return;
    if (!config) {
      openSettings();
      return;
    }
    // 生成剧本可独立于全局配置选 本地/远端 模型：genSel 为空则沿用全局 config。
    const { provider, model } = genEffective;
    setAiDraft("");
    setAiError("");
    setAiStatus("");
    try {
      const full = await ai.run(() =>
        streamChat({
          messages: buildScriptMarkdownMessages(meta, idea),
          // 显式 provider+model：命中所选模型独立连接参数时改走该参数（与角色卡一致）
          opts: model ? { provider, model } : undefined,
          onToken: (token) => setAiDraft((draft) => draft + token),
        }),
      );
      const markdown = full.trim();
      if (!markdown) throw new Error("AI 未返回有效内容");
      onScriptChange(markdown);
      setIdea("");
      setAiStatus(
        `已用 ${channelProviderLabel(provider)} · ${model || "当前配置"} 生成剧本，已写入剧本内容。`,
      );
    } catch (e: unknown) {
      setAiError(errorMessage(e, "生成剧本失败"));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* ── 项目信息（类型 / 基调 / 梗概，供生成时参考）── */}
      <section className="border-border bg-surface rounded-xl border p-4">
        <h3 className="u-title mb-3">项目信息</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField
            label="类型"
            labelClassName="text-muted-foreground mb-1 text-xs"
          >
            <SelectMenu
              className="!bg-subtle !border-border text-sm"
              value={meta.type}
              onChange={(value) =>
                onMetaChange({ ...meta, type: value as ProjectType })
              }
              options={PROJECT_TYPES}
              labels={PROJECT_TYPE_LABELS as Record<string, string>}
              placeholder="选择类型"
            />
          </FormField>
          <FormField
            label="基调 / 情绪"
            labelClassName="text-muted-foreground mb-1 text-xs"
          >
            <input
              value={meta.tone}
              onChange={(event) =>
                onMetaChange({ ...meta, tone: event.target.value })
              }
              className="border-border bg-bg focus:border-primary w-full rounded-lg border px-3 py-2 text-sm outline-none"
              placeholder="温暖治愈 / 悬疑紧张 / 史诗感"
            />
          </FormField>
          <FormField
            label="一句话梗概"
            labelClassName="text-muted-foreground mb-1 text-xs"
            className="sm:col-span-2"
          >
            <input
              value={meta.logline}
              onChange={(event) =>
                onMetaChange({ ...meta, logline: event.target.value })
              }
              className="border-border bg-bg focus:border-primary w-full rounded-lg border px-3 py-2 text-sm outline-none"
              placeholder="一个关于…的故事"
            />
          </FormField>
        </div>
      </section>

      {/* ── 生成剧本 ── */}
      <section className="border-primary-soft bg-primary-soft/30 rounded-xl border p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-primary u-title flex items-center">
            <Icon
              name="sparkles"
              size={14}
              className="mr-1.5 inline align-[-2px]"
            />
            生成剧本
          </h3>
          {/* 与角色卡一致：本次生成可独立选择 本地 / 远端 的哪个模型 */}
          <ExtractModelSelect value={genSelectValue} onChange={setGenSel} />
        </div>
        <div className="flex flex-col gap-2">
          <Textarea
            value={idea}
            onChange={textHandler(setIdea)}
            rows={3}
            className="border-border bg-bg"
            placeholder="输入一句话灵感或粘贴一段粗稿，直接生成完整剧本…"
          />
          <Button
            variant="primary-solid"
            onClick={handleAI}
            disabled={!idea.trim() || ai.busy}
            className="h-auto w-fit rounded-lg px-4 py-2"
          >
            {ai.busy ? (
              "AI 生成中…"
            ) : (
              <>
                <Icon
                  data-icon="inline-start"
                  name="sparkles"
                  size={13}
                  className="mr-1 inline align-[-2px]"
                />
                AI 生成剧本
              </>
            )}
          </Button>
          {ai.busy && aiDraft && (
            <pre className="bg-bg text-ink/80 max-h-48 overflow-auto rounded-lg p-3 text-xs leading-relaxed whitespace-pre-wrap">
              {aiDraft}
            </pre>
          )}
          {aiError && (
            <p className="bg-destructive/10 text-destructive rounded-lg px-3 py-2 text-xs">
              {aiError}
            </p>
          )}
          {aiStatus && !aiError && (
            <p className="text-primary text-xs">{aiStatus}</p>
          )}
        </div>
      </section>
    </div>
  );
}
