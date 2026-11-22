"use client";

// ── 角色定妆照区块（规范 17 §17.2 第③层：只渲染 + 上抛）────────────────────
// 定妆照 = 按角色提示词生成的「人物基准图」，后续分镜图以它作参考图。
// 一次生图常常不满意，故本区块保留历次结果（本地 / 远端 / 外部导入）供挑选，
// 挑中的一张写在角色上（character.portraitUrl）。业务与网络全在
// hooks/use-character-portrait.ts 与 lib/workshop/character-portrait-client.ts。

import { formatClock } from "~/lib/time-format";
import React from "react";

import { Hint } from "~/components/ui/hint";
import { Spinner } from "~/components/ui/spinner";
import { Button } from "~/components/ui/button";
import { FilePicker, useFilePicker } from "~/components/ui/file-picker";
import { Progress } from "~/components/ui/progress";
import { Alert } from "~/components/ui/alert";
import { Disclosure } from "~/components/ui/disclosure";
import { ShotSizePicker } from "~/components/workshop/ShotSizePicker";
import { fetchGenerationLogs } from "~/lib/workshop/generation-log-client";
import type { PersistableGenerationLog } from "~/lib/workshop/generation-log-client";
import type {
  PortraitSession,
  PortraitSessionActions,
} from "~/components/workshop/hooks/use-character-portrait";
import { PORTRAIT_SOURCE_LABELS, portraitCandidates } from "~/lib/workshop/character-portrait";
import type { Character } from "~/lib/workshop/types";
import { MediaThumbnail } from "~/components/ui/media-thumbnail";
import { ModelCascadeSelect, type ModelSelection } from "~/components/workshop/ModelCascadeSelect";
import { useModelCatalog } from "~/components/workshop/hooks/use-model-catalog";
import { candidateLabel } from "~/components/workshop/model-test-config";

/** 定妆照区块需要的全部上下文：会话（controller 常驻）+ 模型选择（#4834）。 */
export type CharacterPortraitContext = {
  actions: PortraitSessionActions;
  /** 本入口的模型选择（统一级联；候选含本地工作流与远端模型）。 */
  modelSelection: ModelSelection;
  onModelSelectionChange: (next: ModelSelection) => void;
  onOpenModelAdapters: () => void;
  session: PortraitSession;
};

type Props = {
  character: Character;
  portrait: CharacterPortraitContext;
};

