import { Folder, X } from "lucide-react";

import { MediaThumbnail } from "~/components/studio/ui/MediaThumbnail";
import { isVideo } from "~/lib/media/media";
import {
  fetchTaskWorkflow,
  openTaskFolder,
} from "~/lib/history-detail-actions";

import {
  deriveGenValues,
  deriveParamRows,
  derivePrompt,
} from "./history-detail-derive";
import { useHistoryDetailActions } from "./hooks/use-history-detail-actions";
import type { TaskDetail } from "./history-types";
import { overlayClass } from "~/lib/full-screen-layer";
import { Button } from "~/components/ui/button";

interface HistoryDetailModalProps {
  detailId: string | null;
  detail: TaskDetail | null;
  detailLoading: boolean;
  /** 工作流默认值兜底（来自 /api/tasks/[id] 的 workflowHints 子字段）。 */
  workflowHints: unknown;
  onClose: () => void;
}

/**
 * 历史任务详情弹窗 —— 纯展示层（规范 17 §17.2 第③层）。
 * 图片网格 + 提示词 + 生成参数卡 + 参数表 + 打开目录 / 下载工作流。
 *
 * 数据派生在 history-detail-derive.ts，动作在 hooks/use-history-detail-actions.ts，
 * 网络在 lib/history-detail-actions.ts；本文件只做排版与事件上抛。
 */
