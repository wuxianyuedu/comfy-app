"use client";
import React from "react";
import { textHandler } from "~/lib/form-props";
import { Trash } from "lucide-react";
import { Hint } from "~/components/ui/hint";
import { SelectMenu } from "~/components/ui/select-menu";
import { EmptyState } from "~/components/ui/empty-state";
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
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
import { ExtractModelSelect } from "~/components/workshop/ExtractModelSelect";
import {
  CharacterPortraitStudio,
  type CharacterPortraitContext,
} from "~/components/workshop/CharacterPortraitStudio";
import { CharacterReviewButton } from "~/components/workshop/CharacterReviewButton";
import { useLLM } from "~/components/workshop/LLMContext";
import {
  newCharacter,
  useCharacterAiFlow,
  useCharacterExtractFlow,
} from "./hooks/use-character-flows";
import { channelProviderLabel } from "~/lib/workshop/channel-options";
import { ExtractToolbar } from "~/components/workshop/ExtractToolbar";
import { enterCommit } from "~/components/ui/use-enter-commit";
import {
  ExitReminder,
  exitReminderSignal,
} from "~/components/ui/use-exit-reminder";
import type {
  ExtractSession,
  ExtractSessionActions,
} from "./hooks/use-workshop-pipeline";

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
  const { config, openSettings } = useLLM();

  /* 提取/导入 与 一句话生成/AI 润色 两个分域各自沉在 sub-hook
   * （与 useStoryboardExtractFlow 同族）；依赖显式注入，返回形状与
   * 原内联实现逐字段一致。 */
  const {
    extractChannelValue,
    setExtractChannelValue,
    extractBusy,
    extractStatus,
    extractProgress,
    extractError,
    extractionLog,
    hasScript,
    handleExtract,
    handleImportFile,
  } = useCharacterExtractFlow({
    characters,
    styles,
    onCharactersChange,
    scriptMarkdown,
    extract,
    config,
    openSettings,
  });
  const {
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
  } = useCharacterAiFlow({
    characters,
    styles,
    onCharactersChange,
    update,
    brief,
    setBrief,
    config,
    openSettings,
  });

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

  return (
    /* 容器挂「有会丢的东西」的信号：角色列表非空就说明这一屏有用户敲出来的内容，
       切到别的阶段 / 别的视图时它们会随之消失。判据在 CSS（`globals.css`
       的 `[data-exit-reminder]:has(~ [data-dirty])`），这里只负责把信号摆出来 ——
       组件本身零状态、零定时器（详见 `ui/use-exit-reminder` 的文件头）。 */
    <div
      className="flex-col gap-4"
      {...exitReminderSignal(characters.length > 0)}
    >
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

      {/* 提示条是 `[data-dirty]` 的**后继兄弟** —— 选择器用的是 `~`，
          挂到祖先上就永远命不中（那正是这条判据最容易的静默失效方式）。 */}
      <ExitReminder className="text-ink-faint text-2xs px-1 leading-relaxed">
        切走这一阶段后这里的角色会被清空，需要先导出或复制保留。
      </ExitReminder>

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
          <ExtractModelSelect value={genSelectValue} onChange={setGenSel} />
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
                className="text-primary bg-bg/60 text-2xs rounded-lg px-3 py-2"
                trigger="生成过程"
              >
                <pre className="text-muted-foreground text-2xs mt-1 max-h-40 overflow-y-auto leading-relaxed break-all whitespace-pre-wrap">
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
        onChannelValueChange={(value) => setExtractChannelValue(value)}
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
        <EmptyState
          variant="hint"
          description="还没有角色。添加角色后会自动生成可送入生图的提示词。"
          className="py-10 text-sm"
        />
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
                <Hint label="用 LLM 补全外貌/服装/性格" wrap>
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => handleAICard(character)}
                    disabled={aiAction.isBusy(character.id) || gen.busy}
                    className="border-primary-soft text-primary hover:bg-primary-soft h-auto rounded-md px-2 py-1"
                  >
                    {aiAction.isBusy(character.id) ? (
                      "…"
                    ) : (
                      <>
                        <Icon
                          data-icon="inline-start"
                          name="sparkles"
                          size={12}
                          className="mr-1 inline align-[-2px]"
                        />
                        AI 润色
                      </>
                    )}
                  </Button>
                </Hint>
                <CharacterReviewButton character={character} />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => remove(character.id)}
                  className="text-muted-foreground hover:text-danger-strong"
                  aria-label="删除角色"
                >
                  <Trash data-icon="inline-start" size={16} />
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
                  className="border-border! bg-subtle! text-sm"
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
                <p className="text-ink/80 text-xs leading-relaxed wrap-break-word">
                  {character.positivePrompt || "填写角色信息后自动生成…"}
                </p>
                {character.negativePrompt && (
                  <p className="text-muted-foreground/70 mt-2 text-xs leading-relaxed wrap-break-word">
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
