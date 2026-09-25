"use client";

// ── 角色定妆照区块（规范 17 §17.2 第③层：只渲染 + 上抛）────────────────────
// 定妆照 = 按角色提示词生成的「人物基准图」，后续分镜图以它作参考图。
// 一次生图常常不满意，故本区块保留历次结果（本地 / 远端 / 外部导入）供挑选，
// 挑中的一张写在角色上（character.portraitUrl）。业务与网络全在
// hooks/use-character-portrait.ts 与 lib/workshop/character-portrait-client.ts。

import { formatClock } from "~/lib/time-format";
import React from "react";

import { SelectMenu } from "~/components/ui/select-menu";
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import { useFilePicker } from "~/components/ui/file-picker";
import { Progress } from "~/components/ui/progress";
import { Alert } from "~/components/ui/alert";
import { Disclosure } from "~/components/ui/disclosure";
import { ShotSizePicker } from "~/components/workshop/ShotSizePicker";
import { useLLM } from "~/components/workshop/LLMContext";
import { fetchGenerationLogs } from "~/lib/workshop/generation-log-client";
import type { PersistableGenerationLog } from "~/lib/workshop/generation-log-client";
import type {
  PortraitSession,
  PortraitSessionActions,
} from "~/components/workshop/hooks/use-character-portrait";
import type { ApiChannelsView } from "~/lib/workshop/api-channel-shared";
import type { WorkshopWorkflowOption } from "~/lib/workshop/generation-client";
import {
  PORTRAIT_SOURCE_LABELS,
  portraitCandidates,
} from "~/lib/workshop/character-portrait";
import type { Character } from "~/lib/workshop/types";
import { MediaThumbnail } from "~/components/ui/media-thumbnail";

/** 定妆照区块需要的全部上下文：会话（controller 常驻）+ 生成通道配置。 */
export interface CharacterPortraitContext {
  session: PortraitSession;
  actions: PortraitSessionActions;
  /** API 直连通道的脱敏配置（远端通道的门禁） */
  apiChannels: ApiChannelsView | null;
  /** 工作流库可选项（本地通道按模型标签挑选已封装的生图工作流）。 */
  workflows: WorkshopWorkflowOption[];
  onOpenApiSettings: () => void;
}

interface Props {
  character: Character;
  portrait: CharacterPortraitContext;
}

