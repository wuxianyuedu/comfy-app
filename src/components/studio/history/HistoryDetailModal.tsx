import { Folder, X } from "lucide-react";

import { Hint } from "~/components/ui/hint";
import { MediaThumbnail } from "~/components/ui/media-thumbnail";
import { ViewableImage } from "~/components/ui/image-viewer";
import { isVideo } from "~/lib/media/media";
import { Skeleton } from "~/components/ui/skeleton";
import { fetchTaskWorkflow, revealTaskFolder } from "~/lib/history-detail-actions";
import { isPlainRecord } from "~/lib/is-record";
import { taskStatusLabel } from "~/lib/task-state";

import {
  deriveTaskOrigin,
  deriveWorkflowParams,
  deriveWorkshopParams,
  isPromptParamRow,
  kvValueText,
} from "./history-detail-derive";
import type { WorkflowIOMap } from "~/lib/workflow/workflow-io-types";
import type { ModeContract } from "~/lib/workshop/model-mode-contract";
import { useHistoryDetailActions } from "./hooks/use-history-detail-actions";
import type { TaskDetail } from "./history-types";
import { Button } from "~/components/ui/button";
import { Dialog, DialogContent } from "~/components/ui/dialog";
import { Disclosure } from "~/components/ui/disclosure";
import { KeyValueRows } from "~/components/ui/key-value-rows";
import { OVERLAY_MAX_HEIGHT } from "~/components/ui/overlay-max-height";

type HistoryDetailModalProps = {
  detail: TaskDetail | null;
  detailId: string | null;
  detailLoading: boolean;
  /** 模式契约注册表（只含用户改过的模式）：工坊参数按「任务模式 + 生效契约」枚举。
   * 为 null 时回落内置默认契约。 */
  modeContracts?: ReadonlyArray<ModeContract> | null;
  onClose: () => void;
  /** 本任务所用工作流的 IO 定义：参数可读名从它的`label` 查（任务行里只存了
   * pin 名）。工作流已被删除时是空表，参数名如实回落 pin 名。 */
  workflowIO: WorkflowIOMap;
};

/** 弹窗头部的状态徽标（设计稿 #4710）：语义底 + 同色圆点，键是任务状态原值。 */
const STATUS_BADGE_CLASS: Record<string, string> = {
  SUCCEEDED: "bg-success/10 text-success-strong",
  FAILED: "bg-destructive/10 text-destructive",
  RUNNING: "bg-info/10 text-info-strong",
  CANCELLED: "bg-warning/10 text-warning-strong",
};

/** 提示词这类长文案在参数表里的展示格（ISSUE #4665）：定高 + 纵向滚动，
 *  超出部分滚动查看；完整文案始终在 DOM 里（可选中 / 可复制 / 读屏可读）。
 *  定高让「提示词」这一行不再把弹窗内容无限拉长。 */
function PromptValueCell({ text }: { text: string }) {
  return (
    <span className="text-ink-bright block h-24 overflow-y-auto break-words whitespace-pre-wrap">
      {text}
    </span>
  );
}

/**
 * 历史任务详情弹窗 —— 纯展示层（规范 17 §17.2 第③层）：图片网格 + 工坊参数（工坊发起时）+ 工作流参数 + 打开目录/下载工作流。
 * 不再有独立提示词块与「生成参数」卡：它们与参数表重复（同一提示词出现两次），且只看硬编码键名，
 * 反而过滤掉种子等关键参数；现在一切参数按来源分块，名字取工作流 IO 作者标签（workflowIO）。
 * 派生在 history-detail-derive.ts、动作在 hooks/use-history-detail-actions.ts、网络在 lib/…；本文件只排版与上抛。
 * 「重试 / 评分收藏 / 放大重绘」等编辑性入口已从这里撤走（#4841）：详情只看——
 * 重试走任务卡（带参预填测试模型），评分收藏与放大重绘不再有这个弹窗入口。
 */
