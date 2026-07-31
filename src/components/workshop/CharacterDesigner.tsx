"use client";

import React from "react";
import type { Character, StyleRef } from "@/lib/workshop/types";
import { buildCharacterPrompt, buildCharacterNegative } from "@/lib/workshop/prompt-builder";
import { workshopUid } from "@/lib/workshop/script-parser";
import { useLLM } from "@/components/workshop/llm-context";
import { streamChat } from "@/lib/llm/browser";
import {
  buildCharacterMessages,
  buildCharacterFromBriefMessages,
  parseCharacter,
  parseCharacterFull,
} from "@/lib/llm/prompts";

interface Props {
  characters: Character[];
  styles: StyleRef[]; // available Skill styles
  onCharactersChange: (c: Character[]) => void;
}

function newCharacter(): Character {
  return {
    id: workshopUid("char"),
    name: "",
    ageGender: "",
    appearance: "",
    costume: "",
    personality: "",
    styleTags: [],
    positivePrompt: "",
    negativePrompt: "",
    params: {},
  };
}

export function CharacterDesigner({ characters, styles, onCharactersChange }: Props) {
  const [tagInputs, setTagInputs] = React.useState<Record<string, string>>({});
  const [brief, setBrief] = React.useState("");
  const [genBusy, setGenBusy] = React.useState(false);
  const [aiBusyId, setAiBusyId] = React.useState<string | null>(null);
  const [aiError, setAiError] = React.useState("");
  const { config, openSettings } = useLLM();

  function update(id: string, patch: Partial<Character>) {
    onCharactersChange(
      characters.map((c) => {
        if (c.id !== id) return c;
        const next = { ...c, ...patch };
        // Recompute prompts
        const style = styles.find((s) => s.slug === next.skillSlug);
        next.positivePrompt = buildCharacterPrompt(next, style);
        next.negativePrompt = buildCharacterNegative(next, style);
        if (style?.defaultParams) next.params = { ...style.defaultParams };
        return next;
      })
    );
  }

  function remove(id: string) {
    onCharactersChange(characters.filter((c) => c.id !== id));
  }

  function add() {
    onCharactersChange([...characters, newCharacter()]);
  }

  async function handleAIGenerate() {
    if (!brief.trim()) return;
    if (!config) {
      openSettings();
      return;
    }
    setGenBusy(true);
    setAiError("");
    try {
      const full = await streamChat({
        messages: buildCharacterFromBriefMessages(brief),
        onToken: () => {},
      });
      const r = parseCharacterFull(full);
      const c = newCharacter();
      c.name = r.name;
      c.appearance = r.appearance;
      c.costume = r.costume;
      c.personality = r.personality;
      // recompute prompts via existing update path
      const style = styles[0];
      c.positivePrompt = buildCharacterPrompt(c, style);
      c.negativePrompt = buildCharacterNegative(c, style);
      onCharactersChange([...characters, c]);
      setBrief("");
    } catch (e: any) {
      setAiError(e?.message || "AI 生成失败");
    } finally {
      setGenBusy(false);
    }
  }

  async function handleAICard(c: Character) {
    if (!config) {
      openSettings();
      return;
    }
    if (!c.name.trim()) {
      setAiError("请先填写角色名再使用 AI 润色");
      return;
    }
    setAiBusyId(c.id);
    setAiError("");
    try {
      const style = styles.find((s) => s.slug === c.skillSlug);
      const full = await streamChat({
        messages: buildCharacterMessages({
          name: c.name,
          appearance: c.appearance,
          costume: c.costume,
          personality: c.personality,
          styleTags: c.styleTags,
          skillName: style?.name,
        }),
        onToken: () => {},
      });
      const r = parseCharacter(full);
      update(c.id, {
        appearance: r.appearance || c.appearance,
        costume: r.costume || c.costume,
        personality: r.personality || c.personality,
      });
    } catch (e: any) {
      setAiError(e?.message || "AI 润色失败");
    } finally {
      setAiBusyId(null);
    }
  }

  function addTag(id: string, raw: string) {
    const tag = raw.trim();
    if (!tag) return;
    const c = characters.find((x) => x.id === id);
    if (!c) return;
    if (c.styleTags.includes(tag)) return;
    update(id, { styleTags: [...c.styleTags, tag] });
    setTagInputs((prev) => ({ ...prev, [id]: "" }));
  }

  function removeTag(id: string, tag: string) {
    const c = characters.find((x) => x.id === id);
    if (!c) return;
    update(id, { styleTags: c.styleTags.filter((t) => t !== tag) });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">
          角色设计 <span className="text-muted">({characters.length})</span>
        </h3>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={add}
            className="rounded-lg border border-border px-3 py-1.5 text-xs text-primary hover:bg-subtle"
          >
            + 新建角色
          </button>
        </div>
      </div>

      {/* AI: generate a full character from a one-line brief */}
      <div className="rounded-xl border border-primary-soft bg-primary-soft/30 p-3">
        <p className="mb-2 text-xs font-medium text-primary">✨ 用一句话生成角色</p>
        <div className="flex gap-2">
          <input
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !genBusy) handleAIGenerate();
            }}
            placeholder="例如：一位穿唐装的白发剑客，气质孤傲"
            className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <button
            type="button"
            onClick={handleAIGenerate}
            disabled={!brief.trim() || genBusy}
            className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-white transition-opacity disabled:opacity-40"
          >
            {genBusy ? "生成中…" : "AI 生成"}
          </button>
        </div>
        {!config && (
          <p className="mt-2 text-[11px] text-muted">
            未配置 LLM。点右上角「LLM 设置」接入本地或远端模型后即可使用 AI。
          </p>
        )}
      </div>

      {aiError && (
        <p className="rounded-lg bg-red-100 px-3 py-2 text-xs text-red-700">{aiError}</p>
      )}

      {characters.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted">
          还没有角色。添加角色后会自动生成可送入生图的提示词。
        </div>
      ) : (
        <div className="space-y-3">
          {characters.map((c, i) => (
            <div key={c.id} className="rounded-xl border border-border bg-surface p-4">
              <div className="mb-3 flex items-center gap-2">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
                  {i + 1}
                </span>
                <input
                  value={c.name}
                  onChange={(e) => update(c.id, { name: e.target.value })}
                  className="flex-1 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium text-ink outline-none hover:border-border focus:border-primary"
                  placeholder="角色名"
                />
                <button
                  type="button"
                  onClick={() => handleAICard(c)}
                  disabled={aiBusyId === c.id || genBusy}
                  className="rounded-md border border-primary-soft px-2 py-1 text-xs text-primary transition-colors hover:bg-primary-soft disabled:opacity-40"
                  title="用 LLM 补全外貌/服装/性格"
                >
                  {aiBusyId === c.id ? "…" : "✨ AI 润色"}
                </button>
                <button
                  type="button"
                  onClick={() => remove(c.id)}
                  className="text-muted hover:text-red-500"
                  aria-label="删除角色"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                  </svg>
                </button>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="年龄/性别" value={c.ageGender} onChange={(v) => update(c.id, { ageGender: v })} placeholder="25岁 女性" />
                <Field label="服装" value={c.costume} onChange={(v) => update(c.id, { costume: v })} placeholder="红色风衣，牛仔裤" />
                <Field label="外貌特征" value={c.appearance} onChange={(v) => update(c.id, { appearance: v })} placeholder="短黑发，单眼皮，清秀" />
                <Field label="性格/气质" value={c.personality} onChange={(v) => update(c.id, { personality: v })} placeholder="冷静，坚毅" />
              </div>

              {/* Style tags */}
              <div className="mt-2">
                <span className="mb-1 block text-xs text-muted">风格标签</span>
                <div className="flex flex-wrap gap-1.5">
                  {c.styleTags.map((t) => (
                    <span
                      key={t}
                      className="flex items-center gap-1 rounded-full bg-primary-soft px-2 py-0.5 text-xs text-primary"
                    >
                      {t}
                      <button type="button" onClick={() => removeTag(c.id, t)} className="hover:text-red-500">
                        ×
                      </button>
                    </span>
                  ))}
                  <input
                    value={tagInputs[c.id] ?? ""}
                    onChange={(e) => setTagInputs((p) => ({ ...p, [c.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === ",") {
                        e.preventDefault();
                        addTag(c.id, tagInputs[c.id] ?? "");
                      }
                    }}
                    onBlur={() => addTag(c.id, tagInputs[c.id] ?? "")}
                    className="w-24 rounded-full border border-border bg-bg px-2 py-0.5 text-xs outline-none focus:border-primary"
                    placeholder="输入后回车"
                  />
                </div>
              </div>

              {/* Linked style skill */}
              <div className="mt-2">
                <span className="mb-1 block text-xs text-muted">艺术风格（Skill）</span>
                <select
                  value={c.skillSlug ?? ""}
                  onChange={(e) => update(c.id, { skillSlug: e.target.value || undefined })}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-primary"
                >
                  <option value="">不指定（使用风格标签）</option>
                  {styles.map((s) => (
                    <option key={s.slug} value={s.slug}>
                      {s.icon} {s.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Generated prompt preview */}
              <div className="mt-3 rounded-lg bg-subtle p-3">
                <p className="mb-1 text-xs font-medium text-muted">生成提示词预览</p>
                <p className="text-xs leading-relaxed text-ink/80 break-words">
                  {c.positivePrompt || "填写角色信息后自动生成…"}
                </p>
                {c.negativePrompt && (
                  <p className="mt-2 text-xs leading-relaxed text-muted/70 break-words">
                    <span className="font-medium">负向：</span>
                    {c.negativePrompt}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-primary"
        placeholder={placeholder}
      />
    </label>
  );
}
