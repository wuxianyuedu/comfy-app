"use client";
import React from "react";
import { Icon } from "@/components/ui/icon";
import { DarkSelect } from "@/components/studio/ui/DarkSelect";
import type { ProjectMeta, ProjectType } from "@/lib/workshop/types";
import { PROJECT_TYPE_LABELS } from "@/lib/workshop/types";
import { useLLM } from "@/components/workshop/LLMContext";
import { streamChat } from "@/lib/llm/browser";
import {
  buildScriptMarkdownMessages,
  buildScriptTemplate,
} from "@/lib/llm/prompts";

/** catch 抛出值（unknown）→ 与旧 `e?.message ?? fallback` 逐值等价的消息提取：
 *  带 string message 的对象取 message（Error 实例即此路径），其余回退。 */
function errorMessage(e: unknown, fallback: string): string {
  if (typeof e === "object" && e !== null && "message" in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return fallback;
}

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
  const { config, openSettings } = useLLM();

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
    setAiBusy(true);
    setAiDraft("");
    setAiError("");
    try {
      const full = await streamChat({
        messages: buildScriptMarkdownMessages(meta, idea),
        onToken: (token) => setAiDraft((draft) => draft + token),
      });
      const markdown = full.trim();
      if (!markdown) throw new Error("AI 未返回有效内容");
      onScriptChange(markdown);
      setIdea("");
    } catch (e: unknown) {
      setAiError(errorMessage(e, "生成剧本失败"));
    } finally {
      setAiBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* ── 项目信息（类型 / 基调 / 梗概，供生成时参考）── */}
      <section className="rounded-xl border border-border bg-surface p-4">
        <h3 className="u-title mb-3">项目信息</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs text-muted-foreground">类型</span>
            <DarkSelect
              className="!bg-white/3 !border-white/8 text-sm"
              value={meta.type}
              onChange={(value) => onMetaChange({ ...meta, type: value as ProjectType })}
              options={PROJECT_TYPES}
              labels={PROJECT_TYPE_LABELS as Record<string, string>}
              placeholder="选择类型"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-muted-foreground">基调 / 情绪</span>
            <input
              value={meta.tone}
              onChange={(event) => onMetaChange({ ...meta, tone: event.target.value })}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-primary"
              placeholder="温暖治愈 / 悬疑紧张 / 史诗感"
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs text-muted-foreground">一句话梗概</span>
            <input
              value={meta.logline}
              onChange={(event) => onMetaChange({ ...meta, logline: event.target.value })}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-primary"
              placeholder="一个关于…的故事"
            />
          </label>
        </div>
      </section>

      {/* ── 生成剧本 ── */}
      <section className="rounded-xl border border-primary-soft bg-primary-soft/30 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="flex items-center text-sm font-semibold text-primary">
            <Icon name="sparkles" size={14} className="mr-1.5 inline align-[-2px]" />生成剧本
          </h3>
        </div>
        <div className="space-y-2">
          <textarea
            value={idea}
            onChange={(event) => setIdea(event.target.value)}
            rows={3}
            className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-primary"
            placeholder="输入一句话灵感或粘贴一段粗稿，直接生成完整剧本…"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleStructure}
              disabled={!idea.trim() || aiBusy}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-subtle disabled:opacity-40"
            >
              模板生成（离线）
            </button>
            <button
              type="button"
              onClick={handleAI}
              disabled={!idea.trim() || aiBusy}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-40"
            >
              {aiBusy ? "AI 生成中…" : (<><Icon name="sparkles" size={13} className="mr-1 inline align-[-2px]" />AI 生成剧本</>)}
            </button>
          </div>
          {aiBusy && aiDraft && (
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-bg p-3 text-xs leading-relaxed text-ink/80">
              {aiDraft}
            </pre>
          )}
          {aiError && (
            <p className="rounded-lg bg-red-100 px-3 py-2 text-xs text-red-700">
              {aiError}
            </p>
          )}
          {!config && !aiBusy && (
            <p className="text-xs text-muted-foreground">
              未配置 LLM，AI 生成将不可用（仍可用「模板生成」）。可在右上角「LLM 设置」中接入本地或远端模型。
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
