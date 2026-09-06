"use client";

/**
 * StoryboardPlanner 的状态与全部业务逻辑抽离为 hook。
 * 主组件（StoryboardPlanner.tsx）仅负责渲染，本文件负责：
 *   - 三通道提取（工具 / 本地模型 / 配置 API）+ 外部导入
 *   - 从剧本导入 / AI 智能拆镜 / 批量生成 / 清空
 *   - 镜头字段更新、删除、提示词重算
 * 行为与原组件内联实现逐值一致。
 */

import { useState } from "react";
import type { Shot, Scene, Character, StyleRef } from "@/lib/workshop/types";
import { buildShotPrompt, buildShotNegative, mergeParams } from "@/lib/workshop/prompt-builder";
import { workshopUid } from "@/lib/workshop/script-parser";
import {
  buildExtractShotsMessages,
  buildShotsFromEntries,
  draftToShotEntry,
  mergeCharacterDrafts,
  parseExtractedShots,
  parseImportedCharacterCards,
  parseShotDrafts,
} from "@/lib/workshop/script-parse";
import type { ShotEntry } from "@/lib/workshop/script-parse";
import type { ExtractChannel } from "@/components/workshop/ExtractToolbar";
import { parseChannelOption } from "@/components/workshop/ExtractToolbar";
import { useLLM } from "@/components/workshop/LLMContext";
import { streamChat } from "@/lib/llm/browser";
import { buildStoryboardMessages, parseStoryboard } from "@/lib/llm/prompts";

/** catch 抛出值（unknown）→ 与旧 `e?.message ?? fallback` 逐值等价的消息提取：
 *  带 string message 的对象取 message（Error 实例即此路径），其余回退。 */
