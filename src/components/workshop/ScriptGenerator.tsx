"use client";
import React from "react";
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import { SelectMenu } from "~/components/ui/select-menu";
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
import {
  buildScriptMarkdownMessages,
  buildScriptTemplate,
} from "~/lib/llm/prompts";
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
 *  拆解与场景维护属于后续阶段（角色卡 / 场景分镜），这里只负责产出与修改剧本。 */
export function ScriptGenerator({ meta, onMetaChange, onScriptChange }: Props) {
  const [idea, setIdea] = React.useState("");
  const [aiBusy, setAiBusy] = React.useState(false);
  const [aiDraft, setAiDraft] = React.useState("");
  const [aiError, setAiError] = React.useState("");
  /** AI 生成成功提示（含本次实际使用的 本地/远端 模型） */
  const [aiStatus, setAiStatus] = React.useState("");
  /** AI 生成独立选择的 本地/远端 模型（下拉值 "local::<m>" / "remote::<m>"；
   *  空串 = 未手动选择，沿用全局 config 的 provider/model）。 */
  const [genSel, setGenSel] = React.useState("");
  const { config, openSettings } = useLLM();

  /** 本次生成实际生效的 provider/model 与下拉展示值（换算见 channel-options）。 */
  const genEffective = resolveChannelSelection(genSel, config);
  const genSelectValue = channelSelectionDisplayValue(genSel, config);

  /** 模板结构化（离线）：不调用模型，按固定模板产出可编辑的剧本骨架 */
  function handleStructure() {
    if (!idea.trim()) return;
    onScriptChange(buildScriptTemplate(meta, idea));
    setIdea("");
  }

  async function handleAI() {
    if (!idea.trim()) return;
    if (!config) {
      openSettings();
      return;
    }
    // 生成剧本可独立于全局配置选 本地/远端 模型：genSel 为空则沿用全局 config。
    const { provider, model } = genEffective;
    setAiBusy(true);
    setAiDraft("");
    setAiError("");
    setAiStatus("");
    try {
      const full = await streamChat({
        messages: buildScriptMarkdownMessages(meta, idea),
        // 显式 provider+model：命中所选模型独立连接参数时改走该参数（与角色卡一致）
        opts: model ? { provider, model } : undefined,
        onToken: (token) => setAiDraft((draft) => draft + token),
      });
      const markdown = full.trim();
      if (!markdown) throw new Error("AI 未返回有效内容");
      onScriptChange(markdown);
      setIdea("");
      setAiStatus(
        `已用 ${channelProviderLabel(provider)} · ${model || "当前配置"} 生成剧本，已写入剧本内容。`,
      );
    } catch (e: unknown) {
      setAiError(errorMessage(e, "生成剧本失败"));
    } finally {
      setAiBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* ── 项目信息（类型 / 基调 / 梗概，供生成时参考）── */}
      <section className="border-border bg-surface rounded-xl border p-4">
        <h3 className="u-title mb-3">项目信息</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-muted-foreground mb-1 block text-xs">
              类型
            </span>
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
          </label>
          <label className="block">
            <span className="text-muted-foreground mb-1 block text-xs">
              基调 / 情绪
            </span>
            <input
              value={meta.tone}
              onChange={(event) =>
                onMetaChange({ ...meta, tone: event.target.value })
              }
              className="border-border bg-bg focus:border-primary w-full rounded-lg border px-3 py-2 text-sm outline-none"
              placeholder="温暖治愈 / 悬疑紧张 / 史诗感"
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="text-muted-foreground mb-1 block text-xs">
              一句话梗概
            </span>
            <input
              value={meta.logline}
              onChange={(event) =>
                onMetaChange({ ...meta, logline: event.target.value })
              }
              className="border-border bg-bg focus:border-primary w-full rounded-lg border px-3 py-2 text-sm outline-none"
              placeholder="一个关于…的故事"
            />
          </label>
        </div>
      </section>

      {/* ── 生成剧本 ── */}
      <section className="border-primary-soft bg-primary-soft/30 rounded-xl border p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-primary flex items-center text-sm font-semibold">
            <Icon
              name="sparkles"
              size={14}
              className="mr-1.5 inline align-[-2px]"
            />
            生成剧本
          </h3>
          {/* 与角色卡一致：本次生成可独立选择 本地 / 远端 的哪个模型 */}
          <ExtractModelSelect
            value={genSelectValue}
            onChange={setGenSel}
            allowTool={false}
          />
        </div>
        <div className="space-y-2">
          <textarea
            value={idea}
            onChange={(event) => setIdea(event.target.value)}
            rows={3}
            className="border-border bg-bg focus:border-primary w-full rounded-lg border px-3 py-2 text-sm outline-none"
            placeholder="输入一句话灵感或粘贴一段粗稿，直接生成完整剧本…"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={handleStructure}
              disabled={!idea.trim() || aiBusy}
              className="border-border text-ink hover:bg-subtle h-auto rounded-lg px-4 py-2"
            >
              模板生成（离线）
            </Button>
            <Button
              variant="primary-solid"
              onClick={handleAI}
              disabled={!idea.trim() || aiBusy}
              className="h-auto rounded-lg px-4 py-2"
            >
              {aiBusy ? (
                "AI 生成中…"
              ) : (
                <>
                  <Icon
                    name="sparkles"
                    size={13}
                    className="mr-1 inline align-[-2px]"
                  />
                  AI 生成剧本
                </>
              )}
            </Button>
          </div>
          {aiBusy && aiDraft && (
            <pre className="bg-bg text-ink/80 max-h-48 overflow-auto rounded-lg p-3 text-xs leading-relaxed whitespace-pre-wrap">
              {aiDraft}
            </pre>
          )}
          {aiError && (
            <p className="rounded-lg bg-red-100 px-3 py-2 text-xs text-red-800 dark:text-red-300">
              {aiError}
            </p>
          )}
          {aiStatus && !aiError && (
            <p className="text-primary text-xs">{aiStatus}</p>
          )}
          {!config && !aiBusy && (
            <p className="text-muted-foreground text-xs">
              未配置 LLM，AI 生成将不可用（仍可用「模板生成」）。可在右上角「LLM
              设置」中接入本地或远端模型。
            </p>
          )}
          {config && !genSel && (
            <p className="text-muted-foreground text-xs">
              未手动选择模型时，沿用全局配置（当前：
              {channelProviderLabel(config.provider)} ·{" "}
              {config.model || "未选模型"}）。点上方下拉可切换本次生成的
              本地/远端 模型。
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
