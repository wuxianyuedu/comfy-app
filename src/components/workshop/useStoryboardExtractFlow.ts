"use client";

/**
 * StoryboardPlanner 的「三通道提取 + 外部导入」分域 sub-hook
 * （`useStoryboardPlanner` 的拆分件）。
 *
 * 收口：提取会话的接线（controller 经 props 注入 / 遗留用法退化局部会话）、
 * `handleExtract`（工具=确定性拆分；本地/API=LLM 流式输出 JSON，失败降级提示）、
 * `handleImportFile`（分镜 markdown 走工具解析器；JSON 支持分镜数组与角色卡）、
 * 以及把条目落成既有 Shot 结构的 `appendShots`。
 *
 * 只依赖注入的事实：`shots / scenes / characters / styles`（落库与重算）、
 * `onShotsChange / onCharactersChange`（写回）、`scriptMarkdown`（提取源）、
 * `config / openSettings`（LLM 配置未就绪时的引导）——不碰主钩的其它动作。
 * 返回形状与主钩原 controller 逐字段一致（§12.18 复用优先）。
 */
import type { Character, Scene, Shot, StyleRef } from "~/lib/workshop/types";
import {
  buildExtractShotsMessages,
  buildShotsFromEntries,
  draftToShotEntry,
  mergeCharacterDrafts,
  parseExtractedShots,
  parseImportedCharacterCards,
  parseShotDrafts,
} from "~/lib/workshop/script-parse";
import type { ShotEntry } from "~/lib/workshop/script-parse";
import type { ExtractChannel } from "~/components/workshop/ExtractToolbar";
import { parseChannelOption } from "~/components/workshop/ExtractToolbar";
import {
  useExtractSession,
  type ExtractSession,
  type ExtractSessionActions,
} from "~/components/workshop/hooks/use-workshop-pipeline";
import { streamChat } from "~/lib/llm/browser";
import type { LLMConfigView } from "~/lib/llm/types";
import {
  formatRequestMessages,
  makeExtractLog,
} from "~/lib/workshop/extraction-log";
import { errorMessage } from "~/lib/error-message";
import { readFileAsText } from "~/lib/file-io";

/** 判断导入内容是否为 JSON(分镜/角色卡 JSON 走结构化解析,其余按剧本 markdown 解析) */
function looksLikeJson(text: string): boolean {
  return text.startsWith("{") || text.startsWith("[");
}

/** 通道 → LLM provider(工具通道不调用模型;本地/远端复用既有 /api/llm 链路) */
function channelProvider(channel: ExtractChannel): "local" | "remote" {
  return channel === "local" ? "local" : "remote";
}

