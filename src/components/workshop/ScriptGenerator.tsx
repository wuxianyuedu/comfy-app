"use client";
import React from "react";
import { Trash } from "lucide-react";
import { DarkSelect } from "@/components/studio/ui/DarkSelect";
import { NumberField } from "@/components/studio/ui/NumberField";
import { Icon } from "@/components/ui/Icon";
import type { Scene, ProjectMeta, ProjectType } from "@/lib/workshop/types";
import { PROJECT_TYPE_LABELS } from "@/lib/workshop/types";
import { parseIdeaToScenes, newScene, workshopUid } from "@/lib/workshop/script-parser";
import { useLLM } from "@/components/workshop/LLMContext";
import { streamChat } from "@/lib/llm/browser";
import { buildScriptMessages, parseScriptScenes } from "@/lib/llm/prompts";

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
  scenes: Scene[];
  onMetaChange: (m: ProjectMeta) => void;
  onScenesChange: (s: Scene[]) => void;
}

const PROJECT_TYPES: ProjectType[] = [
  "short_video",
  "micro_film",
  "animation",
  "ad",
  "comic",
  "other",
];

export function ScriptGenerator({ meta, scenes, onMetaChange, onScenesChange }: Props) {
  const [idea, setIdea] = React.useState("");
  const [expanded, setExpanded] = React.useState(false);
  const [aiBusy, setAiBusy] = React.useState(false);
  const [aiDraft, setAiDraft] = React.useState("");
  const [aiError, setAiError] = React.useState("");
  const { config, openSettings } = useLLM();

  function handleStructure() {
    if (!idea.trim()) return;
    const parsed = parseIdeaToScenes(idea, meta);
    onScenesChange([...scenes, ...parsed]);
    setIdea("");
    setExpanded(false);
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
        messages: buildScriptMessages(meta, idea),
        onToken: (token) => setAiDraft((draft) => draft + token),
      });
      const raws = parseScriptScenes(full);
      if (!raws.length) throw new Error("AI 未返回有效场景");
      const newScenes: Scene[] = raws.map((raw) =>({        id: workshopUid("scene"),
        heading: raw.heading,
        location: raw.location ?? "",
        time: raw.time ?? "",
        action: raw.action,
        dialogue: raw.dialogue ?? "",
        shotCount: raw.shotCount ?? 2,
      }));
      onScenesChange([...scenes, ...newScenes]);
      setIdea("");
      setExpanded(false);
    } catch (e: unknown) {
      setAiError(errorMessage(e, "AI 扩写失败"));
    } finally {
      setAiBusy(false);
    }
  }

  function updateScene(id: string, patch: Partial<Scene>) {
    onScenesChange(scenes.map((scene) =>(scene.id === id ? { ...scene, ...patch } : scene)));
  }

  function removeScene(id: string) {
    onScenesChange(scenes.filter((scene) => scene.id !== id));
  }

  function addScene() {
    onScenesChange([...scenes, newScene(scenes.length + 1)]);
  }

  return (
    <div className="space-y-5">
      {/* ── Project meta ── */}
      <section className="rounded-xl border border-border bg-surface p-4">
        <h3 className="u-title mb-3">项目信息</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs text-muted-foreground">标题</span>
            <input
              value={meta.title}
              onChange={(event) => onMetaChange({ ...meta, title: event.target.value })}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-primary"
              placeholder="我的短片"
            />
          </label>
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
          <label className="block">
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

      {/* ── Smart assist ── */}
      <section className="rounded-xl border border-primary-soft bg-primary-soft/30 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="flex items-center text-sm font-semibold text-primary">
            <Icon name="sparkles" size={14} className="mr-1.5 inline align-[-2px]" />智能辅助结构化
          </h3>
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="text-xs text-muted-foreground hover:text-ink"
          >
            {expanded ? "收起" : "展开输入"}
          </button>
        </div>
        {expanded && (
          <div className="space-y-2">
            <textarea
              value={idea}
              onChange={(event) => setIdea(event.target.value)}
              rows={3}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-primary"
              placeholder="输入一句话灵感或粘贴一段粗稿，自动拆分为场景结构…"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleStructure}
                disabled={!idea.trim() || aiBusy}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-subtle disabled:opacity-40"
              >
                模板结构化（离线）
              </button>
              <button
                type="button"
                onClick={handleAI}
                disabled={!idea.trim() || aiBusy}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-40"
              >
                {aiBusy ? "AI 扩写中…" : (<><Icon name="sparkles" size={13} className="mr-1 inline align-[-2px]" />AI 智能扩写</>)}
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
                未配置 LLM，AI 扩写将不可用。可在右上角「LLM 设置」中接入本地或远端模型。
              </p>
            )}
          </div>
        )}
        {!expanded && (
          <p className="text-xs text-muted-foreground">
            输入一句话灵感或粘贴粗稿，自动拆分为场景结构（场景名 / 地点 / 时间 / 画面 / 台词）。
          </p>
        )}
      </section>

      {/* ── Scene list ── */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="u-title">
            场景列表 <span className="text-muted-foreground">({scenes.length})</span>
          </h3>
          <button
            type="button"
            onClick={addScene}
            className="rounded-lg border border-border px-3 py-1.5 text-xs text-primary hover:bg-subtle"
          >
            + 手动添加
          </button>
        </div>

        {scenes.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
            还没有场景。试试上方「智能辅助」或手动添加。
          </div>
        ) : (
          <div className="space-y-3">
            {scenes.map((scene, i) => (
              <div key={scene.id} className="rounded-xl border border-border bg-surface p-4">
                <div className="mb-2 flex items-center gap-2">
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
                    {i + 1}
                  </span>
                  <input
                    value={scene.heading}
                    onChange={(event) => updateScene(scene.id, { heading: event.target.value })}
                    className="flex-1 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium text-ink outline-none hover:border-border focus:border-primary"
                  />
                  <button
                    type="button"
                    onClick={() => removeScene(scene.id)}
                    className="text-muted-foreground hover:text-red-500"
                    aria-label="删除场景"
                  >
                    <Trash size={16} />
                  </button>
                </div>

                <div className="mb-2 grid grid-cols-2 gap-2">
                  <input
                    value={scene.location}
                    onChange={(event) => updateScene(scene.id, { location: event.target.value })}
                    className="rounded-md border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-primary"
                    placeholder="地点"
                  />
                  <input
                    value={scene.time}
                    onChange={(event) => updateScene(scene.id, { time: event.target.value })}
                    className="rounded-md border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-primary"
                    placeholder="时间"
                  />
                </div>

                <textarea
                  value={scene.action}
                  onChange={(event) => updateScene(scene.id, { action: event.target.value })}
                  rows={2}
                  className="mb-2 w-full rounded-md border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-primary"
                  placeholder="画面 / 动作描述"
                />
                <input
                  value={scene.dialogue}
                  onChange={(event) => updateScene(scene.id, { dialogue: event.target.value })}
                  className="w-full rounded-md border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-primary"
                  placeholder="台词 / 旁白"
                />

                <div className="mt-2 flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">建议镜头数</span>
                  <NumberField
                    value={scene.shotCount}
                    onChange={(value) => updateScene(scene.id, { shotCount: value })}
                    min={1}
                    max={10}
                    step={1}
                    className="w-16"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