function errorMessage(e: unknown, fallback: string): string {
  if (typeof e === "object" && e !== null && "message" in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return fallback;
}

/** 判断导入内容是否为 JSON(分镜/角色卡 JSON 走结构化解析,其余按剧本 markdown 解析) */
function looksLikeJson(text: string): boolean {
  return text.startsWith("{") || text.startsWith("[");
}

/** 每个镜头节点的实时生成进度（pct + 当前 ComfyUI 节点类别），由管线页传入。 */
export type ShotProgress = Record<string, { pct: number; label?: string }>;

export interface Props {
  scenes: Scene[];
  characters: Character[];
  styles: StyleRef[];
  shots: Shot[];
  onShotsChange: (s: Shot[]) => void;
  onGenerate: (shot: Shot) => Promise<void>;
  generating: boolean;
  /** 镜头节点上的实时生成进度（running 时在节点内渲染进度条） */
  progressByShot?: ShotProgress;
  /** 工坊流水线的剧本 markdown(既有状态,经 props 传入,不改变数据归属) */
  scriptMarkdown?: string;
  /** 分镜阶段导入角色卡 JSON 时的角色写入口(可选,未接入时仅提示) */
  onCharactersChange?: (c: Character[]) => void;
}

/** 条目 → 既有 Shot 结构(场景/角色关联与提示词重算复用既有链路) */
function recompute(
  shot: Shot,
  scene: Scene | undefined,
  chars: Character[],
  style?: StyleRef
): Shot {
  const prompt = buildShotPrompt(shot, scene, chars, style);
  const neg = buildShotNegative(chars, style);
  const params = mergeParams(style, undefined);
  return { ...shot, prompt, negativePrompt: neg, params: { ...shot.params, ...params } };
}

/** 通道 → LLM provider(工具通道不调用模型;本地/远端复用既有 /api/llm 链路) */
function channelProvider(channel: ExtractChannel): "local" | "remote" {
  return channel === "local" ? "local" : "remote";
}

export function useStoryboardPlanner(props: Props) {
  const { scriptMarkdown, scenes, characters, styles, shots, onShotsChange, onGenerate, onCharactersChange } =
    props;
  const [aiBusy, setAiBusy] = useState(false);
  const [aiProgress, setAiProgress] = useState("");
  const [aiError, setAiError] = useState("");
  const { config, openSettings } = useLLM();

  // ── 三通道提取(工具 / 本地模型 / 远端API)+ 外部导入 ──
  // 下拉选项值（tool | local::<model> | remote::<model>），通道与模型一并保存
  const [extractChannelValue, setExtractChannelValue] = useState("tool");
  const extractChannel = parseChannelOption(extractChannelValue).channel;
  const [extractBusy, setExtractBusy] = useState(false);
  const [extractStatus, setExtractStatus] = useState("");
  /** 模型通道的实时提取过程（流式 token 累积） */
  const [extractProgress, setExtractProgress] = useState("");
  const [extractError, setExtractError] = useState("");
  /** 模型清单刷新序号：设置弹窗保存后递增，让下拉重新拉取清单。
   *  渲染期对比 config 引用（React 19 派生态写法）：config 每次保存后
   *  是新对象，计数随之递增；初始 null→有值那次不计数（首次无需重拉）。 */
  const [extractRefreshKey, setExtractRefreshKey] = useState(0);
  const [prevCfg, setPrevCfg] = useState(config);
  if (config && config !== prevCfg) {
    setPrevCfg(config);
    setExtractRefreshKey((n) => n + 1);
  } else if (!config && prevCfg) {
    setPrevCfg(null);
  }

  const hasScript = !!scriptMarkdown?.trim();
  const knownNames = characters.map((character) => character.name).filter(Boolean);

  /** 条目 → 既有 Shot 结构(场景/角色关联与提示词重算复用既有链路) */
  function appendShots(entries: ShotEntry[]) {
    const built = buildShotsFromEntries(entries, shots.length, scenes, characters);
    onShotsChange([...shots, ...built]);
    setExtractStatus(`已提取 ${built.length} 个镜头`);
  }

  /** 三通道提取入口:工具=确定性拆分;本地/API=LLM 输出 JSON,失败降级提示 */
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
    setExtractProgress("");
    setExtractStatus(extractChannel === "tool" ? "" : "正在调用模型提取分镜…");
    setExtractError("");
    try {
      let entries: ShotEntry[];
      if (extractChannel === "tool") {
        const drafts = parseShotDrafts(script, knownNames);
        if (drafts.length === 0) {
          setExtractError(
            "工具通道未在剧本中找到场景标题(如「1-1 场景 外 地点(时间)」)或 Δ动作 / Vx台词 行。可检查剧本结构后重试,或切换到本地模型 / 配置API 通道。"
          );
          return;
        }
        entries = drafts.map(draftToShotEntry);
      } else {
        const full = await streamChat({
          messages: buildExtractShotsMessages(script, knownNames),
          opts: {
            provider: channelProvider(extractChannel),
            model: parseChannelOption(extractChannelValue).model,
          },
          onToken: (token) => setExtractProgress((prev) => prev + token),
        });
        entries = parseExtractedShots(full);
        if (entries.length === 0) {
          setExtractError("模型未返回有效分镜 JSON,解析失败。可重试,或改用「工具」通道。");
          return;
        }
      }
      appendShots(entries);
    } catch (e: unknown) {
      setExtractError(`${errorMessage(e, "提取失败")} 可重试,或改用「工具」通道。`);
    } finally {
      setExtractBusy(false);
    }
  }

  /** 外部导入:分镜脚本 markdown 走工具解析器;JSON 支持分镜数组与角色卡文件 */
  async function handleImportFile(file: File) {
    setExtractBusy(true);
    setExtractStatus("");
    setExtractError("");
    try {
      const text = await file.text();
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
            throw new Error("这是角色卡文件,但当前页面未接入角色写入,请到「角色卡」阶段导入");
          }
          const res = mergeCharacterDrafts(characters, cards, styles);
          if (res.added === 0) {
            throw new Error("角色卡均已存在或无有效内容,未新增");
          }
          onCharactersChange(res.list);
          setExtractStatus(
            `已从文件导入 ${res.added} 个角色卡${res.skipped > 0 ? `(跳过 ${res.skipped} 个重名)` : ""}`
          );
          return;
        }
        if (entries.length === 0) {
          throw new Error("JSON 中未解析出任何镜头(需含 sceneHeading 或 description 字段)");
        }
        appendShots(entries);
        return;
      }
      const drafts = parseShotDrafts(trimmed, knownNames);
      if (drafts.length === 0) {
        throw new Error(
          "未在文件中找到场景标题(如「1-1 场景 外 地点(时间)」)或 Δ动作 / Vx台词 行"
        );
      }
      appendShots(drafts.map(draftToShotEntry));
    } catch (e: unknown) {
      setExtractError(errorMessage(e, "导入失败"));
    } finally {
      setExtractBusy(false);
    }
  }

  // Import shots from script: each scene → shotCount shots
  function importFromScript() {
    const built: Shot[] = [];
    let n = shots.length;
    scenes.forEach((scene) => {
      const count = Math.max(1, scene.shotCount);
      for (let i = 0; i < count; i++) {
        n += 1;
        const shot: Shot = {
          id: workshopUid("shot"),
          index: n,
          sceneId: scene.id,
          sceneHeading: scene.heading,
          shotType: i === 0 ? "wide" : "medium",
          description: i === 0 ? scene.action : "",
          characterIds: [],
          prompt: "",
          negativePrompt: "",
          params: {},
          status: "idle",
        };
        // Auto-build prompt
        recompute(shot, scene, [], undefined);
        built.push(shot);
      }
    });
    onShotsChange([...shots, ...built]);
  }

  function updateShot(id: string, patch: Partial<Shot>) {
    onShotsChange(
      shots.map((shot) => {
        if (shot.id !== id) return shot;
        const next = { ...shot, ...patch };
        const scene = scenes.find((sc) => sc.id === next.sceneId);
        const chars = characters.filter((character) => next.characterIds.includes(character.id));
        const style = styles.find((st) => st.slug === next.skillSlug);
        return recompute(next, scene, chars, style);
      })
    );
  }

  function removeShot(id: string) {
    onShotsChange(shots.filter((shot) => shot.id !== id));
  }

  function clearShots() {
    if (confirm("确定清空当前所有分镜？")) onShotsChange([]);
  }

  async function handleAISplit() {
    if (scenes.length === 0) return;
    if (!config) {
      openSettings();
      return;
    }
    setAiBusy(true);
    setAiProgress("");
    setAiError("");
    try {
      const built: Shot[] = [];
      let n = shots.length;
      const charNames = characters.map((character) => character.name).filter(Boolean);
      for (let i = 0; i < scenes.length; i++) {
        const scene = scenes[i];
        setAiProgress(`正在拆镜 ${i + 1}/${scenes.length} · ${scene!.heading}`);
        const full = await streamChat({
          messages: buildStoryboardMessages(scene!, charNames),
          /* onToken 不传即「无需逐 token 处理」（streamChat 内部 onToken?.() 调用） */
        });
        const raws = parseStoryboard(full);
        raws.forEach((raw) => {
          n += 1;
          const charIds = characters
            .filter((character) => character.name && raw.characterNames.includes(character.name))
            .map((character) => character.id);
          const shot: Shot = {
            id: workshopUid("shot"),
            index: n,
            sceneId: scene!.id,
            sceneHeading: scene!.heading,
            shotType: raw.shotType,
            description: raw.description,
            characterIds: charIds,
            prompt: "",
            negativePrompt: "",
            params: {},
            status: "idle",
          };
          const linkedChars = characters.filter((character) => charIds.includes(character.id));
          built.push(recompute(shot, scene, linkedChars, undefined));
        });
      }
      onShotsChange([...shots, ...built]);
      setAiProgress(`已用 AI 生成 ${built.length} 个镜头`);
    } catch (e: unknown) {
      setAiError(errorMessage(e, "AI 拆镜失败"));
    } finally {
      setAiBusy(false);
    }
  }

  async function generateAll() {
    const pending = shots.filter((shot) => shot.status === "idle" || shot.status === "failed");
    for (const shot of pending) {
      await onGenerate(shot);
    }
  }

  /* ── 图片提示词：AI 润色 ──
   * 模板拼接的 prompt 覆盖构图/角色/风格要素，但画面叙事平淡。AI 润色把
   * 模板 prompt 作为要素清单，让模型补画面叙事、光影与镜头语言，产出更
   * 出图的提示词；negative 同步微调。 */
  const [polishBusyId, setPolishBusyId] = useState<string | null>(null);
  const [polishBusyAll, setPolishBusyAll] = useState(false);
  const [polishError, setPolishError] = useState("");

  async function polishOne(shot: Shot) {
    if (!config) {
      openSettings();
      return;
    }
    setPolishBusyId(shot.id);
    setPolishError("");
    try {
      const full = await streamChat({
        messages: [
          {
            role: "system",
            content:
              "你是 AI 绘画提示词工程师。用户给出一个分镜镜头的要素清单（构图、场景、角色、风格）。" +
              "请把它改写为一段 60~120 词的英文画面提示词：保留全部要素，补足光影、氛围、镜头语言与画面叙事，" +
              "用逗号分隔的短语，不要解释、不要换行以外的多余文字。只输出提示词本身。",
          },
          { role: "user", content: shot.prompt || shot.description || sceneFallback(shot) },
        ],
        opts: { temperature: 0.7 },
      });
      const polished = full.trim();
      if (!polished) throw new Error("模型未返回提示词");
      updateShot(shot.id, { prompt: polished });
    } catch (e: unknown) {
      setPolishError(errorMessage(e, "提示词润色失败"));
    } finally {
      setPolishBusyId(null);
    }
  }

  function sceneFallback(shot: Shot): string {
    const scene = scenes.find((sc) => sc.id === shot.sceneId);
    return [shot.shotType, scene?.location, scene?.action].filter(Boolean).join(", ");
  }

  async function polishAll() {
    if (!config) {
      openSettings();
      return;
    }
    setPolishBusyAll(true);
    setPolishError("");
    try {
      for (const shot of shots) {
        await polishOne(shot);
      }
    } finally {
      setPolishBusyAll(false);
    }
  }

  return {
    aiBusy,
    aiProgress,
    aiError,
    config,
    extractChannelValue,
    setExtractChannelValue,
    extractChannel,
    extractBusy,
    extractProgress,
    extractStatus,
    extractError,
    extractRefreshKey,
    hasScript,
    handleExtract,
    handleImportFile,
    importFromScript,
    updateShot,
    removeShot,
    clearShots,
    handleAISplit,
    polishBusyId,
    polishBusyAll,
    polishError,
    polishOne,
    polishAll,
    generateAll,
  };
}
