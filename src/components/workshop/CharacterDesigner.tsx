"use client";
import React from "react";
import { clamp } from "~/lib/clamp";
import { numberHandler, textHandler } from "~/lib/form-props";
import { Trash } from "lucide-react";
import { Hint } from "~/components/ui/hint";
import { SelectMenu } from "~/components/ui/select-menu";
import { EmptyState } from "~/components/ui/empty-state";
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import { FormField } from "~/components/ui/form-field";
import { Input } from "~/components/ui/input";
import { Disclosure } from "~/components/ui/disclosure";
import { AttributeMultiSelect } from "~/components/workshop/AttributeMultiSelect";
import { useCharacterLoraOptions } from "./hooks/use-character-lora-options";
import { CHARACTER_ATTRIBUTES, type AttributeOptionSet } from "~/lib/workshop/character-options";
import type { Character, StyleRef } from "~/lib/workshop/types";
import { buildCharacterPrompt, buildCharacterNegative } from "~/lib/workshop/prompt-builder";
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
import { IndexDot } from "~/components/workshop/IndexDot";
import { enterCommit } from "~/components/ui/use-enter-commit";
import { ExitReminder, exitReminderSignal } from "~/components/ui/use-exit-reminder";
import type { ExtractSession, ExtractSessionActions } from "./hooks/use-workshop-pipeline";

type Props = {
  characters: Array<Character>;
  /** 提取会话（busy/progress/日志）已收归工坊 controller，经 props 注入；
   * 未注入（遗留/独立使用场景）时退化为本组件内的局部会话。 */
  extract?: { actions: ExtractSessionActions; session: ExtractSession };
  onCharactersChange: (c: Array<Character>) => void;
  /** 定妆照会话与生成通道配置（同样收归 controller，经 props 注入）。
   * 未注入时不渲染定妆照区块，遗留/独立使用场景不受影响。 */
  portrait?: CharacterPortraitContext;
  /** 工坊流水线的剧本 markdown(既有状态,经 props 传入,不改变数据归属) */
  scriptMarkdown?: string;
  styles: Array<StyleRef>; // available Skill styles
};

/** 判断导入内容是否为 JSON(角色卡 JSON 走结构化解析,其余按剧本 markdown 解析) */
/** 把角色描述字符串拆成下拉选项数组（兼容中/英文逗号、顿号与空白分隔）。
 * 旧项目里保存的角色可能缺新字段（如 temperament），入参按可缺失兜底。 */
