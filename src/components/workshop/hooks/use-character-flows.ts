"use client";

/**
 * CharacterDesigner 的两个分域 sub-hook（§12.13 函数长度：主组件 605 行，
 * 两个动作域各自只依赖注入的事实，与主组件的渲染无共享 state）：
 *
 *   · `useCharacterExtractFlow` —— 三通道提取 + 外部导入（与
 *     `useStoryboardExtractFlow` 同族：会话经 props 注入 / 遗留用法退化
 *     局部会话；工具=确定性解析，本地/API=LLM 流式输出角色卡 JSON）。
 *   · `useCharacterAiFlow` —— 一句话生成（独立模型选择 + 流式进度）与
 *     逐角色 AI 润色（「哪一条在忙」useItemAction /「错误挂那一条」
 *     useItemErrors，规范 16 §16.2.4.40 / §16.2.4.33）。
 *
 * 返回形状与原组件内联实现逐字段一致，视图与测试零感知（§12.18）。
 */
import React from "react";
import { workshopUid } from "~/lib/workshop/script-parser";
import { useBusyAction } from "~/components/ui/use-busy-action";
import { useItemAction } from "~/components/ui/use-item-action";
import { useItemErrors } from "~/components/ui/use-item-errors";
import type { Character, StyleRef } from "~/lib/workshop/types";
import {
  buildCharacterPrompt,
  buildCharacterNegative,
} from "~/lib/workshop/prompt-builder";
import {
  buildExtractCharactersMessages,
  mergeCharacterDrafts,
  parseCharacterEntries,
  parseExtractedCharacters,
  parseImportedCharacterCards,
} from "~/lib/workshop/script-parse";
import type { ParsedCharacterDraft } from "~/lib/workshop/script-parse";
import type { ExtractChannel } from "~/components/workshop/ExtractToolbar";
import { parseChannelOption } from "~/components/workshop/ExtractToolbar";
import {
  useExtractSession,
  type ExtractSession,
  type ExtractSessionActions,
} from "./use-workshop-pipeline";
import { streamChat } from "~/lib/llm/browser";
import {
  buildCharacterMessages,
  buildCharacterFromBriefMessages,
  parseCharacter,
  parseCharacterFull,
} from "~/lib/llm/prompts";
import {
  channelProviderLabel,
  channelSelectionDisplayValue,
  resolveChannelSelection,
} from "~/lib/workshop/channel-options";
import {
  formatRequestMessages,
  makeExtractLog,
} from "~/lib/workshop/extraction-log";
import { errorMessage } from "~/lib/error-message";
import { readFileAsText } from "~/lib/file-io";
import type { LLMConfigView } from "~/lib/llm/types";

/** 判断导入内容是否为 JSON(分镜/角色卡 JSON 走结构化解析,其余按剧本 markdown 解析) */
function looksLikeJson(text: string): boolean {
  return text.startsWith("{") || text.startsWith("[");
}

/** 通道 → LLM provider(工具通道不调用模型;本地/远端复用既有 /api/llm 链路) */
function channelProvider(channel: ExtractChannel): "local" | "remote" {
  return channel === "local" ? "local" : "remote";
}

export function newCharacter(): Character {
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
export function useCharacterExtractFlow(input: {
  characters: Character[];
  styles: StyleRef[];
  onCharactersChange: (list: Character[]) => void;
  scriptMarkdown?: string;
  extract?: { session: ExtractSession; actions: ExtractSessionActions };
  config: LLMConfigView | null;
  openSettings: () => void;
}) {
  const {
    characters,
    styles,
    onCharactersChange,
    scriptMarkdown,
    extract,
    config,
    openSettings,
  } = input;

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

  return {
    extractChannelValue,
    setExtractChannelValue: (value: string) =>
      cacheExtractPatch({ channelValue: value }),
    extractBusy,
    extractStatus,
    extractProgress,
    extractError,
    extractionLog,
    hasScript,
    handleExtract,
    handleImportFile,
  };
}
export function useCharacterAiFlow(input: {
  characters: Character[];
  styles: StyleRef[];
  onCharactersChange: (list: Character[]) => void;
  /** 主组件的既有更新路径：润色结果经它重算提示词。 */
  update: (id: string, patch: Partial<Character>) => void;
  brief: string;
  setBrief: (value: string) => void;
  config: LLMConfigView | null;
  openSettings: () => void;
}) {
  const {
    characters,
    styles,
    onCharactersChange,
    update,
    brief,
    setBrief,
    config,
    openSettings,
  } = input;
  const gen = useBusyAction();
  /* 忙碌位走唯一出口（规范 16 §16.2.4.71）：这段 try/catch/finally 此前把
   * 「置忙 → 生成 → 复位」写了一遍，且复位只在 finally 里落一次。 */
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

  /** 一句话生成实际生效的 provider/model 与下拉展示值：
   * 手动在区块内选择过（genSel 非空）即用它，否则沿用全局 config（换算见 channel-options）。 */
  const genEffective = resolveChannelSelection(genSel, config);
  const genSelectValue = channelSelectionDisplayValue(genSel, config);

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

  return {
    genEffective,
    genSelectValue,
    gen,
    genProgress,
    genStatus,
    genError,
    setGenSel,
    handleAIGenerate,
    handleAICard,
    aiAction,
    aiErrors,
  };
}