export function HistoryDetailModal({
  detailId,
  detail,
  detailLoading,
  workflowIO,
  modeContracts,
  onClose,
}: HistoryDetailModalProps) {
  const actions = useHistoryDetailActions({
    openFolder: revealTaskFolder,
    fetchWorkflow: fetchTaskWorkflow,
  });

  if (detailId === null || detailId === "") {
    return null;
  }
  // 局部 const 让闭包 / IIFE 内的空值窄化在 TS 中稳定成立。
  const current = detail;
  /* 按来源分块：工坊发起的任务多摆一块「工坊参数」（工坊对外值），工作流直接
   * 发起的任务只有「工作流参数」—— 判据见`deriveTaskOrigin`。 */
  const origin = deriveTaskOrigin(current);
  const workshopParams =
    origin === "workshop"
      ? deriveWorkshopParams(current, current?.type ?? null, modeContracts, workflowIO)
      : [];
  const {
    rows: paramRows,
    topLevelEntries,
    hasAny: hasParams,
  } = deriveWorkflowParams(current, workflowIO, current?.type ?? null);
  const firstImage = Array.isArray(current?.images) ? current.images[0] : undefined;
  /* 快照是 DB 的 JSON 列（unknown）：先确认它是对象、`source` 是字符串再读，
   *  其余（null / 旧数据 / 非字符串）都按「磁盘回退快照」显示。 */
  const snapshot = current?.workflowSnapshot;
  const snapSource =
    isPlainRecord(snapshot) && typeof snapshot.source === "string" ? snapshot.source : undefined;
  const sourceLabel =
    snapSource === "backfill"
      ? "历史记录回填快照"
      : snapSource === "execution"
        ? "执行时自动捕获的独立快照"
        : "磁盘回退快照";

  /* 关闭语义（Esc / 点遮罩 / 焦点锁与归还）交给`ui/dialog`：此前自绘遮罩 +
 手写`onClick` 关闭，Esc 没接、焦点不锁也不归还。 */
  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      open
    >
      <DialogContent
        aria-label="任务详情"
        className="bg-transparent p-0 ring-0"
        popupClassName="max-w-[1120px]"
        showCloseButton={false}
      >
        <div
          className={`border-border bg-surface flex ${OVERLAY_MAX_HEIGHT} w-full max-w-[1120px] flex-col overflow-hidden rounded-2xl border`}
        >
          <div className="border-border-subtle relative flex items-center justify-between gap-3 border-b px-6 pt-4 pb-3.5">
            <h3 className="text-ink-bright text-[17px] leading-snug font-bold">
              任务详情
              {current ? (
                <span
                  className={`ml-2.5 inline-flex items-center gap-1.5 rounded-full py-0.5 pr-2.5 pl-2 align-middle text-xs font-medium ${STATUS_BADGE_CLASS[current.status] ?? "bg-subtle text-ink-muted"}`}
                >
                  <span aria-hidden className="size-1.5 rounded-full bg-current" />
                  {taskStatusLabel(current.status)}
                </span>
              ) : null}
            </h3>
            <div className="flex items-center gap-2">
              <Hint
                label="在系统文件管理器中打开本次生成的目录（图片 / 视频 / 音频 / workflow.json / manifest.json 都在这里）"
                wrap
              >
                <Button
                  className="border-border text-ink-muted hover:border-border-strong hover:text-ink h-auto gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium"
                  disabled={current === null || current.id === "" || actions.openFolderBusy}
                  onClick={() => {
                    if (current === null || current.id === "") {
                      return;
                    }
                    void actions.openFolder(current.id);
                  }}
                  size="xs"
                  variant="outline"
                >
                  <Folder data-icon="inline-start" size={12} />
                  打开目录
                </Button>
              </Hint>
              {firstImage !== undefined && firstImage.localPath !== "" && (
                <div className="flex items-center gap-2">
                  <Hint
                    label="下载本次执行实际用到的工作流 JSON（含当时的节点与参数，工作流模板后续改动也不影响复现）"
                    wrap
                  >
                    <Button
                      className="border-border text-ink-muted hover:border-border-strong hover:text-ink h-auto rounded-lg px-2.5 py-1.5 text-xs font-medium"
                      disabled={actions.downloading}
                      onClick={() => {
                        if (current === null || current.id === "") {
                          return;
                        }
                        void actions.downloadWorkflow(current.id);
                      }}
                      size="xs"
                      variant="outline"
                    >
                      下载工作流
                    </Button>
                  </Hint>
                  <Hint label={sourceLabel}>
                    <span className="bg-subtle text-ink-muted text-3xs hidden rounded px-1.5 py-0.5 sm:inline">
                      {sourceLabel}
                    </span>
                  </Hint>
                </div>
              )}
              <Button
                aria-label="关闭"
                className="text-ink-muted hover:text-ink-bright"
                onClick={onClose}
                size="icon-sm"
                variant="ghost"
              >
                <X data-icon="inline-start" size={16} />
              </Button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            {detailLoading ? (
              /* 骨架屏（ISSUE #4749）：与产物图网格同形的占位块。 */
              <div
                aria-label="加载中"
                className="grid grid-cols-2 gap-3 sm:grid-cols-3"
                role="status"
              >
                {[0, 1, 2].map((i) => (
                  <Skeleton className="aspect-square rounded-xl" key={i} />
                ))}
              </div>
            ) : current ? (
              <div className="flex flex-col gap-5">
                {current.images.length > 0 ? (
                  <>
                    <div className="flex items-center gap-2">
                      <p className="text-ink-muted text-[13px] font-semibold">产物</p>
                      <span className="text-ink-fainter text-2xs ml-auto">
                        {`${String(current.images.length)} 张`}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {current.images.map((img, index) => (
                        <div
                          className="group border-border-subtle relative overflow-hidden rounded-xl border"
                          key={img.localPath}
                        >
                          {/* 任务详情里的每一张产物都可以点开看大图（原始大小 /
 缩放 / 拖拽平移）—— 缩略图是方形的`object-cover`，
 看不到整张图，此前也没有任何放大入口。视频仍按视频
 渲染（`ViewableImage` 的查看器只服务图片）。 */}
                          {isVideo(img.localPath) ? (
                            <MediaThumbnail
                              alt=""
                              autoPlay
                              className="h-44 w-full object-cover"
                              loop
                              src={img.localPath}
                            />
                          ) : (
                            <ViewableImage
                              alt="任务产物"
                              className="h-44 w-full object-cover"
                              label={`任务产物 ${index + 1}`}
                              src={img.localPath}
                            />
                          )}
                          <a
                            className="bg-surface-2 text-ink hover:bg-surface-2 text-2xs absolute top-2 right-2 rounded px-2 py-0.5 opacity-0 transition-opacity group-hover:opacity-100"
                            download
                            href={img.localPath}
                          >
                            {isVideo(img.localPath) ? "下载视频" : "下载"}
                          </a>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-ink-muted text-sm">该任务没有生成图像。</p>
                )}

                {/* 提示词与「生成参数」（种子 / 步数 / CFG）都走下面的参数块：
 提示词本来就是工作流的 IO 参数（工坊发起时是「工坊参数」），
 种子这类也一样 —— 单独再摆一份只会与参数表重复，而那份卡片
 还会把种子从参数表里过滤掉（用户实测：「参数乱糟糟的」）。 */}

                {current.error !== undefined && current.error !== null && current.error !== "" && (
                  <div className="bg-destructive/10 text-destructive rounded-lg p-2.5 text-xs">
                    错误：{current.error}
                  </div>
                )}

                {/* 工坊参数：工坊对外值（提示词 / 反向 / 首尾帧 / 帧数）单独
 摆一块 —— 它们不是工作流的 IO 端口，混在同一张表里会让
 「哪些是工坊给的、哪些是工作流收的」分不清。 */}
                {workshopParams.length > 0 && (
                  <div>
                    <p className="text-ink-muted mb-2.5 text-[13px] font-semibold">工坊参数</p>
                    <KeyValueRows
                      className="border-border rounded-xl"
                      items={workshopParams.map((row) => ({
                        id: row.id,
                        key: row.label,
                        value:
                          row.value === undefined ? (
                            <span className="text-ink-fainter">未提供</span>
                          ) : isPromptParamRow(row.id) ? (
                            /* 提示词定高滚动（ISSUE #4665）：长提示词不再把弹窗拉长。 */
                            <PromptValueCell text={kvValueText(row.value)} />
                          ) : (
                            kvValueText(row.value)
                          ),
                        title: row.label,
                      }))}
                      keyClassName="bg-canvas text-ink-muted w-56 max-w-none px-4 py-3.5 font-sans text-xs font-medium"
                      keyWrap
                      layout="table"
                      mono={false}
                      valueClassName="text-ink px-4 py-3.5 text-[12.5px]"
                    />
                  </div>
                )}

                {hasParams && (
                  <div>
                    <p className="text-ink-muted mb-2.5 text-[13px] font-semibold">工作流参数</p>

                    {paramRows.length > 0 && (
                      <KeyValueRows
                        className="border-border rounded-xl"
                        items={paramRows.map((row) => ({
                          id: row.id,
                          /* 显示工作流 IO 的作者标签（「prompt」而不是
                             `replace`）；查不到标签时它自己就是 pin 名。 */
                          key: row.label,
                          value:
                            row.value === undefined ? (
                              <span className="text-ink-fainter">未提供</span>
                            ) : (
                              <span className="inline-flex flex-col items-start gap-1">
                                {/* 提示词同样定高滚动（ISSUE #4665）：按 IO 作者
                                    标签也能识别（`replace` 的标签是 `prompt`）。 */}
                                {isPromptParamRow(row.id, row.name, row.label) ? (
                                  <PromptValueCell text={kvValueText(row.value)} />
                                ) : (
                                  kvValueText(row.value)
                                )}
                                {/* 没有提交值时这一行是工作流 IO 的默认值，标注出来
                                    免得被误读成「本次传了这个值」。 */}
                                {row.source === "default" ? (
                                  <span className="bg-subtle text-ink-fainter text-2xs rounded px-1.5 py-0.5">
                                    默认值
                                  </span>
                                ) : null}
                              </span>
                            ),
                          /* 悬停补上原始 pin 名：排查问题 / 对 ComfyUI 报错时
                             用的是程序名，作者改的名字对不上。 */
                          title: `${row.label}（${row.name}）`,
                        }))}
                        keyClassName="bg-canvas text-ink-muted w-56 max-w-none px-4 py-3.5 font-sans text-xs font-medium"
                        keyWrap
                        layout="table"
                        mono={false}
                        valueClassName="text-ink px-4 py-3.5 text-[12.5px]"
                      />
                    )}

                    {topLevelEntries.length > 0 && (
                      <Disclosure
                        className="border-border bg-canvas-deep text-ink-muted hover:text-ink-strong h-11 rounded-xl border px-4 text-[12.5px] font-medium"
                        marker="caret"
                        trigger={`原始 JSON · ${
                          topLevelEntries.length + (paramRows.length ? 1 : 0)
                        } 个字段`}
                      >
                        <pre className="border-border-subtle text-ink-faint text-2xs max-w-full border-t p-3 break-all whitespace-pre-wrap">
                          {JSON.stringify(Object.fromEntries(topLevelEntries), null, 2)}
                        </pre>
                      </Disclosure>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-ink-muted text-sm">未找到任务。</p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