function splitAttr(text: string | undefined | null): Array<string> {
  return (text ?? "")
    .split(/[、,，，\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}
/** 把下拉选项数组合并回角色描述字符串 */
function joinAttr(items: Array<string>): string {
  return items.join("、");
}

/** 取某属性维度的配置（服装/外貌/性格/气质/风格） */
function attrSet(id: string): AttributeOptionSet {
  /* 「找不到就用首项」：首项与表的非空性是同一件事，
   * 抽取一次即可（`CHARACTER_ATTRIBUTES` 是常量，必有首项）。 */
  const fallback = CHARACTER_ATTRIBUTES[0];
  return CHARACTER_ATTRIBUTES.find((a) => a.id === id) ?? fallback;
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

  /* 角色 LoRA 绑定的候选（模型库 loras 目录，#2622 FR-QA-02③）。 */
  const { options: loraFiles, loading: lorasLoading } = useCharacterLoraOptions();

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
        if (character.id !== id) {
          return character;
        }
        const next = { ...character, ...patch };
        // Recompute prompts
        const style = styles.find((style) => style.slug === next.skillSlug);
        next.positivePrompt = buildCharacterPrompt(next, style);
        next.negativePrompt = buildCharacterNegative(next, style);
        if (style?.defaultParams) {
          next.params = { ...style.defaultParams };
        }
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
    <div className="flex-col gap-4" {...exitReminderSignal(characters.length > 0)}>
      <div className="flex items-center justify-between">
        <h3 className="u-title">
          角色设计
          <span className="text-muted-foreground">({characters.length})</span>
        </h3>
        <div className="flex gap-2">
          <Button
            className="border-border text-primary hover:bg-subtle h-auto rounded-lg px-3 py-1.5"
            onClick={add}
            size="xs"
            variant="outline"
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
            <Icon className="mr-1" name="sparkles" size={13} />
            用一句话生成角色
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExtractModelSelect onChange={setGenSel} value={genSelectValue} />
          <input
            onChange={textHandler(setBrief)}
            value={brief}
            /* Enter 触发 AI 生成（Shift+Enter 不触发）；生成中不响应。 */
            {...enterCommit({
              onCommit: () => {
                if (!gen.busy) {
                  void handleAIGenerate();
                }
              },
              excludeShift: true,
            })}
            className="border-border bg-bg focus:border-primary flex-1 rounded-lg border px-3 py-2 text-sm outline-none"
            placeholder="例如：一位穿唐装的白发剑客，气质孤傲"
          />
          <Button
            className="h-auto rounded-lg px-3 py-2"
            disabled={!brief.trim() || gen.busy}
            onClick={handleAIGenerate}
            size="xs"
            variant="primary-solid"
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
                className="text-primary bg-bg/60 text-2xs rounded-lg px-3 py-2"
                defaultOpen
                marker="caret"
                trigger="生成过程"
              >
                <pre className="text-muted-foreground text-2xs mt-1 max-h-40 overflow-y-auto leading-relaxed break-all whitespace-pre-wrap">
                  {genProgress}
                </pre>
              </Disclosure>
            )}
            {genStatus && !genError && <p className="text-primary mt-1 text-xs">{genStatus}</p>}
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
        busy={extractBusy}
        channelValue={extractChannelValue}
        errorText={extractError}
        executionLog={extractionLog}
        extractDisabled={!hasScript}
        extractDisabledReason="未获取到剧本文本(在「剧本」阶段编写后可提取)。仍可用「外部导入」载入角色卡 JSON 或人物清单。"
        logStage="character"
        onChannelValueChange={(value) => {
          setExtractChannelValue(value);
        }}
        onExtract={() => {
          void handleExtract();
        }}
        onImportFile={(file) => {
          void handleImportFile(file);
        }}
        progressText={extractProgress}
        statusText={extractStatus}
        title="从剧本提取角色"
      />

      {characters.length === 0 ? (
        <EmptyState
          className="py-10 text-sm"
          description="还没有角色。添加角色后会自动生成可送入生图的提示词。"
          variant="hint"
        />
      ) : (
        <div className="flex flex-col gap-3">
          {characters.map((character, i) => (
            <div className="border-border bg-surface rounded-xl border p-4" key={character.id}>
              <div className="mb-3 flex items-center gap-2">
                <IndexDot index={i + 1} />
                <input
                  className="text-ink hover:border-border focus:border-primary flex-1 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium outline-none"
                  onChange={(event) => {
                    update(character.id, { name: event.target.value });
                  }}
                  placeholder="角色名"
                  value={character.name}
                />
                <Hint label="用 LLM 补全外貌/服装/性格" wrap>
                  <Button
                    className="border-primary-soft text-primary hover:bg-primary-soft h-auto rounded-md px-2 py-1"
                    disabled={aiAction.isBusy(character.id) || gen.busy}
                    onClick={() => handleAICard(character)}
                    size="xs"
                    variant="outline"
                  >
                    {aiAction.isBusy(character.id) ? (
                      "…"
                    ) : (
                      <>
                        <Icon className="mr-1" data-icon="inline-start" name="sparkles" size={12} />
                        AI 润色
                      </>
                    )}
                  </Button>
                </Hint>
                <CharacterReviewButton character={character} />
                <Button
                  aria-label="删除角色"
                  className="text-muted-foreground hover:text-danger-strong"
                  onClick={() => {
                    remove(character.id);
                  }}
                  size="icon-sm"
                  variant="ghost"
                >
                  <Trash data-icon="inline-start" size={16} />
                </Button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="年龄/性别"
                  onChange={(value) => {
                    update(character.id, { ageGender: value });
                  }}
                  placeholder="25岁 女性"
                  value={character.ageGender}
                />

                {/* 服装 / 外貌特征 / 性格 / 气质 / 风格 —— 穷举式多选下拉 */}
                <AttributeMultiSelect
                  groups={attrSet("costume").groups}
                  label={attrSet("costume").label}
                  onChange={(items) => {
                    update(character.id, { costume: joinAttr(items) });
                  }}
                  placeholder="如：唐装、风衣…"
                  value={splitAttr(character.costume)}
                />
                <AttributeMultiSelect
                  groups={attrSet("appearance").groups}
                  label={attrSet("appearance").label}
                  onChange={(items) => {
                    update(character.id, { appearance: joinAttr(items) });
                  }}
                  placeholder="如：短发、双眼皮…"
                  value={splitAttr(character.appearance)}
                />
                <AttributeMultiSelect
                  groups={attrSet("personality").groups}
                  label={attrSet("personality").label}
                  onChange={(items) => {
                    update(character.id, { personality: joinAttr(items) });
                  }}
                  placeholder="如：冷静、开朗…"
                  value={splitAttr(character.personality)}
                />
                <AttributeMultiSelect
                  groups={attrSet("temperament").groups}
                  label={attrSet("temperament").label}
                  onChange={(items) => {
                    update(character.id, { temperament: joinAttr(items) });
                  }}
                  placeholder="如：清冷孤傲、知性…"
                  value={splitAttr(character.temperament)}
                />
                <AttributeMultiSelect
                  groups={attrSet("styleTags").groups}
                  label={attrSet("styleTags").label}
                  onChange={(items) => {
                    update(character.id, { styleTags: items });
                  }}
                  placeholder="如：厚涂、国风…"
                  /* oxlint-disable-next-line no-unnecessary-condition -- 角色对象来自浅校验的草稿解析（draft-store 只查数组不深查元素），脏草稿可能缺 styleTags，保留 ?? [] 兜底 */
                  value={character.styleTags ?? []}
                />
              </div>

              {/* 关联的风格技能 */}
              <div className="mt-2">
                <span className="text-muted-foreground mb-1 block text-xs">艺术风格（Skill）</span>
                <SelectMenu
                  className="border-border! bg-subtle! text-sm"
                  labels={Object.fromEntries(
                    styles.map((style) => [style.slug, `${style.icon} ${style.name}`]),
                  )}
                  onChange={(value) => {
                    update(character.id, { skillSlug: value || undefined });
                  }}
                  options={styles.map((style) => style.slug)}
                  placeholder="不指定（使用风格标签）"
                  value={character.skillSlug ?? ""}
                />
              </div>

              {/* 绑定 LoRA（FR-QA-02③ · #2622）：值在提交时落到工作流的
                  「lora-name」契约口（LoraLoader 的 lora_name）；工作流没连
                  该口 → unmatched 提示，用其图内 LoRA 配置。 */}
              <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_96px]">
                <div>
                  <span className="text-muted-foreground mb-1 block text-xs">
                    绑定 LoRA（可选）
                  </span>
                  <SelectMenu
                    className="border-border! bg-subtle! text-sm"
                    onChange={(value) => {
                      update(character.id, {
                        loraName: value || undefined,
                        ...(value ? {} : { loraStrength: undefined }),
                      });
                    }}
                    options={loraFiles}
                    placeholder={lorasLoading ? "加载中…" : "不绑定（用工作流图内配置）"}
                    value={character.loraName ?? ""}
                  />
                </div>
                {character.loraName !== undefined && character.loraName !== "" && (
                  <div>
                    <span className="text-muted-foreground mb-1 block text-xs">强度</span>
                    <Input
                      disabled={!character.loraName}
                      inputMode="decimal"
                      onChange={numberHandler((v) => {
                        update(character.id, {
                          loraStrength: clamp(v, 0, 2),
                        });
                      }, 1)}
                      value={
                        character.loraStrength === undefined ? "1" : String(character.loraStrength)
                      }
                    />
                  </div>
                )}
              </div>

              {/* 生成出的提示词预览 */}
              <div className="bg-subtle mt-3 rounded-lg p-3">
                <p className="text-muted-foreground mb-1 text-xs font-medium">生成提示词预览</p>
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
              {portrait && <CharacterPortraitStudio character={character} portrait={portrait} />}
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
  onChange: (v: string) => void;
  placeholder?: string;
  value: string;
}) {
  return (
    <FormField label={label} labelClassName="text-muted-foreground mb-1 text-xs">
      {(a11y) => (
        <input
          {...a11y}
          className="border-border bg-bg focus:border-primary w-full rounded-md border px-2 py-1.5 text-xs outline-none"
          onChange={textHandler(onChange)}
          placeholder={placeholder}
          value={value}
        />
      )}
    </FormField>
  );
}
