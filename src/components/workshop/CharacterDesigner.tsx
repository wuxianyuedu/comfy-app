"use client";
import React from "react";
import { Trash } from "lucide-react";
import { DarkSelect } from "@/components/studio/ui/DarkSelect";
import { Icon } from "@/components/ui/icon";
import { AttributeMultiSelect } from "@/components/workshop/AttributeMultiSelect";
import {
  CHARACTER_ATTRIBUTES,
  type AttributeOptionSet,
} from "@/lib/workshop/character-options";
import type { Character, StyleRef } from "@/lib/workshop/types";
import {
  buildCharacterPrompt,
  buildCharacterNegative,
} from "@/lib/workshop/prompt-builder";
import { workshopUid } from "@/lib/workshop/script-parser";
import {
  type ExtractChannel,
  ExtractToolbar,
  parseChannelOption,
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
import {
  formatRequestMessages,
  makeExtractLog,
  type ExtractLogEntry,
} from "@/lib/workshop/extraction-log";
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

// ── 会话内「从剧本提取」状态缓存 ────────────────────────────────
// 提取是异步流程；切走页签组件会卸载，但已发起的 async 不中断。仅把状态放在
// 组件局部 state，卸载后即丢失——重挂载时「提取中…」按钮和过程提示都不在了。
// 因此把提取的 通道/忙闲/过程/状态/错误/执行日志 统一做会话级模块缓存：
//   ① 每个 setter 都「先写缓存、再更新 state」；
//   ② 卸载期间后台回调（成功/失败）仍经 setter 把缓存写成正确终态；
//   ③ 重挂载从缓存初始化 → 切回页签看到保留中的「提取中…」与最终结果。
// 日志缓存与对齐仓库既有模块级缓存惯例（见 use-workshop-pipeline 的
// workshopDraftCache / projectsCache）。在把提取逻辑整体收归工坊 controller
// 层之前，以最小改动满足「提取状态跨页签保留」的诉求。
let characterLogCache: ExtractLogEntry[] = [];

/** 角色卡「从剧本提取」的界面状态（执行日志另见 characterLogCache） */
interface CharacterExtractCache {
  channelValue: string;
  busy: boolean;
  status: string;
  progress: string;
  error: string;
}
let characterExtractCache: CharacterExtractCache = {
  channelValue: "tool",
  busy: false,
  status: "",
  progress: "",
  error: "",
};

function newCharacter(): Character {
  return {
    id: workshopUid("char"),
    name: "",
    ageGender: "",
    appearance: "",
    costume: "",
    personality: "",
    temperament: "",
    styleTags: [],
    positivePrompt: "",
    negativePrompt: "",
    params: {},
  };
}
/** 把角色描述字符串拆成下拉选项数组（兼容中/英文逗号、顿号与空白分隔）。
 *  旧项目里保存的角色可能缺新字段（如 temperament），入参按可缺失兜底。 */
function splitAttr(text: string | undefined | null): string[] {
  return (text ?? "")
    .split(/[、,，，\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}
/** 把下拉选项数组合并回角色描述字符串 */
function joinAttr(items: string[]): string {
  return items.join("、");
}

/** 取某属性维度的配置（服装/外貌/性格/气质/风格） */
function attrSet(id: string): AttributeOptionSet {
  return (
    CHARACTER_ATTRIBUTES.find((a) => a.id === id) ?? CHARACTER_ATTRIBUTES[0]!
  );
}

export function CharacterDesigner({
  characters,
  styles,
  onCharactersChange,
  scriptMarkdown,
}: Props) {
  const [brief, setBrief] = React.useState("");
  const [genBusy, setGenBusy] = React.useState(false);
  /** 一句话生成角色：流式原始输出（执行日志） */
  const [genProgress, setGenProgress] = React.useState("");
  /** 一句话生成角色：成功/状态提示 */
  const [genStatus, setGenStatus] = React.useState("");
  /** 一句话生成角色：独立错误信息（不与 AI 润色混用） */
  const [genError, setGenError] = React.useState("");
  const [aiBusyId, setAiBusyId] = React.useState<string | null>(null);
  const [aiError, setAiError] = React.useState("");
  const { config, openSettings } = useLLM();

  // ── 三通道提取(工具 / 本地模型 / 远端API)+ 外部导入 ──
  // 下拉选项值（tool | local::<model> | remote::<model>），通道与模型一并保存。
  // 通道/忙闲/过程/状态/错误都从模块缓存初始化，setter 均「写缓存后再 setState」，
  // 保证切页签卸载期间后台回调仍能写回缓存（见顶部 CharacterExtractCache 说明）。
  const [extractChannelValue, setExtractChannelValueState] = React.useState(
    () => characterExtractCache.channelValue,
  );
  const extractChannel = parseChannelOption(extractChannelValue).channel;
  const [extractBusy, setExtractBusyState] = React.useState(
    () => characterExtractCache.busy,
  );
  const [extractStatus, setExtractStatusState] = React.useState(
    () => characterExtractCache.status,
  );
  /** 模型通道的实时提取过程（流式 token 累积） */
  const [extractProgress, setExtractProgressState] = React.useState(
    () => characterExtractCache.progress,
  );
  const [extractError, setExtractErrorState] = React.useState(
    () => characterExtractCache.error,
  );
  /** 本次提取的结构化执行日志（输入/输出/结果/错误），跑完不清空。
   *  setExtractionLog 包装器在更新 React state 时同步写模块缓存，
   *  切页签卸载再挂载仍能恢复历史（对齐仓库模块级缓存惯例）。 */
  const [extractionLog, setExtractionLogState] = React.useState<
    ExtractLogEntry[]
  >(() => characterLogCache);
  const setExtractionLog = React.useCallback(
    (updater: React.SetStateAction<ExtractLogEntry[]>) => {
      // 同步写缓存再 setState，与提取字段缓存一致：卸载期间后台写日志也生效。
      const next =
        typeof updater === "function"
          ? updater(characterLogCache)
          : updater;
      characterLogCache = next;
      setExtractionLogState(next);
    },
    [],
  );

  // 提取字段的会话缓存 setter：以缓存对象为准算 next 并同步写缓存后再 setState。
  // 组件卸载后 React 不再派发 state updater，只有同步写缓存才能让仍在后台的
  // async 把正确终态(完成/失败/累积过程)留到下次挂载。
  const cacheChannelValue = React.useCallback(
    (value: React.SetStateAction<string>) => {
      const next =
        typeof value === "function"
          ? value(characterExtractCache.channelValue)
          : value;
      characterExtractCache = { ...characterExtractCache, channelValue: next };
      setExtractChannelValueState(next);
    },
    [],
  );
  const cacheBusy = React.useCallback((value: boolean) => {
    characterExtractCache = { ...characterExtractCache, busy: value };
    setExtractBusyState(value);
  }, []);
  const cacheStatus = React.useCallback(
    (value: React.SetStateAction<string>) => {
      const next =
        typeof value === "function"
          ? value(characterExtractCache.status)
          : value;
      characterExtractCache = { ...characterExtractCache, status: next };
      setExtractStatusState(next);
    },
    [],
  );
  const cacheProgress = React.useCallback(
    (value: React.SetStateAction<string>) => {
      const next =
        typeof value === "function"
          ? value(characterExtractCache.progress)
          : value;
      characterExtractCache = { ...characterExtractCache, progress: next };
      setExtractProgressState(next);
    },
    [],
  );
  const cacheError = React.useCallback(
    (value: React.SetStateAction<string>) => {
      const next =
        typeof value === "function"
          ? value(characterExtractCache.error)
          : value;
      characterExtractCache = { ...characterExtractCache, error: next };
      setExtractErrorState(next);
    },
    [],
  );

  const hasScript = !!scriptMarkdown?.trim();

  /** 通道 → LLM provider(工具通道不调用模型;本地/远端复用既有 /api/llm 链路) */
  function channelProvider(channel: ExtractChannel): "local" | "remote" {
    return channel === "local" ? "local" : "remote";
  }

  function update(id: string, patch: Partial<Character>) {
    onCharactersChange(
      characters.map((character) => {
        if (character.id !== id) return character;
        const next = { ...character, ...patch };
        // Recompute prompts
        const style = styles.find((style) => style.slug === next.skillSlug);
        next.positivePrompt = buildCharacterPrompt(next, style);
        next.negativePrompt = buildCharacterNegative(next, style);
        if (style?.defaultParams) next.params = { ...style.defaultParams };
        return next;
      }),
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
    setGenProgress("");
    setGenStatus("");
    setGenError("");
    const modelLabel =
      config.provider === "local" ? "本地" : "远端";
    try {
      const full = await streamChat({
        messages: buildCharacterFromBriefMessages(brief),
        onToken: (token) => setGenProgress((prev) => prev + token),
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
      setGenStatus(
        `已用 ${modelLabel} · ${config.model} 生成角色「${r.name}」`,
      );
    } catch (e: unknown) {
      setGenError(errorMessage(e, "AI 生成失败"));
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
      cacheError("未获取到剧本文本,请先在「剧本」阶段编写或编辑剧本");
      return;
    }
    if (extractChannel !== "tool" && !config) {
      openSettings();
      return;
    }
    cacheBusy(true);
    cacheProgress("");
    cacheStatus(
      extractChannel === "tool" ? "" : "正在调用模型提取角色卡…",
    );
    cacheError("");
    // 新一次提取：重置日志为仅含 init 一条（上次执行记录随组件保留在面板里，
    // 此处只清空面板以展示本次的输入→输出→结果链路）。
    characterLogCache = [
      makeExtractLog(
        "init",
        `使用 ${extractChannel === "tool" ? "内置规则" : extractChannel === "local" ? "本地模型" : "远端模型"} ${extractChannel === "tool" ? "" : parseChannelOption(extractChannelValue).model || ""}从剧本提取角色`,
      ),
    ];
    setExtractionLogState(characterLogCache);
    try {
      let drafts: ParsedCharacterDraft[];
      if (extractChannel === "tool") {
        drafts = parseCharacterEntries(script);
        if (drafts.length === 0) {
          cacheError(
            "工具通道未在剧本中找到「人物:/角色:」行。可检查剧本结构后重试,或切换到本地模型 / 配置API 通道。",
          );
          return;
        }
      } else {
        const requestMessages = buildExtractCharactersMessages(script);
        setExtractionLog((prev) => [
          ...prev,
          makeExtractLog(
            "request",
            `向模型发送请求（provider=${channelProvider(extractChannel)}, model=${parseChannelOption(extractChannelValue).model || "默认"}）`,
            formatRequestMessages(requestMessages),
          ),
        ]);
        const full = await streamChat({
          messages: requestMessages,
          opts: {
            provider: channelProvider(extractChannel),
            model: parseChannelOption(extractChannelValue).model,
          },
          onToken: (token) => cacheProgress((prev) => prev + token),
        });
        setExtractionLog((prev) => [
          ...prev,
          makeExtractLog("output", "模型返回完成，正在解析…", full),
        ]);
        drafts = parseExtractedCharacters(full);
        if (drafts.length === 0) {
          setExtractionLog((prev) => [
            ...prev,
            makeExtractLog("error", "模型未返回有效角色卡 JSON，解析失败"),
          ]);
          cacheError(
            "模型未返回有效角色卡 JSON,解析失败。可重试,或改用「工具」通道。",
          );
          return;
        }
      }
      const res = mergeCharacterDrafts(characters, drafts, styles);
      setExtractionLog((prev) => [
        ...prev,
        res.added === 0 && res.skipped > 0
          ? makeExtractLog("skipped", "剧本中的角色均已存在，未新增角色卡")
          : makeExtractLog(
              "result",
              `已提取 ${res.added} 个角色卡${res.skipped > 0 ? `(跳过 ${res.skipped} 个重名)` : ""}`,
            ),
      ]);
      if (res.added === 0 && res.skipped > 0) {
        cacheError("剧本中的角色均已存在,未新增角色卡");
        return;
      }
      cacheStatus(
        `已提取 ${res.added} 个角色卡${res.skipped > 0 ? `(跳过 ${res.skipped} 个重名)` : ""}`,
      );
    } catch (e: unknown) {
      setExtractionLog((prev) => [
        ...prev,
        makeExtractLog("error", errorMessage(e, "提取失败")),
      ]);
      cacheError(
        `${errorMessage(e, "提取失败")} 可重试,或改用「工具」通道。`,
      );
    } finally {
      cacheBusy(false);
    }
  }

  /** 外部导入:角色卡 JSON 按既有 Character 字段解析;markdown 走工具解析器 */
  async function handleImportFile(file: File) {
    cacheBusy(true);
    cacheStatus("");
    cacheError("");
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
        cacheError("导入的角色均与现有角色重名,未新增");
        return;
      }
      cacheStatus(
        `已导入 ${res.added} 个角色卡${res.skipped > 0 ? `(跳过 ${res.skipped} 个重名)` : ""}`,
      );
    } catch (e: unknown) {
      cacheError(errorMessage(e, "导入失败"));
    } finally {
      cacheBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="u-title">
          角色设计{" "}
          <span className="text-muted-foreground">({characters.length})</span>
        </h3>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={add}
            className="border-border text-primary hover:bg-subtle rounded-lg border px-3 py-1.5 text-xs"
          >
            + 新建角色
          </button>
        </div>
      </div>

      {/* 用一句话生成角色：独立区块 + 独立执行日志 */}
      <div className="border-primary-soft bg-primary-soft/30 rounded-xl border p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-primary flex items-center text-xs font-medium">
            <Icon
              name="sparkles"
              size={13}
              className="mr-1 inline align-[-2px]"
            />
            用一句话生成角色
          </p>
          {config && (
            <span
              className="text-muted-foreground text-[11px]"
              title="AI 生成使用当前生效的 LLM 配置"
            >
              当前：{config.provider === "local" ? "本地" : "远端"} ·{" "}
              {config.model || "未选模型"}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <input
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !genBusy) void handleAIGenerate();
            }}
            placeholder="例如：一位穿唐装的白发剑客，气质孤傲"
            className="border-border bg-bg focus:border-primary flex-1 rounded-lg border px-3 py-2 text-sm outline-none"
          />
          <button
            type="button"
            onClick={handleAIGenerate}
            disabled={!brief.trim() || genBusy}
            className="bg-primary rounded-lg px-3 py-2 text-xs font-medium text-white transition-opacity disabled:opacity-40"
          >
            {genBusy ? "生成中…" : "AI 生成"}
          </button>
        </div>
        {!config && (
          <p className="text-muted-foreground mt-2 text-[11px]">
            未配置 LLM。点右上角「LLM 设置」接入本地或远端模型后即可使用 AI。
          </p>
        )}
        {/* 一句话生成角色的执行日志（模型调用过程/原文/成功/失败，独立展示不与提取区混杂） */}
        {(genBusy || genProgress || genStatus || genError) && (
          <div className="mt-2">
            {genBusy && (
              <p className="text-xs text-primary">
                {genProgress
                  ? "正在生成角色…"
                  : `正在调用 ${config?.provider === "local" ? "本地" : "远端"} · ${
                      config?.model ?? "当前配置"
                    } 生成角色…`}
              </p>
            )}
            {genBusy && genProgress && (
              <details className="rounded-lg bg-bg/60 px-3 py-2" open>
                <summary className="cursor-pointer select-none text-[11px] text-primary">
                  生成过程
                </summary>
                <pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap break-all text-[11px] leading-relaxed text-muted-foreground">
                  {genProgress}
                </pre>
              </details>
            )}
            {genStatus && !genError && (
              <p className="mt-1 text-xs text-primary">{genStatus}</p>
            )}
            {genError && (
              <p className="mt-1 rounded-lg bg-red-100 px-3 py-2 text-xs text-red-700">
                {genError}
              </p>
            )}
          </div>
        )}
      </div>

      {/* 从剧本提取角色：独立区块，分组下拉（工具/本地/远端）+ 提取 */}
      <ExtractToolbar
        title="从剧本提取角色"
        channelValue={extractChannelValue}
        onChannelValueChange={cacheChannelValue}
        onExtract={() => {
          void handleExtract();
        }}
        onImportFile={(file) => {
          void handleImportFile(file);
        }}
        busy={extractBusy}
        progressText={extractProgress}
        statusText={extractStatus}
        errorText={extractError}
        executionLog={extractionLog}
        extractDisabled={!hasScript}
        extractDisabledReason="未获取到剧本文本(在「剧本」阶段编写后可提取)。仍可用「外部导入」载入角色卡 JSON 或人物清单。"
      />

      {/* AI 润色失败提示：放在角色列表上方，与一句话生成区错误分离 */}
      {aiError && (
        <p className="rounded-lg bg-red-100 px-3 py-2 text-xs text-red-700">
          {aiError}
        </p>
      )}

      {characters.length === 0 ? (
        <div className="border-border text-muted-foreground rounded-xl border border-dashed py-10 text-center text-sm">
          还没有角色。添加角色后会自动生成可送入生图的提示词。
        </div>
      ) : (
        <div className="space-y-3">
          {characters.map((character, i) => (
            <div
              key={character.id}
              className="border-border bg-surface rounded-xl border p-4"
            >
              <div className="mb-3 flex items-center gap-2">
                <span className="bg-primary-soft text-primary grid h-6 w-6 place-items-center rounded-full text-xs font-semibold">
                  {i + 1}
                </span>
                <input
                  value={character.name}
                  onChange={(event) =>
                    update(character.id, { name: event.target.value })
                  }
                  className="text-ink hover:border-border focus:border-primary flex-1 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium outline-none"
                  placeholder="角色名"
                />
                <button
                  type="button"
                  onClick={() => handleAICard(character)}
                  disabled={aiBusyId === character.id || genBusy}
                  className="border-primary-soft text-primary hover:bg-primary-soft rounded-md border px-2 py-1 text-xs transition-colors disabled:opacity-40"
                  title="用 LLM 补全外貌/服装/性格"
                >
                  {aiBusyId === character.id ? (
                    "…"
                  ) : (
                    <>
                      <Icon
                        name="sparkles"
                        size={12}
                        className="mr-1 inline align-[-2px]"
                      />
                      AI 润色
                    </>
                  )}
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

              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="年龄/性别"
                  value={character.ageGender}
                  onChange={(value) =>
                    update(character.id, { ageGender: value })
                  }
                  placeholder="25岁 女性"
                />

                {/* 服装 / 外貌特征 / 性格 / 气质 / 风格 —— 穷举式多选下拉 */}
                <AttributeMultiSelect
                  label={attrSet("costume").label}
                  groups={attrSet("costume").groups}
                  value={splitAttr(character.costume)}
                  onChange={(items) =>
                    update(character.id, { costume: joinAttr(items) })
                  }
                  placeholder="如：唐装、风衣…"
                />
                <AttributeMultiSelect
                  label={attrSet("appearance").label}
                  groups={attrSet("appearance").groups}
                  value={splitAttr(character.appearance)}
                  onChange={(items) =>
                    update(character.id, { appearance: joinAttr(items) })
                  }
                  placeholder="如：短发、双眼皮…"
                />
                <AttributeMultiSelect
                  label={attrSet("personality").label}
                  groups={attrSet("personality").groups}
                  value={splitAttr(character.personality)}
                  onChange={(items) =>
                    update(character.id, { personality: joinAttr(items) })
                  }
                  placeholder="如：冷静、开朗…"
                />
                <AttributeMultiSelect
                  label={attrSet("temperament").label}
                  groups={attrSet("temperament").groups}
                  value={splitAttr(character.temperament)}
                  onChange={(items) =>
                    update(character.id, { temperament: joinAttr(items) })
                  }
                  placeholder="如：清冷孤傲、知性…"
                />
                <AttributeMultiSelect
                  label={attrSet("styleTags").label}
                  groups={attrSet("styleTags").groups}
                  value={character.styleTags ?? []}
                  onChange={(items) =>
                    update(character.id, { styleTags: items })
                  }
                  placeholder="如：厚涂、国风…"
                />
              </div>

              {/* Linked style skill */}
              <div className="mt-2">
                <span className="text-muted-foreground mb-1 block text-xs">
                  艺术风格（Skill）
                </span>
                <DarkSelect
                  className="!border-(--color-border) !bg-(--color-subtle) text-sm"
                  value={character.skillSlug ?? ""}
                  onChange={(value) =>
                    update(character.id, { skillSlug: value || undefined })
                  }
                  options={styles.map((style) => style.slug)}
                  labels={Object.fromEntries(
                    styles.map((style) => [
                      style.slug,
                      `${style.icon} ${style.name}`,
                    ]),
                  )}
                  placeholder="不指定（使用风格标签）"
                />
              </div>

              {/* Generated prompt preview */}
              <div className="bg-subtle mt-3 rounded-lg p-3">
                <p className="text-muted-foreground mb-1 text-xs font-medium">
                  生成提示词预览
                </p>
                <p className="text-ink/80 text-xs leading-relaxed break-words">
                  {character.positivePrompt || "填写角色信息后自动生成…"}
                </p>
                {character.negativePrompt && (
                  <p className="text-muted-foreground/70 mt-2 text-xs leading-relaxed break-words">
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
      <span className="text-muted-foreground mb-1 block text-xs">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="border-border bg-bg focus:border-primary w-full rounded-md border px-2 py-1.5 text-xs outline-none"
        placeholder={placeholder}
      />
    </label>
  );
}
