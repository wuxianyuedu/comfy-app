"use client";
import React from "react";
import { Trash } from "lucide-react";
import { DarkSelect } from "@/components/studio/ui/DarkSelect";
import { Icon } from "@/components/ui/Icon";
import type { Character, StyleRef } from "@/lib/workshop/types";
import { buildCharacterPrompt, buildCharacterNegative } from "@/lib/workshop/prompt-builder";
import { workshopUid } from "@/lib/workshop/script-parser";
import { useLLM } from "@/components/workshop/LLMContext";
import { streamChat } from "@/lib/llm/browser";
import {
  buildCharacterMessages,
  buildCharacterFromBriefMessages,
  parseCharacter,
  parseCharacterFull,
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
      characters.map((character) =>
{
        if (character.id !== id) return character;
        const next = { ...character, ...patch };
        // Recompute prompts
        const style = styles.find((style) => style.slug === next.skillSlug);
        next.positivePrompt = buildCharacterPrompt(next, style);
        next.negativePrompt = buildCharacterNegative(next, style);
        if (style?.defaultParams) next.params = { ...style.defaultParams };
        return next;
      })
    );
  }

  function remove(id: string) {
    onCharactersChange(characters.filter((character) => character.id !== id));
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
        /* onToken 不传即「无需逐 token 处理」（streamChat 内部 onToken?.() 调用） */
      });
      const r = parseCharacterFull(full);
      const character = newCharacter();
      character.name = r.name;
      character.appearance = r.appearance;
      character.costume = r.costume;
      character.personality = r.personality;
      // recompute prompts via existing update path
      const style = styles[0];
      character.positivePrompt = buildCharacterPrompt(character, style);
      character.negativePrompt = buildCharacterNegative(character, style);
      onCharactersChange([...characters, character]);
      setBrief("");
    } catch (e: unknown) {
      setAiError(errorMessage(e, "AI 生成失败"));
    } finally {
      setGenBusy(false);
    }
  }

  async function handleAICard(character: Character) {
    if (!config) {
      openSettings();
      return;
    }
    if (!character.name.trim()) {
      setAiError("请先填写角色名再使用 AI 润色");
      return;
    }
    setAiBusyId(character.id);
    setAiError("");
    try {
      const style = styles.find((style) => style.slug === character.skillSlug);
      const full = await streamChat({
        messages: buildCharacterMessages({
          name: character.name,
          appearance: character.appearance,
          costume: character.costume,
          personality: character.personality,
          styleTags: character.styleTags,
          skillName: style?.name,
        }),
        /* onToken 不传即「无需逐 token 处理」（streamChat 内部 onToken?.() 调用） */
      });
      const r = parseCharacter(full);
      update(character.id, {
        appearance: r.appearance || character.appearance,
        costume: r.costume || character.costume,
        personality: r.personality || character.personality,
      });
    } catch (e: unknown) {
      setAiError(errorMessage(e, "AI 润色失败"));
    } finally {
      setAiBusyId(null);
    }
  }

  function addTag(id: string, raw: string) {
    const tag = raw.trim();
    if (!tag) return;
    const found = characters.find((character) => character.id === id);
    if (!found) return;
    if (found.styleTags.includes(tag)) return;
    update(id, { styleTags: [...found.styleTags, tag] });
    setTagInputs((prev) => ({ ...prev, [id]: "" }));
  }

  function removeTag(id: string, tag: string) {
    const found = characters.find((character) => character.id === id);
    if (!found) return;
    update(id, { styleTags: found.styleTags.filter((styleTag) => styleTag !== tag) });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="u-title">
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
        <p className="mb-2 flex items-center text-xs font-medium text-primary">
          <Icon name="sparkles" size={13} className="mr-1 inline align-[-2px]" />用一句话生成角色
        </p>
        <div className="flex gap-2">
          <input
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !genBusy) void handleAIGenerate();
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
          {characters.map((character, i) => (
            <div key={character.id} className="rounded-xl border border-border bg-surface p-4">
              <div className="mb-3 flex items-center gap-2">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
                  {i + 1}
                </span>
                <input
                  value={character.name}
                  onChange={(event) => update(character.id, { name: event.target.value })}
                  className="flex-1 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium text-ink outline-none hover:border-border focus:border-primary"
                  placeholder="角色名"
                />
                <button
                  type="button"
                  onClick={() => handleAICard(character)}
                  disabled={aiBusyId === character.id || genBusy}
                  className="rounded-md border border-primary-soft px-2 py-1 text-xs text-primary transition-colors hover:bg-primary-soft disabled:opacity-40"
                  title="用 LLM 补全外貌/服装/性格"
                >
                  {aiBusyId === character.id ? "…" : (<><Icon name="sparkles" size={12} className="mr-1 inline align-[-2px]" />AI 润色</>)}
                </button>
                <button
                  type="button"
                  onClick={() => remove(character.id)}
                  className="text-muted hover:text-red-500"
                  aria-label="删除角色"
                >
                  <Trash size={16} />
                </button>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="年龄/性别" value={character.ageGender} onChange={(value) => update(character.id, { ageGender: value })} placeholder="25岁 女性" />
                <Field label="服装" value={character.costume} onChange={(value) => update(character.id, { costume: value })} placeholder="红色风衣，牛仔裤" />
                <Field label="外貌特征" value={character.appearance} onChange={(value) => update(character.id, { appearance: value })} placeholder="短黑发，单眼皮，清秀" />
                <Field label="性格/气质" value={character.personality} onChange={(value) => update(character.id, { personality: value })} placeholder="冷静，坚毅" />
              </div>

              {/* Style tags */}
              <div className="mt-2">
                <span className="mb-1 block text-xs text-muted">风格标签</span>
                <div className="flex flex-wrap gap-1.5">
                  {character.styleTags.map((styleTag) =>
(
                    <span
                      key={styleTag}
                      className="flex items-center gap-1 rounded-full bg-primary-soft px-2 py-0.5 text-xs text-primary"
                    >
                      {styleTag}
                      <button type="button" onClick={() => removeTag(character.id, styleTag)} className="hover:text-red-500">
                        ×
                      </button>
                    </span>
                  ))}
                  <input
                    value={tagInputs[character.id] ?? ""}
                    onChange={(event) => setTagInputs((prev) => ({ ...prev, [character.id]: event.target.value }))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === ",") {
                        event.preventDefault();
                        addTag(character.id, tagInputs[character.id] ?? "");
                      }
                    }}
                    onBlur={() => addTag(character.id, tagInputs[character.id] ?? "")}
                    className="w-24 rounded-full border border-border bg-bg px-2 py-0.5 text-xs outline-none focus:border-primary"
                    placeholder="输入后回车"
                  />
                </div>
              </div>

              {/* Linked style skill */}
              <div className="mt-2">
                <span className="mb-1 block text-xs text-muted">艺术风格（Skill）</span>
                <DarkSelect
                  className="!bg-white/3 !border-white/8 text-sm"
                  value={character.skillSlug ?? ""}
                  onChange={(value) => update(character.id, { skillSlug: value || undefined })}
                  options={styles.map((style) => style.slug)}
                  labels={Object.fromEntries(styles.map((style) =>[style.slug, `${style.icon} ${style.name}`]))}
                  placeholder="不指定（使用风格标签）"
                />
              </div>

              {/* Generated prompt preview */}
              <div className="mt-3 rounded-lg bg-subtle p-3">
                <p className="mb-1 text-xs font-medium text-muted">生成提示词预览</p>
                <p className="text-xs leading-relaxed text-ink/80 break-words">
                  {character.positivePrompt || "填写角色信息后自动生成…"}
                </p>
                {character.negativePrompt && (
                  <p className="mt-2 text-xs leading-relaxed text-muted/70 break-words">
                    <span className="font-medium">负向：</span>
                    {character.negativePrompt}
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
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-primary"
        placeholder={placeholder}
      />
    </label>
  );
}