/** 单张角色卡里的「定妆照」区块：生成 / 导入 / 挑选。 */
export function CharacterPortraitStudio({ character, portrait }: Props) {
  const { session, actions, modelSelection, onModelSelectionChange, onOpenModelAdapters } =
    portrait;
  /* 导入定妆照：隐藏 input + 选完复位收进`ui/file-picker`。 */
  const importPicker = useFilePicker({
    accept: "image/*",
    onPick: (file) => {
      void actions.importFile(character, file);
    },
  });

  /** 会话消息只挂在发起它的那张卡上，别的角色卡不重复展示同一份进度与日志。 */
  const focused = session.focusCharacterId === character.id;
  const busy = session.busy && focused;
  const importing = session.importing && focused;
  /* 模型候选（#4834 统一级联）：按选中模型分流本地工作流 / 远端 API 两条通道。 */
  const catalog = useModelCatalog("image", modelSelection.mode);
  const selectedCandidate = catalog.resolveCandidate(modelSelection.model);
  const hasPrompt = !!character.positivePrompt.trim();
  const canGenerate =
    hasPrompt && !session.busy && !session.importing && selectedCandidate !== null;

  /* 生成日志历史（跨刷新 / 重启可回看）：点「历史」按需拉取，不做实时轮询。 */
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [history, setHistory] = React.useState<Array<PersistableGenerationLog> | null>(null);
  const [historyFailed, setHistoryFailed] = React.useState(false);
  const loadHistory = () => {
    setHistoryOpen(true);
    if (history) {
      return;
    }
    /* 失败与空态分开说（#4242）：失败时把 history 复位成 null，重开「历史」可重试。 */
    void fetchGenerationLogs("portrait", 100).then((res) => {
      setHistory(res.entries);
      setHistoryFailed(!res.ok);
      if (!res.ok) {
        setHistory(null);
      }
    });
  };

  const candidates = portraitCandidates(character);

  return (
    /* SAFETY: 类型断言已复核 */
    <div className="bg-subtle mt-3 rounded-lg p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <p className="text-muted-foreground text-xs font-medium">定妆照</p>
        {/* 模型选择（#4834 统一级联）：定妆照只出「文生图」一档模式；候选含
            本地工作流（按模型标签显示）与远端 API 模型，生成时按候选分流。 */}
        <ModelCascadeSelect
          kind="image"
          modes={["T2I"]}
          onSelectionChange={onModelSelectionChange}
          selection={modelSelection}
        />
        <ShotSizePicker
          disabled={session.busy}
          onChange={(size) => {
            actions.patch({ size });
          }}
          value={session.size}
        />
        <Button
          className="h-auto rounded-md px-3 py-1.5"
          disabled={!canGenerate}
          onClick={() => {
            void actions.generate(
              character,
              selectedCandidate === null
                ? undefined
                : selectedCandidate.workflow === undefined
                  ? { remoteModel: selectedCandidate.name }
                  : {
                      localWorkflowId: selectedCandidate.workflow.id,
                      localLabel: candidateLabel(selectedCandidate),
                    },
            );
          }}
          size="xs"
          variant="primary-solid"
        >
          {busy ? "生成中…" : candidates.length > 0 ? "再生成一张" : "生成定妆照"}
        </Button>
        <Button
          className="border-border text-ink hover:bg-surface h-auto rounded-md px-3 py-1.5"
          disabled={session.busy || session.importing}
          onClick={importPicker.open}
          size="xs"
          variant="outline"
        >
          {importing ? "导入中…" : "导入图片"}
        </Button>
        <FilePicker {...importPicker.inputProps} />
      </div>

      {/* 门禁提示：说清缺什么、去哪里补，不让按钮无声失效 */}
      {selectedCandidate === null && (
        <p className="text-muted-foreground text-2xs">
          请先在上方选择图片模型 —— 本地工作流需在工作流库配好对外参数；远端模型在
          <span className="font-medium">设置 → 模型</span> 里添加，或到
          <Button
            className="text-2xs h-auto p-0 underline underline-offset-2"
            onClick={onOpenModelAdapters}
            variant="link"
          >
            模型适配
          </Button>
          配置该模式的字段映射。
        </p>
      )}
      {!hasPrompt && (
        <p className="text-muted-foreground text-2xs">
          该角色还没有生成提示词：先在下方补全外貌 / 服装等信息，提示词会自动合成。
        </p>
      )}

      {focused && (
        <div className="mt-2 flex flex-col gap-1">
          {busy && (
            <>
              <p className="text-primary text-2xs">
                正在用 {session.modelLabel || "当前通道"} 生成定妆照…
              </p>
              <Progress
                className="bg-elevated h-1 gap-0"
                /* 通道不提供进度（远端一次性请求）传 null：base-ui 渲染成不确定
 进度条（脉动），不拿 0 装成 4% 的确定性进度。 */
                value={session.progress}
              />
            </>
          )}
          {session.status && !session.error && (
            <p className="text-primary text-2xs" role="status">
              {session.status}
            </p>
          )}
          {session.error && (
            <Alert
              /* 行内错误行：保持原有的紧凑尺寸与「无可见边框」观感 ——
 基元只接管「危险色怎么取」（此前写死 bg-red-100 + 深色档
 文字，浅底在深色主题下会与文字糊在一起）。 */
              className="text-2xs block rounded-md border-transparent px-2 py-1"
              variant="danger"
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
              <div className="text-primary text-3xs flex items-center gap-2">
                <Disclosure
                  className="min-w-0 items-center gap-2"
                  marker="caret"
                  open={busy ? true : undefined}
                  panelClassName="text-3xs"
                  trigger={`生成过程${
                    session.log.length > 0 ? `（${session.log.length} 条）` : ""
                  }`}
                >
                  <ul className="mt-1 flex max-h-40 flex-col gap-0.5 overflow-y-auto">
                    {session.log.map((entry) => (
                      <li
                        className={`text-2xs leading-relaxed ${
                          entry.level === "error"
                            ? "text-destructive"
                            : entry.level === "success"
                              ? "text-success-strong"
                              : "text-muted-foreground"
                        }`}
                        key={`${entry.ts}-${entry.text}`}
                      >
                        <span className="text-faint mr-1">{formatClock(entry.ts)}</span>
                        {entry.text}
                      </li>
                    ))}
                  </ul>
                </Disclosure>
                <Button
                  className="text-muted-foreground hover:text-primary text-2xs h-auto shrink-0 p-0 underline underline-offset-2"
                  onClick={() => {
                    loadHistory();
                  }}
                  variant="link"
                >
                  历史
                </Button>
              </div>
              {historyOpen && (
                <div className="border-border/60 mt-1 border-t pt-1">
                  <p className="text-muted-foreground text-3xs">
                    历史日志（含此前会话，保存在 log/workshop/）
                  </p>
                  {historyFailed ? (
                    <p className="text-destructive text-2xs">历史日志拉取失败：请稍后重试。</p>
                  ) : history === null ? (
                    <p className="text-muted-foreground text-2xs flex items-center gap-1.5">
                      <Spinner className="size-3" />
                      历史日志加载中…
                    </p>
                  ) : history.length === 0 ? (
                    <p className="text-muted-foreground text-2xs">还没有落盘的历史日志。</p>
                  ) : (
                    <ul className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
                      {history.map((entry, i) => (
                        <li
                          className={`text-2xs leading-relaxed ${
                            entry.kind === "error"
                              ? "text-destructive"
                              : entry.kind === "success"
                                ? "text-success-strong"
                                : "text-muted-foreground"
                          }`}
                          key={`${entry.ts}-${i}`}
                        >
                          <span className="text-faint mr-1">{formatClock(entry.ts)}</span>
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
        <p className="text-muted-foreground text-2xs mt-2">
          还没有定妆照 —— 生成或导入后可在这里挑一张定为定妆照，后续分镜图会以它作参考图。
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          {candidates.map((candidate) => {
            const selected = character.portraitUrl === candidate.url;
            return (
              <div className="relative" key={candidate.url}>
                <Hint label={selected ? "已定为定妆照" : "设为定妆照"}>
                  <Button
                    aria-label={
                      selected
                        ? "当前定妆照"
                        : `把这张（${PORTRAIT_SOURCE_LABELS[candidate.source]}）设为定妆照`
                    }
                    className={`block overflow-hidden rounded-lg border-2 transition-colors ${
                      selected ? "border-primary" : "border-border hover:border-primary/60"
                    }`}
                    onClick={() => {
                      actions.select(character.id, candidate.url);
                    }}
                    variant="ghost"
                  >
                    <MediaThumbnail
                      alt={`定妆照候选（${PORTRAIT_SOURCE_LABELS[candidate.source]}）`}
                      className="size-24 object-cover"
                      src={candidate.url}
                    />
                  </Button>
                </Hint>
                <span className="text-4xs pointer-events-none absolute top-1 left-1 rounded bg-black/60 px-1 text-white">
                  {PORTRAIT_SOURCE_LABELS[candidate.source]}
                </span>
                {selected && (
                  <span className="bg-primary text-4xs pointer-events-none absolute right-1 bottom-1 rounded px-1 text-white">
                    定妆照
                  </span>
                )}
                <Button
                  aria-label="删除这张定妆照候选"
                  className="text-muted-foreground hover:text-danger-strong absolute -top-1.5 -right-1.5 rounded-full bg-black/70"
                  disabled={session.busy || session.importing}
                  onClick={() => {
                    actions.remove(character.id, candidate.url);
                  }}
                  size="icon-xs"
                  variant="ghost"
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