/** 单张角色卡里的「定妆照」区块：生成 / 导入 / 挑选。 */
export function CharacterPortraitStudio({ character, portrait }: Props) {
  const { session, actions, apiChannels, workflows, onOpenApiSettings } =
    portrait;
  /* 导入定妆照：隐藏 input + 选完复位收进`ui/file-picker`。 */
  const importPicker = useFilePicker({
    accept: "image/*",
    onPick: (file) => void actions.importFile(character, file),
  });

  /** 会话消息只挂在发起它的那张卡上，别的角色卡不重复展示同一份进度与日志。 */
  const focused = session.focusCharacterId === character.id;
  const busy = session.busy && focused;
  const importing = session.importing && focused;
  /* 远端模型来自设置页「远端模型」（kind=图片）；有配置时远端通道直接可用，
   * 不必再在工坊 API 通道里重复填一份 Base URL / API Key。 */
  const { remoteImageModels } = useLLM();
  const effectiveRemoteModel =
    session.remoteModel || (remoteImageModels[0] ?? "");
  const remoteReady =
    apiChannels?.image.configured === true || remoteImageModels.length > 0;
  /* 本地通道的「模型」= 工作库里配置好对外参数的生图工作流（按模型标签展示）。
   * 没有内置模板可回落：未选工作流时本地通道不可用（见下方门禁提示）。 */
  const localWorkflows = workflows.filter(
    (w) => w.category === "image" && w.encapsulationReady,
  );
  const localOptionLabels: Record<string, string> = {};
  const tagCounts = new Map<string, number>();
  for (const w of localWorkflows) {
    const tag = w.modelTags[0];
    if (tag) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }
  for (const w of localWorkflows) {
    const tag = w.modelTags[0];
    localOptionLabels[w.id] = tag
      ? (tagCounts.get(tag) ?? 0) > 1
        ? `${tag} · ${w.name}`
        : tag
      : w.name;
  }
  const localOptions = localWorkflows.map((w) => w.id);
  const localBlocked = session.channel === "local" && !session.localWorkflowId;
  const remoteBlocked = session.channel === "remote" && !remoteReady;
  const hasPrompt = !!character.positivePrompt.trim();
  const canGenerate =
    hasPrompt &&
    !session.busy &&
    !session.importing &&
    !localBlocked &&
    !remoteBlocked;

  /* 生成日志历史（跨刷新 / 重启可回看）：点「历史」按需拉取，不做实时轮询。 */
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [history, setHistory] = React.useState<
    PersistableGenerationLog[] | null
  >(null);
  const loadHistory = () => {
    setHistoryOpen(true);
    if (history) return;
    void fetchGenerationLogs("portrait", 100).then(setHistory);
  };

  const candidates = portraitCandidates(character);

  return (
    <div className="bg-subtle mt-3 rounded-lg p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <p className="text-muted-foreground text-xs font-medium">定妆照</p>
        <div className="flex gap-1">
          {(["local", "remote"] as const).map((channel) => (
            <Button
              key={channel}
              variant="outline"
              size="xs"
              onClick={() => actions.patch({ channel })}
              disabled={session.busy || session.importing}
              className={`h-auto rounded-md px-2 py-1 ${
                session.channel === channel
                  ? "border-primary bg-primary-soft text-primary"
                  : "border-border text-muted-foreground hover:bg-surface"
              }`}
            >
              {channel === "local" ? "本地（ComfyUI）" : "远端 API"}
            </Button>
          ))}
        </div>
        {session.channel === "local" && (
          <SelectMenu
            value={session.localWorkflowId}
            onChange={(value) => actions.patch({ localWorkflowId: value })}
            options={localOptions}
            labels={localOptionLabels}
            placeholder="选择本地生图模型"
            disabled={session.busy || session.importing}
            className="!bg-subtle !border-border text-[11px]"
            popoverMinWidth={240}
          />
        )}
        {session.channel === "remote" && remoteImageModels.length > 0 && (
          <SelectMenu
            value={effectiveRemoteModel}
            onChange={(value) => actions.patch({ remoteModel: value })}
            options={remoteImageModels}
            placeholder="选择远端生图模型"
            disabled={session.busy || session.importing}
            className="!bg-subtle !border-border text-[11px]"
            popoverMinWidth={220}
          />
        )}
        <ShotSizePicker
          value={session.size}
          onChange={(size) => actions.patch({ size })}
          disabled={session.busy}
        />
        <Button
          variant="primary-solid"
          size="xs"
          onClick={() =>
            void actions.generate(
              character,
              session.channel === "remote" && effectiveRemoteModel
                ? { remoteModel: effectiveRemoteModel }
                : session.channel === "local" && session.localWorkflowId
                  ? {
                      localWorkflowId: session.localWorkflowId,
                      localLabel:
                        localOptionLabels[session.localWorkflowId] ??
                        "库工作流",
                    }
                  : undefined,
            )
          }
          disabled={!canGenerate}
          className="h-auto rounded-md px-3 py-1.5"
        >
          {busy
            ? "生成中…"
            : candidates.length > 0
              ? "再生成一张"
              : "生成定妆照"}
        </Button>
        <Button
          variant="outline"
          size="xs"
          onClick={importPicker.open}
          disabled={session.busy || session.importing}
          className="border-border text-ink hover:bg-surface h-auto rounded-md px-3 py-1.5"
        >
          {importing ? "导入中…" : "导入图片"}
        </Button>
        <importPicker.Input />
      </div>

      {/* 通道门禁提示：说清缺什么、去哪里补，不让按钮无声失效 */}
      {session.channel === "local" && !session.localWorkflowId && (
        <p className="text-muted-foreground text-[11px]">
          本地通道需要先在上方下拉选一个工作流库模型（需在库里配置好对外参数）。
          没有内置工作流可回落 ——
          工作流库里还没有可用的生图工作流时，可切到「远端 API」通道。
        </p>
      )}
      {session.channel === "remote" && !remoteReady && (
        <p className="text-warning-strong flex flex-wrap items-center gap-1 text-[11px]">
          <Icon name="info" size={11} />
          远端 API 生图未配置 —— 在
          <span className="font-medium">设置 → 模型</span>
          里添加一条「图片」类型的远端模型即可直接使用；或
          <Button
            variant="link"
            onClick={onOpenApiSettings}
            className="h-auto p-0 text-[11px] underline underline-offset-2"
          >
            打开 API 通道设置
          </Button>
          填写 Base URL 与 API Key。
        </p>
      )}
      {!hasPrompt && (
        <p className="text-muted-foreground text-[11px]">
          该角色还没有生成提示词：先在下方补全外貌 /
          服装等信息，提示词会自动合成。
        </p>
      )}

      {focused && (
        <div className="mt-2 flex flex-col gap-1">
          {busy && (
            <>
              <p className="text-primary text-[11px]">
                正在用 {session.modelLabel || "当前通道"} 生成定妆照…
              </p>
              <Progress
                /* 通道不提供进度（远端一次性请求）传 null：base-ui 渲染成不确定
 进度条（脉动），不拿 0 装成 4% 的确定性进度。 */
                value={session.progress}
                className="bg-elevated h-1 gap-0"
              />
            </>
          )}
          {session.status && !session.error && (
            <p role="status" className="text-primary text-[11px]">
              {session.status}
            </p>
          )}
          {session.error && (
            <Alert
              variant="danger"
              /* 行内错误行：保持原有的紧凑尺寸与「无可见边框」观感 ——
 基元只接管「危险色怎么取」（此前写死 bg-red-100 + 深色档
 文字，浅底在深色主题下会与文字糊在一起）。 */
              className="block rounded-md border-transparent px-2 py-1 text-[11px]"
            >
              {session.error}
            </Alert>
          )}
          {(session.log.length > 0 || focused) && (
            /* 触发行右侧的「历史」是**另一个动作**（打开历史日志），不是折叠
             * 开关 —— 它不能放进`Disclosure` 的 trigger 里：
             * 基元的 trigger 是`<button>`，再嵌一个`<button>` 在 HTML 里非法
             * （旧写法靠`stopPropagation` 掩盖了这一点，React 会报水合错误）。
             * 故改为「触发开关 + 并列动作」一行排布。 */
            <div className="bg-bg/60 rounded-md px-2 py-1">
              <div className="text-primary flex items-center gap-2 text-[10px]">
                <Disclosure
                  open={busy ? true : undefined}
                  marker="caret"
                  className="min-w-0 items-center gap-2"
                  panelClassName="text-[10px]"
                  trigger={`生成过程${
                    session.log.length > 0 ? `（${session.log.length} 条）` : ""
                  }`}
                >
                  <ul className="mt-1 flex max-h-40 flex-col gap-0.5 overflow-y-auto">
                    {session.log.map((entry) => (
                      <li
                        key={`${entry.ts}-${entry.text}`}
                        className={`text-[10.5px] leading-relaxed ${
                          entry.level === "error"
                            ? "text-destructive"
                            : entry.level === "success"
                              ? "text-success-strong"
                              : "text-muted-foreground"
                        }`}
                      >
                        <span className="text-faint mr-1">
                          {formatClock(entry.ts)}
                        </span>
                        {entry.text}
                      </li>
                    ))}
                  </ul>
                </Disclosure>
                <Button
                  variant="link"
                  onClick={() => loadHistory()}
                  className="text-muted-foreground hover:text-primary h-auto shrink-0 p-0 text-[11px] underline underline-offset-2"
                >
                  历史
                </Button>
              </div>
              {historyOpen && (
                <div className="border-border/60 mt-1 border-t pt-1">
                  <p className="text-muted-foreground text-[10px]">
                    历史日志（含此前会话，保存在 log/workshop/）
                  </p>
                  {history === null ? (
                    <p className="text-muted-foreground text-[10.5px]">
                      加载中…
                    </p>
                  ) : history.length === 0 ? (
                    <p className="text-muted-foreground text-[10.5px]">
                      还没有落盘的历史日志。
                    </p>
                  ) : (
                    <ul className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
                      {history.map((entry, i) => (
                        <li
                          key={`${entry.ts}-${i}`}
                          className={`text-[10.5px] leading-relaxed ${
                            entry.kind === "error"
                              ? "text-destructive"
                              : entry.kind === "success"
                                ? "text-success-strong"
                                : "text-muted-foreground"
                          }`}
                        >
                          <span className="text-faint mr-1">
                            {formatClock(entry.ts)}
                          </span>
                          {entry.summary}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 候选：历次生成与导入的图都在这里，点一张即定为定妆照 */}
      {candidates.length === 0 ? (
        <p className="text-muted-foreground mt-2 text-[11px]">
          还没有定妆照 ——
          生成或导入后可在这里挑一张定为定妆照，后续分镜图会以它作参考图。
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          {candidates.map((candidate) => {
            const selected = character.portraitUrl === candidate.url;
            return (
              <div key={candidate.url} className="relative">
                <Button
                  variant="ghost"
                  onClick={() => actions.select(character.id, candidate.url)}
                  title={selected ? "已定为定妆照" : "设为定妆照"}
                  aria-label={
                    selected
                      ? "当前定妆照"
                      : `把这张（${PORTRAIT_SOURCE_LABELS[candidate.source]}）设为定妆照`
                  }
                  className={`block overflow-hidden rounded-lg border-2 transition-colors ${
                    selected
                      ? "border-primary"
                      : "border-border hover:border-primary/60"
                  }`}
                >
                  <MediaThumbnail
                    src={candidate.url}
                    alt={`定妆照候选（${PORTRAIT_SOURCE_LABELS[candidate.source]}）`}
                    className="size-24 object-cover"
                  />
                </Button>
                <span className="pointer-events-none absolute top-1 left-1 rounded bg-black/60 px-1 text-[9px] text-white">
                  {PORTRAIT_SOURCE_LABELS[candidate.source]}
                </span>
                {selected && (
                  <span className="bg-primary pointer-events-none absolute right-1 bottom-1 rounded px-1 text-[9px] text-white">
                    定妆照
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => actions.remove(character.id, candidate.url)}
                  disabled={session.busy || session.importing}
                  aria-label="删除这张定妆照候选"
                  className="text-muted-foreground hover:text-danger-strong absolute -top-1.5 -right-1.5 rounded-full bg-black/70"
                >
                  ✕
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