export function HistoryDetailModal({
  detailId,
  detail,
  detailLoading,
  workflowHints,
  onClose,
}: HistoryDetailModalProps) {
  const actions = useHistoryDetailActions({
    openFolder: openTaskFolder,
    fetchWorkflow: fetchTaskWorkflow,
  });

  if (!detailId) return null;
  // 局部 const 让闭包 / IIFE 内的空值窄化在 TS 中稳定成立。
  const current = detail;
  const { showPrompt, prompt, negativePrompt } = derivePrompt(current);
  const genValues = deriveGenValues(current, workflowHints);
  const {
    rows: paramRows,
    topLevelEntries,
    hasAny: hasParams,
  } = deriveParamRows(current);
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

  return (
    <div
      className={overlayClass(
        "modal",
        "bg-canvas-deep z-90 flex items-center justify-center p-4 backdrop-blur-sm sm:p-6 dark:bg-black/80",
      )}
      onClick={onClose}
    >
      <div
        className="border-border bg-node flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-border-subtle relative flex items-center justify-between gap-3 border-b px-5 py-3">
          <h3 className="u-title">任务详情</h3>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="xs"
              disabled={!current?.id || actions.openFolderBusy}
              onClick={() => {
                if (!current?.id) return;
                void actions.openFolder(current.id);
              }}
              className="border-border text-ink-strong hover:border-border-strong hover:text-ink h-auto gap-1.5 rounded-md px-2.5 py-1 text-[11px]"
              title="在系统文件管理器中打开本次生成的目录（图片 / 视频 / 音频 / workflow.json / manifest.json 都在这里）"
            >
              <Folder size={12} />
              打开目录
            </Button>
            {actions.folderPopover && (
              <div
                className="border-border bg-panel-deep absolute top-[52px] right-5 z-10 w-[min(440px,calc(100vw-40px))] rounded-lg border p-3 shadow-xl"
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
                    <X size={12} />
                  </Button>
                </div>
                {actions.folderPopover.helperMissing ? (
                  <div className="mb-2 rounded border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[10.5px] leading-relaxed text-amber-700 dark:text-amber-300">
                    未检测到 ComfyApp
                    助手，浏览器没有弹出「打开外部应用」确认框。
                    请双击运行项目内{" "}
                    <code className="text-amber-700 dark:text-amber-300">
                      scripts\install-comfyapp-helper.ps1
                    </code>{" "}
                    注册
                    <code className="text-amber-700 dark:text-amber-300">
                      {" "}
                      comfyapp://
                    </code>{" "}
                    协议（仅本机、无需管理员）， 或直接{" "}
                    <a
                      href="/api/helper/install"
                      className="underline hover:text-amber-700 dark:text-amber-300"
                    >
                      下载安装脚本
                    </a>
                    。
                  </div>
                ) : (
                  <div className="mb-2 rounded border border-emerald-500/20 bg-emerald-500/6 px-2.5 py-1.5 text-[10.5px] leading-relaxed text-emerald-700 dark:text-emerald-300/90">
                    若浏览器弹出「是否打开外部应用」，点击「打开」即可在资源管理器中打开该目录。
                  </div>
                )}
                <code className="bg-canvas-deep block rounded px-2.5 py-2 text-[11px] leading-relaxed break-all text-emerald-700 select-all dark:text-emerald-400">
                  {actions.folderPopover.path}
                </code>
                <div className="mt-2 flex flex-wrap justify-end gap-2">
                  <Button
                    variant="success"
                    size="xs"
                    onClick={() => void actions.copyPath()}
                    className="h-auto rounded-md px-2.5 py-1 text-[11px]"
                  >
                    📋 复制路径
                  </Button>
                </div>
              </div>
            )}
            {firstImage?.localPath && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="xs"
                  disabled={actions.downloading}
                  onClick={() => {
                    if (!current?.id) return;
                    void actions.downloadWorkflow(current.id);
                  }}
                  className="border-border text-ink-strong hover:border-border-strong hover:text-ink h-auto rounded-md px-2.5 py-1 text-[11px]"
                  title="下载本次执行实际用到的工作流 JSON（含当时的节点与参数，工作流模板后续改动也不影响复现）"
                >
                  下载工作流
                </Button>
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
              <X size={16} />
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {detailLoading ? (
            <p className="text-ink-muted text-sm">加载中…</p>
          ) : current ? (
            <div className="space-y-4">
              {current.images?.length > 0 ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {current.images.map((img) => (
                    <div
                      key={img.localPath}
                      className="group border-border-subtle relative overflow-hidden rounded-xl border"
                    >
                      <MediaThumbnail
                        src={img.localPath}
                        alt=""
                        className="aspect-square w-full object-cover"
                        autoPlay
                        loop
                      />
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

              {showPrompt && (
                <div>
                  <p className="text-ink-faint mb-1 text-xs font-semibold">
                    正向提示词
                  </p>
                  <p className="text-ink-strong text-sm break-words whitespace-pre-wrap">
                    {prompt}
                  </p>
                </div>
              )}
              {negativePrompt && (
                <div>
                  <p className="text-ink-faint mb-1 text-xs font-semibold">
                    反向提示词
                  </p>
                  <p className="text-ink-faint text-sm break-words whitespace-pre-wrap">
                    {negativePrompt}
                  </p>
                </div>
              )}

              {genValues.length === 0 ? (
                /* 空态说明：让用户一眼知道是工作流没暴露参数，不是系统 bug。 */
                <div className="border-border bg-card text-ink-muted rounded-lg border border-dashed px-3 py-2.5 text-xs">
                  本任务所用工作流未暴露常见生成参数（seed/steps/cfg
                  等在节点硬编码默认值中）。
                  如需查看完整参数，请展开下方的「原始 JSON」。
                </div>
              ) : (
                <div>
                  <p className="text-ink-faint mb-1 text-xs font-semibold">
                    生成参数
                  </p>
                  <div className="border-border-subtle bg-card grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg border p-3 sm:grid-cols-3">
                    {genValues.map((item) => (
                      <div key={item.label} className="flex flex-col gap-0.5">
                        <div className="flex items-baseline gap-2">
                          <span className="text-ink-muted shrink-0 text-[11px]">
                            {item.label}
                          </span>
                          <span className="text-ink-bright min-w-0 font-mono text-[12px] break-words">
                            {typeof item.value === "string" ||
                            typeof item.value === "number"
                              ? String(item.value)
                              : JSON.stringify(item.value)}
                          </span>
                        </div>
                        {item.hint && (
                          <span className="text-ink-muted/80 pl-0.5 text-[10px] leading-tight">
                            {item.hint}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                  {genValues.some((item) => item.hint) && (
                    <p className="text-ink-muted mt-1 text-[10px] leading-relaxed">
                      注：种子字段在 control_after_generate=randomize
                      时为默认值，非本次执行的真实种子。
                    </p>
                  )}
                </div>
              )}

              {current.error && (
                <div className="rounded-lg bg-red-500/10 p-2.5 text-xs text-red-700 dark:text-red-300">
                  错误：{current.error}
                </div>
              )}

              {hasParams && (
                <div>
                  <p className="text-ink-faint mb-1 text-xs font-semibold">
                    参数
                  </p>

                  {paramRows.length > 0 && (
                    <div className="border-border-subtle mb-2 overflow-hidden rounded-lg border">
                      <table className="w-full text-[11px]">
                        <tbody>
                          {paramRows.map((input, i) => (
                            <tr
                              key={
                                (input.nodeId ?? "?") +
                                ":" +
                                input.name +
                                ":" +
                                i
                              }
                              className="border-border-subtle border-b last:border-b-0"
                            >
                              <td
                                className="border-border-subtle bg-card w-[36%] max-w-[180px] shrink-0 truncate border-r px-2.5 py-1.5 align-top font-mono text-violet-700 dark:text-violet-300"
                                title={input.name}
                              >
                                {input.name}
                              </td>
                              <td className="text-ink-bright px-2.5 py-1.5 break-words">
                                {typeof input.value === "string"
                                  ? input.value
                                  : JSON.stringify(input.value)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {topLevelEntries.length > 0 && (
                    <details className="border-border-subtle bg-canvas-deep rounded-lg border">
                      <summary className="text-ink-muted hover:text-ink-strong cursor-pointer px-3 py-1.5 text-[11px] select-none">
                        原始 JSON ·{" "}
                        {topLevelEntries.length + (paramRows.length ? 1 : 0)}{" "}
                        个字段
                      </summary>
                      <pre className="border-border-subtle text-ink-faint max-w-full border-t p-3 text-[11px] break-all whitespace-pre-wrap">
                        {JSON.stringify(
                          Object.fromEntries(topLevelEntries),
                          null,
                          2,
                        )}
                      </pre>
                    </details>
                  )}
                </div>
              )}
            </div>
          ) : (
            <p className="text-ink-muted text-sm">未找到任务。</p>
          )}
        </div>
      </div>
    </div>
  );
}
