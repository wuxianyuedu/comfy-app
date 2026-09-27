import { Folder, X } from "lucide-react";

import { Hint } from "~/components/ui/hint";
import { MediaThumbnail } from "~/components/ui/media-thumbnail";
import { ViewableImage } from "~/components/ui/image-viewer";
import { isVideo } from "~/lib/media/media";
import {
  fetchTaskWorkflow,
  openTaskFolder,
} from "~/lib/history-detail-actions";

import {
  deriveTaskOrigin,
  deriveWorkflowParams,
  deriveWorkshopParams,
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
import { zClass } from "~/lib/shell/overlay-z";

interface HistoryDetailModalProps {
  detailId: string | null;
  detail: TaskDetail | null;
  detailLoading: boolean;
  /** 本任务所用工作流的 IO 定义：参数可读名从它的`label` 查（任务行里只存了
   * pin 名）。工作流已被删除时是空表，参数名如实回落 pin 名。 */
  workflowIO: WorkflowIOMap;
  /** 模式契约注册表（只含用户改过的模式）：工坊参数按「任务模式 + 生效契约」枚举。
   * 为 null 时回落内置默认契约。 */
  modeContracts?: readonly ModeContract[] | null;
  onClose: () => void;
}

/**
 * 历史任务详情弹窗 —— 纯展示层（规范 17 §17.2 第③层）。
 * 图片网格 + 工坊参数（工坊发起时）+ 工作流参数 + 打开目录 / 下载工作流。
 *
 * **不再有「独立」的提示词块与「生成参数」卡**：它们显示的内容与参数表重复
 * （同一句提示词出现两次），而卡片只认一小撮硬编码键名，种子这类关键参数
 * 反而从参数表里被过滤掉。现在一切参数都按来源分块，名字取工作流 IO 的作者
 * 标签（`workflowIO`）。
 *
 * 数据派生在 history-detail-derive.ts，动作在 hooks/use-history-detail-actions.ts，
 * 网络在 lib/history-detail-actions.ts；本文件只做排版与事件上抛。
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
    openFolder: openTaskFolder,
    fetchWorkflow: fetchTaskWorkflow,
  });

  if (!detailId) return null;
  // 局部 const 让闭包 / IIFE 内的空值窄化在 TS 中稳定成立。
  const current = detail;
  /* 按来源分块：工坊发起的任务多摆一块「工坊参数」（工坊对外值），工作流直接
   * 发起的任务只有「工作流参数」—— 判据见`deriveTaskOrigin`。 */
  const origin = deriveTaskOrigin(current);
  const workshopParams =
    origin === "workshop"
      ? deriveWorkshopParams(
          current,
          current?.type ?? null,
          modeContracts,
          workflowIO,
        )
      : [];
  const {
    rows: paramRows,
    topLevelEntries,
    hasAny: hasParams,
  } = deriveWorkflowParams(current, workflowIO);
  const firstImage = Array.isArray(current?.images)
    ? current.images[0]
    : undefined;
  const snapSource = (
    current?.workflowSnapshot as { source?: string } | null | undefined
  )?.source;
  const sourceLabel =
    snapSource === "backfill"
      ? "历史记录回填快照"
      : snapSource === "execution"
        ? "执行时自动捕获的独立快照"
        : "磁盘回退快照";

  /* 关闭语义（Esc / 点遮罩 / 焦点锁与归还）交给`ui/dialog`：此前自绘遮罩 +
 手写`onClick` 关闭，Esc 没接、焦点不锁也不归还。 */
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        aria-label="任务详情"
        showCloseButton={false}
        className="bg-transparent p-0 ring-0"
        popupClassName="max-w-3xl"
      >
        <div className="border-border bg-node flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border">
          <div className="border-border-subtle relative flex items-center justify-between gap-3 border-b px-5 py-3">
            <h3 className="u-title">任务详情</h3>
            <div className="flex items-center gap-2">
              <Hint
                label="在系统文件管理器中打开本次生成的目录（图片 / 视频 / 音频 / workflow.json / manifest.json 都在这里）"
                wrap
              >
                <Button
                  variant="outline"
                  size="xs"
                  disabled={!current?.id || actions.openFolderBusy}
                  onClick={() => {
                    if (!current?.id) return;
                    void actions.openFolder(current.id);
                  }}
                  className="border-border text-ink-strong hover:border-border-strong hover:text-ink h-auto gap-1.5 rounded-md px-2.5 py-1 text-[11px]"
                >
                  <Folder data-icon="inline-start" size={12} />
                  打开目录
                </Button>
              </Hint>
              {actions.folderPopover && (
                <div
                  className={`border-border bg-panel-deep absolute top-[52px] right-5 ${zClass("popup")} w-[min(440px,calc(100vw-40px))] rounded-lg border p-3 shadow-xl`}
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-ink-strong text-[11px] font-medium">
                      📂 在资源管理器中打开
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={actions.dismissFolderPopover}
                      className="text-ink-muted hover:text-ink-bright"
                      aria-label="关闭"
                    >
                      <X data-icon="inline-start" size={12} />
                    </Button>
                  </div>
                  {actions.folderPopover.helperMissing ? (
                    <div className="border-warning/30 bg-warning/10 text-warning-strong mb-2 rounded border px-2.5 py-1.5 text-[10.5px] leading-relaxed">
                      未检测到 ComfyApp
                      助手，浏览器没有弹出「打开外部应用」确认框。
                      请双击运行项目内{""}
                      <code className="text-warning-strong">
                        scripts\install-comfyapp-helper.ps1
                      </code>
                      {""}
                      注册
                      <code className="text-warning-strong">
                        {""}
                        comfyapp://
                      </code>
                      {""}
                      协议（仅本机、无需管理员）， 或直接{""}
                      <a
                        href="/api/helper/install"
                        className="hover:text-warning-strong underline"
                      >
                        下载安装脚本
                      </a>
                      。
                    </div>
                  ) : (
                    <div className="border-success/20 bg-success/6 text-success-strong mb-2 rounded border px-2.5 py-1.5 text-[10.5px] leading-relaxed">
                      若浏览器弹出「是否打开外部应用」，点击「打开」即可在资源管理器中打开该目录。
                    </div>
                  )}
                  <code className="bg-canvas-deep text-success-strong block rounded px-2.5 py-2 text-[11px] leading-relaxed break-all select-all">
                    {actions.folderPopover.path}
                  </code>
                  <div className="mt-2 flex flex-wrap justify-end gap-2">
                    <Button
                      variant="success"
                      size="xs"
                      onClick={() => actions.copyPath()}
                      className="h-auto rounded-md px-2.5 py-1 text-[11px]"
                    >
                      📋 复制路径
                    </Button>
                  </div>
                </div>
              )}
              {firstImage?.localPath && (
                <div className="flex items-center gap-2">
                  <Hint
                    label="下载本次执行实际用到的工作流 JSON（含当时的节点与参数，工作流模板后续改动也不影响复现）"
                    wrap
                  >
                    <Button
                      variant="outline"
                      size="xs"
                      disabled={actions.downloading}
                      onClick={() => {
                        if (!current?.id) return;
                        void actions.downloadWorkflow(current.id);
                      }}
                      className="border-border text-ink-strong hover:border-border-strong hover:text-ink h-auto rounded-md px-2.5 py-1 text-[11px]"
                    >
                      下载工作流
                    </Button>
                  </Hint>
                  <span
                    className="bg-subtle text-ink-muted hidden rounded px-1.5 py-0.5 text-[10px] sm:inline"
                    title={sourceLabel}
                  >
                    {sourceLabel}
                  </span>
                </div>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onClose}
                className="text-ink-muted hover:text-ink-bright"
                aria-label="关闭"
              >
                <X data-icon="inline-start" size={16} />
              </Button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {detailLoading ? (
              <p className="text-ink-muted text-sm">加载中…</p>
            ) : current ? (
              <div className="gap-4">
                {current.images?.length > 0 ? (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {current.images.map((img, index) => (
                      <div
                        key={img.localPath}
                        className="group border-border-subtle relative overflow-hidden rounded-xl border"
                      >
                        {/* 任务详情里的每一张产物都可以点开看大图（原始大小 /
 缩放 / 拖拽平移）—— 缩略图是方形的`object-cover`，
 看不到整张图，此前也没有任何放大入口。视频仍按视频
 渲染（`ViewableImage` 的查看器只服务图片）。 */}
                        {isVideo(img.localPath) ? (
                          <MediaThumbnail
                            src={img.localPath}
                            alt=""
                            className="aspect-square w-full object-cover"
                            autoPlay
                            loop
                          />
                        ) : (
                          <ViewableImage
                            src={img.localPath}
                            alt="任务产物"
                            label={`任务产物 ${index + 1}`}
                            className="aspect-square w-full object-cover"
                          />
                        )}
                        <a
                          href={img.localPath}
                          download
                          className="bg-surface-2 text-ink hover:bg-surface-2 absolute right-2 bottom-2 rounded px-2 py-0.5 text-[11px] opacity-0 transition-opacity group-hover:opacity-100"
                        >
                          {isVideo(img.localPath) ? "下载视频" : "下载"}
                        </a>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-ink-muted text-sm">该任务没有生成图像。</p>
                )}

                {/* 提示词与「生成参数」（种子 / 步数 / CFG）都走下面的参数块：
 提示词本来就是工作流的 IO 参数（工坊发起时是「工坊参数」），
 种子这类也一样 —— 单独再摆一份只会与参数表重复，而那份卡片
 还会把种子从参数表里过滤掉（用户实测：「参数乱糟糟的」）。 */}

                {current.error && (
                  <div className="bg-destructive/10 text-destructive rounded-lg p-2.5 text-xs">
                    错误：{current.error}
                  </div>
                )}

                {/* 工坊参数：工坊对外值（提示词 / 反向 / 首尾帧 / 帧数）单独
 摆一块 —— 它们不是工作流的 IO 端口，混在同一张表里会让
 「哪些是工坊给的、哪些是工作流收的」分不清。 */}
                {workshopParams.length > 0 && (
                  <div>
                    <p className="text-ink-faint mb-1 text-xs font-semibold">
                      工坊参数
                    </p>
                    <KeyValueRows
                      layout="table"
                      className="mb-2"
                      keyClassName="text-ink-muted"
                      items={workshopParams.map((row) => ({
                        id: row.id,
                        key: row.label,
                        value:
                          row.value === undefined ? (
                            <span className="text-ink-fainter">未提供</span>
                          ) : (
                            kvValueText(row.value)
                          ),
                        title: row.label,
                      }))}
                    />
                  </div>
                )}

                {hasParams && (
                  <div>
                    <p className="text-ink-faint mb-1 text-xs font-semibold">
                      工作流参数
                    </p>

                    {paramRows.length > 0 && (
                      <KeyValueRows
                        layout="table"
                        className="mb-2"
                        keyClassName="text-primary-strong"
                        items={paramRows.map((row) => ({
                          id: row.id,
                          /* 显示工作流 IO 的作者标签（「宽高比」而不是
`aspect_ratio`）；查不到标签时它自己就是 pin 名。 */
                          key: row.label,
                          value: kvValueText(row.value),
                          /* 悬停补上原始 pin 名：排查问题 / 对 ComfyUI 报错时
 用的是程序名，作者改的名字对不上。 */
                          title: `${row.label}（${row.name}）`,
                        }))}
                      />
                    )}

                    {topLevelEntries.length > 0 && (
                      <Disclosure
                        marker="caret"
                        className="border-border-subtle bg-canvas-deep text-ink-muted hover:text-ink-strong rounded-lg border px-3 py-1.5 text-[11px]"
                        trigger={`原始 JSON · ${
                          topLevelEntries.length + (paramRows.length ? 1 : 0)
                        } 个字段`}
                      >
                        <pre className="border-border-subtle text-ink-faint max-w-full border-t p-3 text-[11px] break-all whitespace-pre-wrap">
                          {JSON.stringify(
                            Object.fromEntries(topLevelEntries),
                            null,
                            2,
                          )}
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