export function useStoryboardExtractFlow(input: {
  shots: Shot[];
  scenes: Scene[];
  characters: Character[];
  styles: StyleRef[];
  onShotsChange: (s: Shot[]) => void;
  onCharactersChange?: (c: Character[]) => void;
  scriptMarkdown?: string;
  extract?: { session: ExtractSession; actions: ExtractSessionActions };
  config: LLMConfigView | null;
  openSettings: () => void;
}) {
  const {
    shots,
    scenes,
    characters,
    styles,
    onShotsChange,
    onCharactersChange,
    scriptMarkdown,
    extract,
    config,
    openSettings,
  } = input;

  // ── 三通道提取(工具 / 本地模型 / 远端API)+ 外部导入 ──
  // 下拉选项值（tool | local::<model> | remote::<model>），通道与模型一并保存。
  // 提取的 通道/忙闲/过程/状态/错误/执行日志 已收归工坊 controller(storyboardExtract)
  // 并经 props.extract 注入：展示读 session，写入走 actions。controller 跨阶段页签
  // 常驻，提取中切页签再切回状态不丢，无需模块级缓存。遗留/独立使用(未注入)时
  // 退化为本 hook 局部会话。
  const localExtract = useExtractSession("tool", "storyboard");
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
    patch: setExtractState,
    appendProgress: setExtractAppendProgress,
    appendLog,
    setLog,
  } = extractActions;
  /** 视图层改下拉通道：写回 controller 会话 */
  const setExtractChannelValue = (value: string) => {
    setExtractState({ channelValue: value });
  };

  const hasScript = !!scriptMarkdown?.trim();
  const knownNames = characters
    .map((character) => character.name)
    .filter(Boolean);

  /** 条目 → 既有 Shot 结构(场景/角色关联与提示词重算复用既有链路) */
  function appendShots(entries: ShotEntry[]) {
    const built = buildShotsFromEntries(
      entries,
      shots.length,
      scenes,
      characters,
    );
    onShotsChange([...shots, ...built]);
    setExtractState({ status: `已提取 ${built.length} 个镜头` });
  }

  /** 三通道提取入口:工具=确定性拆分;本地/API=LLM 输出 JSON,失败降级提示 */
  async function handleExtract() {
    const script = (scriptMarkdown ?? "").trim();
    if (!script) {
      setExtractState({
        error: "未获取到剧本文本,请先在「剧本」阶段编写或编辑剧本",
      });
      return;
    }
    if (extractChannel !== "tool" && !config) {
      openSettings();
      return;
    }
    setExtractState({
      busy: true,
      progress: "",
      status: extractChannel === "tool" ? "" : "正在调用模型提取分镜…",
      error: "",
    });
    // 新一次提取：重置日志为仅含 init 一条，展示本次输入→输出→结果链路。
    setLog([
      makeExtractLog(
        "init",
        `使用 ${extractChannel === "tool" ? "内置规则" : extractChannel === "local" ? "本地模型" : "远端模型"} ${extractChannel === "tool" ? "" : parseChannelOption(extractChannelValue).model || ""}从剧本提取分镜`,
      ),
    ]);
    try {
      let entries: ShotEntry[];
      if (extractChannel === "tool") {
        const drafts = parseShotDrafts(script, knownNames);
        if (drafts.length === 0) {
          setExtractState({
            error:
              "工具通道未在剧本中找到场景标题(如「1-1 场景 外 地点(时间)」)或 Δ动作 / Vx台词 行。可检查剧本结构后重试,或切换到本地模型 / 配置API 通道。",
          });
          return;
        }
        entries = drafts.map(draftToShotEntry);
      } else {
        const requestMessages = buildExtractShotsMessages(script, knownNames);
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
          onToken: (token) => setExtractAppendProgress(token),
        });
        appendLog(makeExtractLog("output", "模型返回完成，正在解析…", full));
        entries = parseExtractedShots(full);
        if (entries.length === 0) {
          appendLog(
            makeExtractLog("error", "模型未返回有效分镜 JSON，解析失败"),
          );
          setExtractState({
            error:
              "模型未返回有效分镜 JSON,解析失败。可重试,或改用「工具」通道。",
          });
          return;
        }
      }
      appendLog(
        makeExtractLog("result", `解析出 ${entries.length} 个分镜，准备写入`),
      );
      appendShots(entries);
    } catch (e: unknown) {
      appendLog(makeExtractLog("error", errorMessage(e, "提取失败")));
      setExtractState({
        error: `${errorMessage(e, "提取失败")} 可重试,或改用「工具」通道。`,
      });
    } finally {
      setExtractState({ busy: false });
    }
  }

  /** 外部导入:分镜脚本 markdown 走工具解析器;JSON 支持分镜数组与角色卡文件 */
  async function handleImportFile(file: File) {
    setExtractState({ busy: true, status: "", error: "" });
    try {
      /* 读取收在唯一出口里（§16.2.4.27）—— 此前两处各写一遍 `file.text()`，
       * 而「读失败」与「文件为空」在它们那里压成同一个结果。 */
      const text = await readFileAsText(file);
      const trimmed = text.trim();
      if (!trimmed) throw new Error("文件内容为空");
      if (looksLikeJson(trimmed)) {
        let entries: ShotEntry[];
        try {
          entries = parseExtractedShots(trimmed);
        } catch {
          // 非分镜 JSON:尝试按角色卡文件导入(写入角色列表)
          const cards = parseImportedCharacterCards(trimmed);
          if (!onCharactersChange) {
            throw new Error(
              "这是角色卡文件,但当前页面未接入角色写入,请到「角色卡」阶段导入",
            );
          }
          const res = mergeCharacterDrafts(characters, cards, styles);
          if (res.added === 0) {
            throw new Error("角色卡均已存在或无有效内容,未新增");
          }
          onCharactersChange(res.list);
          setExtractState({
            status: `已从文件导入 ${res.added} 个角色卡${res.skipped > 0 ? `(跳过 ${res.skipped} 个重名)` : ""}`,
          });
          return;
        }
        if (entries.length === 0) {
          throw new Error(
            "JSON 中未解析出任何镜头(需含 sceneHeading 或 description 字段)",
          );
        }
        appendShots(entries);
        return;
      }
      const drafts = parseShotDrafts(trimmed, knownNames);
      if (drafts.length === 0) {
        throw new Error(
          "未在文件中找到场景标题(如「1-1 场景 外 地点(时间)」)或 Δ动作 / Vx台词 行",
        );
      }
      appendShots(drafts.map(draftToShotEntry));
    } catch (e: unknown) {
      setExtractState({ error: errorMessage(e, "导入失败") });
    } finally {
      setExtractState({ busy: false });
    }
  }

  return {
    extractChannelValue,
    setExtractChannelValue,
    extractChannel,
    extractBusy,
    extractProgress,
    extractStatus,
    extractError,
    extractionLog,
    hasScript,
    handleExtract,
    handleImportFile,
  };
}
