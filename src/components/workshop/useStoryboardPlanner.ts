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
import { useItemErrors } from "~/components/ui/use-item-errors";
import { useItemAction } from "~/components/ui/use-item-action";
import { useBusyAction } from "~/components/ui/use-busy-action";
import type { Shot, Scene, Character, StyleRef } from "~/lib/workshop/types";
import {
  buildShotPrompt,
  buildShotNegative,
  mergeParams,
} from "~/lib/workshop/prompt-builder";
import { workshopUid } from "~/lib/workshop/script-parser";
import { runWithConcurrency } from "~/lib/async-pool";
import { WORKSHOP_BATCH_CONCURRENCY } from "~/lib/workshop/generation-client";
import { useLLM } from "~/components/workshop/LLMContext";
import type {
  ExtractSession,
  ExtractSessionActions,
} from "~/components/workshop/hooks/use-workshop-pipeline";
import { streamChat } from "~/lib/llm/browser";
import { buildStoryboardMessages, parseStoryboard } from "~/lib/llm/prompts";
import { errorMessage } from "~/lib/error-message";
import { useStoryboardExtractFlow } from "./useStoryboardExtractFlow";

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
  /** 分镜「从剧本提取」会话(busy/progress/日志)已收归 controller，经 props 注入；
   *  未注入(遗留/独立使用)时退化为本 hook 局部会话。 */
  extract?: { session: ExtractSession; actions: ExtractSessionActions };
}

/** 条目 → 既有 Shot 结构(场景/角色关联与提示词重算复用既有链路) */
function recompute(
  shot: Shot,
  scene: Scene | undefined,
  chars: Character[],
  style?: StyleRef,
): Shot {
  const prompt = buildShotPrompt(shot, scene, chars, style);
  const neg = buildShotNegative(chars, style);
  const params = mergeParams(style, undefined);
  return {
    ...shot,
    prompt,
    negativePrompt: neg,
    params: { ...shot.params, ...params },
  };
}

