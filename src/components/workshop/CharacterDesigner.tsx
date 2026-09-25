"use client";
import React from "react";
import { textHandler } from "~/lib/form-props";
import { Trash } from "lucide-react";
import { SelectMenu } from "~/components/ui/select-menu";
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import { useBusyAction } from "~/components/ui/use-busy-action";
import { FormField } from "~/components/ui/form-field";
import { Disclosure } from "~/components/ui/disclosure";
import { AttributeMultiSelect } from "~/components/workshop/AttributeMultiSelect";
import {
  CHARACTER_ATTRIBUTES,
  type AttributeOptionSet,
} from "~/lib/workshop/character-options";
import type { Character, StyleRef } from "~/lib/workshop/types";
import {
  buildCharacterPrompt,
  buildCharacterNegative,
} from "~/lib/workshop/prompt-builder";
import { workshopUid } from "~/lib/workshop/script-parser";
import {
  type ExtractChannel,
  ExtractToolbar,
  parseChannelOption,
} from "~/components/workshop/ExtractToolbar";
import { ExtractModelSelect } from "~/components/workshop/ExtractModelSelect";
import {
  CharacterPortraitStudio,
  type CharacterPortraitContext,
} from "~/components/workshop/CharacterPortraitStudio";
import { CharacterReviewButton } from "~/components/workshop/CharacterReviewButton";
import {
  channelProviderLabel,
  channelSelectionDisplayValue,
  resolveChannelSelection,
} from "~/lib/workshop/channel-options";
import {
  buildExtractCharactersMessages,
  mergeCharacterDrafts,
  parseCharacterEntries,
  parseExtractedCharacters,
  parseImportedCharacterCards,
} from "~/lib/workshop/script-parse";
import type { ParsedCharacterDraft } from "~/lib/workshop/script-parse";
import { errorMessage } from "~/lib/error-message";
import { readFileAsText } from "~/lib/file-io";
import { useLLM } from "~/components/workshop/LLMContext";
import { enterCommit } from "~/components/ui/use-enter-commit";
import {
  useExtractSession,
  type ExtractSession,
  type ExtractSessionActions,
} from "./hooks/use-workshop-pipeline";
import {
  formatRequestMessages,
  makeExtractLog,
} from "~/lib/workshop/extraction-log";
import { streamChat } from "~/lib/llm/browser";
import { useItemErrors } from "~/components/ui/use-item-errors";
import { useItemAction } from "~/components/ui/use-item-action";
import {
  buildCharacterMessages,
  buildCharacterFromBriefMessages,
  parseCharacter,
  parseCharacterFull,
} from "~/lib/llm/prompts";

