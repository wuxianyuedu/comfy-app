"use client";
import React from "react";
import { Trash } from "lucide-react";
import { DarkSelect } from "@/components/studio/ui/DarkSelect";
import { Icon } from "@/components/ui/Icon";
import type { Character, StyleRef } from "@/lib/workshop/types";
import { buildCharacterPrompt, buildCharacterNegative } from "@/lib/workshop/prompt-builder";
import { workshopUid } from "@/lib/workshop/script-parser";
import {
  type ExtractChannel,
  ExtractToolbar,
} from "@/components/workshop/ExtractToolbar";
import {
  buildExtractCharactersMessages,
  mergeCharacterDrafts,
  parseCharacterEntries,
  parseExtractedCharacters,
  parseImportedCharacterCards,
} from "@/lib/workshop/script-parse";
import type { ParsedCharacterDraft } from "@/lib/workshop/script-parse";
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
  /** 工坊流水线的剧本 markdown(既有状态,经 props 传入,不改变数据归属) */
  scriptMarkdown?: string;
}

/** 判断导入内容是否为 JSON(角色卡 JSON 走结构化解析,其余按剧本 markdown 解析) */
function looksLikeJson(text: string): boolean {
  return text.startsWith("{") || text.startsWith("[");
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

export function CharacterDesigner({ characters, styles, onCharactersChange, scriptMarkdown }: Props) {
  const [tagInputs, setTagInputs] = React.useState<Record<string, string>>({});
  const [brief, setBrief] = React.useState("");
  const [genBusy, setGenBusy] = React.useState(false);
  const [aiBusyId, setAiBusyId] = React.useState<string | null>(null);
  const [aiError, setAiError] = React.useState("");
  const { config, openSettings } = useLLM();

  // ── 三通道提取(工具 / 本地模型 / 配置API)+ 外部导入 ──
  const [extractChannel, setExtractChannel] = React.useState<ExtractChannel>("tool");
  const [extractBusy, setExtractBusy] = React.useState(false);
  const [extractStatus, setExtractStatus] = React.useState("");
  const [extractError, setExtractError] = React.useState("");

  const hasScript = !!scriptMarkdown?.trim();

  /** 通道 → LLM provider(工具通道不调用模型;本地/远端复用既有 /api/llm 链路) */
  function channelProvider(channel: ExtractChannel): "local" | "remote" {
    return channel === "local" ? "local" : "remote";
  }

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

  /** 三通道提取入口:工具=确定性解析;本地/API=LLM 输出 JSON,失败降级提示 */
  async function handleExtract() {
    const script = (scriptMarkdown ?? "").trim();
    if (!script) {
      setExtractError("未获取到剧本文本,请先在「剧本」阶段编写或编辑剧本");
      return;
    }
    if (extractChannel !== "tool" && !config) {
      openSettings();
      return;
    }
    setExtractBusy(true);
    setExtractStatus(extractChannel === "tool" ? "" : "正在调用模型提取角色卡…");
    setExtractError("");
    try {
      let drafts: ParsedCharacterDraft[];
      if (extractChannel === "tool") {
        drafts = parseCharacterEntries(script);
        if (drafts.length === 0) {
          setExtractError(
            "工具通道未在剧本中找到「人物:/角色:」行。可检查剧本结构后重试,或切换到本地模型 / 配置API 通道。"
          );
          return;
        }
      } else {
        const full = await streamChat({
          messages: buildExtractCharactersMessages(script),
          opts: { provider: channelProvider(extractChannel) },
        });
        drafts = parseExtractedCharacters(full);
        if (drafts.length === 0) {
          setExtractError("模型未返回有效角色卡 JSON,解析失败。可重试,或改用「工具」通道。");
          return;
        }
      }
      const res = mergeCharacterDrafts(characters, drafts, styles);
      if (res.added === 0 && res.skipped > 0) {
        setExtractError("剧本中的角色均已存在,未新增角色卡");
        return;
      }
      setExtractStatus(
        `已提取 ${res.added} 个角色卡${res.skipped > 0 ? `(跳过 ${res.skipped} 个重名)` : ""}`
      );
    } catch (e: unknown) {
      setExtractError(`${errorMessage(e, "提取失败")} 可重试,或改用「工具」通道。`);
    } finally {
      setExtractBusy(false);
    }
  }

  /** 外部导入:角色卡 JSON 按既有 Character 字段解析;markdown 走工具解析器 */
  async function handleImportFile(file: File) {
    setExtractBusy(true);
    setExtractStatus("");
    setExtractError("");
    try {
      const text = await file.text();
      const trimmed = text.trim();
      if (!trimmed) throw new Error("文件内容为空");
      let drafts: ParsedCharacterDraft[];
      if (looksLikeJson(trimmed)) {
        drafts = parseImportedCharacterCards(trimmed);
      } else {
        drafts = parseCharacterEntries(trimmed);
        if (drafts.length === 0) {
          throw new Error("未在文件中找到「人物:/角色:」行");
        }
      }
      const res = mergeCharacterDrafts(characters, drafts, styles);
      if (res.added === 0 && res.skipped > 0) {
        setExtractError("导入的角色均与现有角色重名,未新增");
        return;
      }
      setExtractStatus(
        `已导入 ${res.added} 个角色卡${res.skipped > 0 ? `(跳过 ${res.skipped} 个重名)` : ""}`
      );
    } catch (e: unknown) {
      setExtractError(errorMessage(e, "导入失败"));
    } finally {
      setExtractBusy(false);
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
          角色设计 <span className="text-muted-foreground">({characters.length})</span>
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
          <p className="mt-2 text-[11px] text-muted-foreground">
            未配置 LLM。点右上角「LLM 设置」接入本地或远端模型后即可使用 AI。
          </p>
        )}
      </div>

      {/* 三通道提取 + 外部导入 */}
      <ExtractToolbar
        channel={extractChannel}
        onChannelChange={setExtractChannel}
        extractLabel="从剧本提取角色"
        onExtract={() => {
          void handleExtract();
        }}
        onImportFile={(file) => {
          void handleImportFile(file);
        }}
        busy={extractBusy}
        busyText="提取中…"
        statusText={extractStatus}
        errorText={extractError}
        extractDisabled={!hasScript}
        extractDisabledReason="未获取到剧本文本(在「剧本」阶段编写后可提取)。仍可用「外部导入」载入角色卡 JSON 或人物清单。"
      />

      {aiError && (
        <p className="rounded-lg bg-red-100 px-3 py-2 text-xs text-red-700">{aiError}</p>
      )}

      {characters.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
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
                  className="text-muted-foreground hover:text-red-500"
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
                <span className="mb-1 block text-xs text-muted-foreground">风格标签</span>
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
                <span className="mb-1 block text-xs text-muted-foreground">艺术风格（Skill）</span>
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
                <p className="mb-1 text-xs font-medium text-muted-foreground">生成提示词预览</p>
                <p className="text-xs leading-relaxed text-ink/80 break-words">
                  {character.positivePrompt || "填写角色信息后自动生成…"}
                </p>
                {character.negativePrompt && (
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground/70 break-words">
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
      <span className="mb-1 block text-xs text-muted-foreground">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-primary"
        placeholder={placeholder}
      />
    </label>
  );
}