export function useStoryboardPlanner(props: Props) {
  const {
    scriptMarkdown,
    scenes,
    characters,
    styles,
    shots,
    onShotsChange,
    onGenerate,
    onCharactersChange,
    extract,
  } = props;
  /* 忙碌位走唯一出口（规范 16 §16.2.4.71）。 */
  const ai = useBusyAction();
  const [aiProgress, setAiProgress] = useState("");
  const [aiError, setAiError] = useState("");
  const { config, openSettings } = useLLM();

  /* ── 三通道提取 + 外部导入（沉在 sub-hook）──────────────────────
   * 会话接线、`handleExtract` / `handleImportFile` / `appendShots` 全部收在
   * `./useStoryboardExtractFlow`；依赖（shots/scenes/characters/styles、写回、
   * 剧本源、LLM 配置）显式注入。返回形状与原 controller 逐字段一致。 */
  const {
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
  } = useStoryboardExtractFlow({
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
  });

  // 从剧本导入镜头：每个场景 → shotCount 个镜头
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
        // 自动构建提示词
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
        const chars = characters.filter((character) =>
          next.characterIds.includes(character.id),
        );
        const style = styles.find((st) => st.slug === next.skillSlug);
        return recompute(next, scene, chars, style);
      }),
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
    setAiProgress("");
    setAiError("");
    try {
      const built: Shot[] = [];
      let n = shots.length;
      const charNames = characters
        .map((character) => character.name)
        .filter(Boolean);
      /* 「逐幕拆镜」这一整段套进忙碌位出口：复位绑在 finally 上，
       * 于是中途抛错（模型报错 / 解析失败）不会把「拆镜中」永远留在界面上。 */
      await ai.run(async () => {
        for (let i = 0; i < scenes.length; i++) {
          const scene = scenes[i];
          setAiProgress(
            `正在拆镜 ${i + 1}/${scenes.length} · ${scene!.heading}`,
          );
          const full = await streamChat({
            messages: buildStoryboardMessages(scene!, charNames),
            /* onToken 不传即「无需逐 token 处理」（streamChat 内部 onToken?.() 调用） */
          });
          const raws = parseStoryboard(full);
          raws.forEach((raw) => {
            n += 1;
            const charIds = characters
              .filter(
                (character) =>
                  character.name && raw.characterNames.includes(character.name),
              )
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
            const linkedChars = characters.filter((character) =>
              charIds.includes(character.id),
            );
            built.push(recompute(shot, scene, linkedChars, undefined));
          });
        }
      });
      onShotsChange([...shots, ...built]);
      setAiProgress(`已用 AI 生成 ${built.length} 个镜头`);
    } catch (e: unknown) {
      setAiError(errorMessage(e, "AI 拆镜失败"));
    }
  }

  async function generateAll() {
    const pending = shots.filter(
      (shot) => shot.status === "idle" || shot.status === "failed",
    );
    /* 有界并发（见 WORKSHOP_BATCH_CONCURRENCY）：onGenerate 内部自兜单条失败，
     * 一条 failed 不中断批量。 */
    await runWithConcurrency(pending, WORKSHOP_BATCH_CONCURRENCY, (shot) =>
      onGenerate(shot),
    );
  }

  /* ── 图片提示词：AI 润色 ──
   * 模板拼接的 prompt 覆盖构图/角色/风格要素，但画面叙事平淡。AI 润色把
   * 模板 prompt 作为要素清单，让模型补画面叙事、光影与镜头语言，产出更
   * 出图的提示词；negative 同步微调。 */
  /* 「哪一条在润色」收在 `useItemAction`（规范 16 §16.2.4.40）：此前是本
   * 文件自持的 `useState<string | null>`，与历史列表的重试、角色的润色各写
   * 一份 —— 「同一条能不能重复点」三处都没防。整表动作的忙标记（批量润色）
   * 是**另一个形态**，走 `useBusyAction`（规范 16 §16.2.4.71），两者并用。 */
  const polishAction = useItemAction(shots.map((shot) => shot.id));
  const polishAllBusy = useBusyAction();
  /* 润色错误挂在**那个镜头**上（规范 16 §16.2.4.33）：收口前是一句
   * `useState("")` —— 润色镜头 A 失败后去润色镜头 B，A 的提示就被盖掉，
   * 用户只看到一句不知道指哪一行的话。 */
  const polishErrors = useItemErrors(shots.map((shot) => shot.id));

  async function polishOne(shot: Shot) {
    if (!config) {
      openSettings();
      return;
    }
    await polishAction.run(shot.id, async () => {
      polishErrors.clear(shot.id);
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
            {
              role: "user",
              content: shot.prompt || shot.description || sceneFallback(shot),
            },
          ],
          opts: { temperature: 0.7 },
        });
        const polished = full.trim();
        if (!polished) throw new Error("模型未返回提示词");
        updateShot(shot.id, { prompt: polished });
      } catch (e: unknown) {
        polishErrors.report(shot.id)("err", errorMessage(e, "提示词润色失败"));
      }
      /* 忙标记由出口的 `finally` 清。 */
    });
  }

  function sceneFallback(shot: Shot): string {
    const scene = scenes.find((sc) => sc.id === shot.sceneId);
    return [shot.shotType, scene?.location, scene?.action]
      .filter(Boolean)
      .join(", ");
  }

  async function polishAll() {
    if (!config) {
      openSettings();
      return;
    }
    polishErrors.clearAll();
    /* 整表动作的忙碌位也走唯一出口（规范 16 §16.2.4.71）——「哪一条」走
     * `useItemAction`，这里是「整批」，两者形态不同、并用。 */
    await polishAllBusy.run(async () => {
      for (const shot of shots) {
        await polishOne(shot);
      }
    });
  }

  return {
    aiBusy: ai.busy,
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
    extractionLog,
    hasScript,
    handleExtract,
    handleImportFile,
    importFromScript,
    updateShot,
    removeShot,
    clearShots,
    handleAISplit,
    polishBusyId: polishAction.busyId,
    /* 「这一条忙不忙」的判据收在出口里，视图不再自己写 `busyId === item.id`
     * （规范 16 §16.2.4.40）。`polishAnyBusy` 同理。 */
    polishIsBusy: polishAction.isBusy,
    polishAnyBusy: polishAction.anyBusy,
    polishBusyAll: polishAllBusy.busy,
    polishErrors,
    polishOne,
    polishAll,
    generateAll,
  };
}