interface Props {
  characters: Character[];
  styles: StyleRef[]; // available Skill styles
  onCharactersChange: (c: Character[]) => void;
  /** 工坊流水线的剧本 markdown(既有状态,经 props 传入,不改变数据归属) */
  scriptMarkdown?: string;
  /** 提取会话（busy/progress/日志）已收归工坊 controller，经 props 注入；
   * 未注入（遗留/独立使用场景）时退化为本组件内的局部会话。 */
  extract?: { session: ExtractSession; actions: ExtractSessionActions };
  /** 定妆照会话与生成通道配置（同样收归 controller，经 props 注入）。
   * 未注入时不渲染定妆照区块，遗留/独立使用场景不受影响。 */
  portrait?: CharacterPortraitContext;
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
    temperament: "",
    styleTags: [],
    positivePrompt: "",
    negativePrompt: "",
    params: {},
  };
}
/** 把角色描述字符串拆成下拉选项数组（兼容中/英文逗号、顿号与空白分隔）。
 * 旧项目里保存的角色可能缺新字段（如 temperament），入参按可缺失兜底。 */
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
  extract,
  portrait,
}: Props) {
  const [brief, setBrief] = React.useState("");
  /* 忙碌位走唯一出口（规范 16 §16.2.4.71）：这段 try/catch/finally 此前把
   * 「置忙 → 生成 → 复位」写了一遍，且复位只在 finally 里落一次。 */
  const gen = useBusyAction();
  /** 一句话生成角色：流式原始输出（执行日志） */
  const [genProgress, setGenProgress] = React.useState("");
  /** 一句话生成角色：成功/状态提示 */
  const [genStatus, setGenStatus] = React.useState("");
  /** 一句话生成角色：独立错误信息（不与 AI 润色混用） */
  const [genError, setGenError] = React.useState("");
  /** 一句话生成角色：独立选择的 本地/远端模型（<下拉值> 为"local::<m>" 或"remote::<m>"；
   * 空串 = 未手动选择，沿用全局 config 的 provider/model）。 */
  const [genSel, setGenSel] = React.useState("");
  /* 「哪一条在润色」收在`useItemAction`（规范 16 §16.2.4.40）：此前是本
   * 组件自持的`useState<string | null>`，与历史列表的重试、分镜的润色各写
   * 一份 —— 「同一条能不能重复点」三处都没防。 */
  const aiAction = useItemAction(characters.map((character) => character.id));
  /* 逐条润色的错误挂在**那个角色**上（规范 16 §16.2.4.33）：收口前是一句
   *`useState("")` —— 润色角色 A 失败后去润色角色 B，A 的提示就被盖掉。
   * 忙碌位是单值是对的（同一时刻只有一条在忙），那是 P14/P15 那些忙碌位
   * 选择器的形态，不是错误位。 */
  const aiErrors = useItemErrors(characters.map((character) => character.id));
  const { config, openSettings } = useLLM();

  /** 一句话生成实际生效的 provider/model 与下拉展示值：
   * 手动在区块内选择过（genSel 非空）即用它，否则沿用全局 config（换算见 channel-options）。 */
  const genEffective = resolveChannelSelection(genSel, config);
  const genSelectValue = channelSelectionDisplayValue(genSel, config);

  // ── 三通道提取(工具 / 本地模型 / 远端API)+ 外部导入 ──
  // 提取的 通道/忙闲/过程/状态/错误/执行日志 已收归工坊 controller（characterExtract）
  // 并经 props.extract 注入：展示读 session，流程里写入走 actions。
  // controller 跨阶段页签常驻，提取中切页签再切回状态不丢，无需模块级缓存。
  // 遗留/独立使用（未注入 extract prop）时，退化为本组件局部会话。
  const localExtract = useExtractSession("tool", "character");
  const { session: extractSession, actions: extractActions } = extract ?? {
    session: localExtract[0],
    actions: localExtract[1],
  };
  const {
    channelValue: extractChannelValue,
    busy: extractBusy,
    status: extractStatus,
    progress: extractProgress,
    error: extractError,
    log: extractionLog,
  } = extractSession;
  const extractChannel = parseChannelOption(extractChannelValue).channel;
  const {
    patch: cacheExtractPatch,
    appendProgress,
    appendLog,
    setLog,
  } = extractActions;

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
    // 一句话生成可独立于全局配置选 本地/远端 模型：genSel 为空则沿用全局 config。
    const provider = genEffective.provider;
    const model = genEffective.model;
    setGenProgress("");
    setGenStatus("");
    setGenError("");
    const modelLabel = channelProviderLabel(provider);
    try {
      const full = await gen.run(() =>
        streamChat({
          messages: buildCharacterFromBriefMessages(brief),
          // 显式 provider+model：命中所选模型独立连接参数时改走该参数（与「从剧本提取」一致）
          opts: model ? { provider, model } : undefined,
          onToken: (token) => setGenProgress((prev) => prev + token),
        }),
      );
      const r = parseCharacterFull(full);
      const character = newCharacter();
      character.name = r.name;
      character.appearance = r.appearance;
      character.costume = r.costume;
      character.personality = r.personality;
      // 经既有的更新路径重算提示词
      const style = styles[0];
      character.positivePrompt = buildCharacterPrompt(character, style);
      character.negativePrompt = buildCharacterNegative(character, style);
      onCharactersChange([...characters, character]);
      setBrief("");
      setGenStatus(`已用 ${modelLabel} · ${model} 生成角色「${r.name}」`);
    } catch (e: unknown) {
      setGenError(errorMessage(e, "AI 生成失败"));
    }
  }

  async function handleAICard(character: Character) {
    if (!config) {
      openSettings();
      return;
    }
    if (!character.name.trim()) {
      aiErrors.report(character.id)("err", "请先填写角色名再使用 AI 润色");
      return;
    }
    await aiAction.run(character.id, async () => {
      aiErrors.clear(character.id);
      try {
        const style = styles.find(
          (style) => style.slug === character.skillSlug,
        );
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
        aiErrors.report(character.id)("err", errorMessage(e, "AI 润色失败"));
      }
      /* 忙标记由出口的`finally` 清。 */
    });
  }

  /** 三通道提取入口:工具=确定性解析;本地/API=LLM 输出 JSON,失败降级提示 */
  async function handleExtract() {
    const script = (scriptMarkdown ?? "").trim();
    if (!script) {
      cacheExtractPatch({
        error: "未获取到剧本文本,请先在「剧本」阶段编写或编辑剧本",
      });
      return;
    }
    if (extractChannel !== "tool" && !config) {
      openSettings();
      return;
    }
    cacheExtractPatch({
      busy: true,
      progress: "",
      status: extractChannel === "tool" ? "" : "正在调用模型提取角色卡…",
      error: "",
    });
    // 新一次提取：重置日志为仅含 init 一条（上次执行记录随组件保留在面板里，
    // 此处只清空面板以展示本次的输入→输出→结果链路）。
    setLog([
      makeExtractLog(
        "init",
        `使用 ${extractChannel === "tool" ? "内置规则" : extractChannel === "local" ? "本地模型" : "远端模型"} ${extractChannel === "tool" ? "" : parseChannelOption(extractChannelValue).model || ""}从剧本提取角色`,
      ),
    ]);
    try {
      let drafts: ParsedCharacterDraft[];
      if (extractChannel === "tool") {
        drafts = parseCharacterEntries(script);
        if (drafts.length === 0) {
          cacheExtractPatch({
            error:
              "工具通道未在剧本中找到「人物:/角色:」行。可检查剧本结构后重试,或切换到本地模型 / 配置API 通道。",
          });
          return;
        }
      } else {
        const requestMessages = buildExtractCharactersMessages(script);
        appendLog(
          makeExtractLog(
            "request",
            `向模型发送请求（provider=${channelProvider(extractChannel)}, model=${parseChannelOption(extractChannelValue).model || "默认"}）`,
            formatRequestMessages(requestMessages),
          ),
        );
        const full = await streamChat({
          messages: requestMessages,
          opts: {
            provider: channelProvider(extractChannel),
            model: parseChannelOption(extractChannelValue).model,
          },
          onToken: (token) => appendProgress(token),
        });
        appendLog(makeExtractLog("output", "模型返回完成，正在解析…", full));
        drafts = parseExtractedCharacters(full);
        if (drafts.length === 0) {
          appendLog(
            makeExtractLog("error", "模型未返回有效角色卡 JSON，解析失败"),
          );
          cacheExtractPatch({
            error:
              "模型未返回有效角色卡 JSON,解析失败。可重试,或改用「工具」通道。",
          });
          return;
        }
      }
      const res = mergeCharacterDrafts(characters, drafts, styles);
      appendLog(
        res.added === 0 && res.skipped > 0
          ? makeExtractLog("skipped", "剧本中的角色均已存在，未新增角色卡")
          : makeExtractLog(
              "result",
              `已提取 ${res.added} 个角色卡${res.skipped > 0 ? `(跳过 ${res.skipped} 个重名)` : ""}`,
            ),
      );
      if (res.added === 0 && res.skipped > 0) {
        cacheExtractPatch({ error: "剧本中的角色均已存在,未新增角色卡" });
        return;
      }
      // 把并入后的角色列表回写到父级（controller）状态，否则列表不刷新、提取结果只留在日志里
      onCharactersChange(res.list);
      cacheExtractPatch({
        status: `已提取 ${res.added} 个角色卡${res.skipped > 0 ? `(跳过 ${res.skipped} 个重名)` : ""}`,
      });
    } catch (e: unknown) {
      appendLog(makeExtractLog("error", errorMessage(e, "提取失败")));
      cacheExtractPatch({
        error: `${errorMessage(e, "提取失败")} 可重试,或改用「工具」通道。`,
      });
    } finally {
      cacheExtractPatch({ busy: false });
    }
  }

  /** 外部导入:角色卡 JSON 按既有 Character 字段解析;markdown 走工具解析器 */
  async function handleImportFile(file: File) {
    cacheExtractPatch({ busy: true, status: "", error: "" });
    try {
      /* 读取收在唯一出口里（§16.2.4.27）—— 此前两处各写一遍`file.text()`，
       * 而「读失败」与「文件为空」在它们那里压成同一个结果。 */
      const text = await readFileAsText(file);
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
        cacheExtractPatch({ error: "导入的角色均与现有角色重名,未新增" });
        return;
      }
      // 把并入后的角色列表回写到父级（controller）状态，否则导入后列表不刷新
      onCharactersChange(res.list);
      cacheExtractPatch({
        status: `已导入 ${res.added} 个角色卡${res.skipped > 0 ? `(跳过 ${res.skipped} 个重名)` : ""}`,
      });
    } catch (e: unknown) {
      cacheExtractPatch({ error: errorMessage(e, "导入失败") });
    } finally {
      cacheExtractPatch({ busy: false });
    }
  }

  return (
    <div className="flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="u-title">
          角色设计{""}
          <span className="text-muted-foreground">({characters.length})</span>
        </h3>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="xs"
            onClick={add}
            className="border-border text-primary hover:bg-subtle h-auto rounded-lg px-3 py-1.5"
          >
            + 新建角色
          </Button>
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
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExtractModelSelect
            value={genSelectValue}
            onChange={setGenSel}
            allowTool={false}
          />
          <input
            value={brief}
            onChange={textHandler(setBrief)}
            /* Enter 触发 AI 生成（Shift+Enter 不触发）；生成中不响应。 */
            {...enterCommit({
              onCommit: () => {
                if (!gen.busy) void handleAIGenerate();
              },
              excludeShift: true,
            })}
            placeholder="例如：一位穿唐装的白发剑客，气质孤傲"
            className="border-border bg-bg focus:border-primary flex-1 rounded-lg border px-3 py-2 text-sm outline-none"
          />
          <Button
            variant="primary-solid"
            size="xs"
            onClick={handleAIGenerate}
            disabled={!brief.trim() || gen.busy}
            className="h-auto rounded-lg px-3 py-2"
          >
            {gen.busy ? "生成中…" : "AI 生成"}
          </Button>
        </div>
        {config && !genSel && (
          <p className="text-muted-foreground mt-2 text-[11px]">
            未手动选择模型时，沿用全局配置（当前：
            {channelProviderLabel(config.provider)} ·{""}
            {config.model || "未选模型"}）。点下拉可切换本次生成的 本地/远端
            模型。
          </p>
        )}
        {!config && (
          <p className="text-muted-foreground mt-2 text-[11px]">
            未配置 LLM。点右上角「LLM 设置」接入本地或远端模型后即可使用 AI。
          </p>
        )}
        {/* 一句话生成角色的执行日志（模型调用过程/原文/成功/失败，独立展示不与提取区混杂） */}
        {(gen.busy || genProgress || genStatus || genError) && (
          <div className="mt-2">
            {gen.busy && (
              <p className="text-primary text-xs">
                {genProgress
                  ? "正在生成角色…"
                  : `正在调用 ${channelProviderLabel(genEffective.provider)} · ${
                      genEffective.model || "当前配置"
                    } 生成角色…`}
              </p>
            )}
            {gen.busy && genProgress && (
              <Disclosure
                defaultOpen
                marker="caret"
                className="text-primary bg-bg/60 rounded-lg px-3 py-2 text-[11px]"
                trigger="生成过程"
              >
                <pre className="text-muted-foreground mt-1 max-h-40 overflow-y-auto text-[11px] leading-relaxed break-all whitespace-pre-wrap">
                  {genProgress}
                </pre>
              </Disclosure>
            )}
            {genStatus && !genError && (
              <p className="text-primary mt-1 text-xs">{genStatus}</p>
            )}
            {genError && (
              <p className="bg-destructive/10 text-destructive mt-1 rounded-lg px-3 py-2 text-xs">
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
        onChannelValueChange={(value) =>
          cacheExtractPatch({ channelValue: value })
        }
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
        logStage="character"
        extractDisabled={!hasScript}
        extractDisabledReason="未获取到剧本文本(在「剧本」阶段编写后可提取)。仍可用「外部导入」载入角色卡 JSON 或人物清单。"
      />

      {characters.length === 0 ? (
        <div className="border-border text-muted-foreground rounded-xl border border-dashed py-10 text-center text-sm">
          还没有角色。添加角色后会自动生成可送入生图的提示词。
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {characters.map((character, i) => (
            <div
              key={character.id}
              className="border-border bg-surface rounded-xl border p-4"
            >
              <div className="mb-3 flex items-center gap-2">
                <span className="bg-primary-soft text-primary grid size-6 place-items-center rounded-full text-xs font-semibold">
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
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => handleAICard(character)}
                  disabled={aiAction.isBusy(character.id) || gen.busy}
                  className="border-primary-soft text-primary hover:bg-primary-soft h-auto rounded-md px-2 py-1"
                  title="用 LLM 补全外貌/服装/性格"
                >
                  {aiAction.isBusy(character.id) ? (
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
                </Button>
                <CharacterReviewButton character={character} />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => remove(character.id)}
                  className="text-muted-foreground hover:text-danger-strong"
                  aria-label="删除角色"
                >
                  <Trash size={16} />
                </Button>
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

              {/* 关联的风格技能 */}
              <div className="mt-2">
                <span className="text-muted-foreground mb-1 block text-xs">
                  艺术风格（Skill）
                </span>
                <SelectMenu
                  className="!border-border !bg-subtle text-sm"
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

              {/* 生成出的提示词预览 */}
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

              {/* 定妆照：按上方提示词生成 / 导入，多次结果留作候选供挑选 */}
              {portrait && (
                <CharacterPortraitStudio
                  character={character}
                  portrait={portrait}
                />
              )}
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
    <FormField
      label={label}
      labelClassName="text-muted-foreground mb-1 text-xs"
    >
      {(a11y) => (
        <input
          {...a11y}
          value={value}
          onChange={textHandler(onChange)}
          className="border-border bg-bg focus:border-primary w-full rounded-md border px-2 py-1.5 text-xs outline-none"
          placeholder={placeholder}
        />
      )}
    </FormField>
  );
}
