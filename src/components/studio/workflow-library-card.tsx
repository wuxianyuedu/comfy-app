"use client";

import React from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/ui/Icon";
import { MultiModeSelect } from "@/components/studio/ui/MultiModeSelect";
import { WorkflowIOThumb } from "./workflow-library-helpers";
import type { WorkflowRow } from "./workflow-library-helpers";

export interface WorkflowCardProps {
  w: any;
  dragOverCardId: string | null;
  onCardDragOver: (e: any, id: any) => void;
  onCardDragLeave: (e: any, id: any) => void;
  onCardDrop: (e: any, id: any) => void | Promise<void>;
  isTechnicalName: (name: any) => boolean;
  normalizeTaskType: (t: any) => string;
  patchModes: (...args: any[]) => void;
  deriveFormatFlags: (row: any) => any;
  deriveSyncFlags: (row: any) => any;
  resyncWorkflow: (...args: any[]) => void;
  resyncBusy: string | null;
  toast: any;
  assigningId: string | null;
  patchModelTags: (...args: any[]) => void;
  setAssignRect: (r: any) => void;
  setAssigningId: (id: any) => void;
  ago: (iso: any) => string;
  onUse?: (...args: any[]) => void;
  downloadJson: (...args: any[]) => void;
  bundleBusy: string | null;
  setEditingId: (id: any) => void;
  setSourceFor: (id: any) => void;
  assignRect: any;
  setPendingDelete: (id: any) => void;
  modelTags: { id: string; name: string; count: number }[];
}

export const WorkflowCard = React.memo(function WorkflowCard(props: WorkflowCardProps) {
  const {
    w,
    dragOverCardId,
    onCardDragOver,
    onCardDragLeave,
    onCardDrop,
    isTechnicalName,
    normalizeTaskType,
    patchModes,
    deriveFormatFlags,
    deriveSyncFlags,
    resyncWorkflow,
    resyncBusy,
    toast,
    assigningId,
    patchModelTags,
    setAssignRect,
    setAssigningId,
    ago,
    onUse,
    downloadJson,
    bundleBusy,
    setEditingId,
    setSourceFor,
    assignRect,
    setPendingDelete,
    modelTags,
  } = props;
  const paramCount = (() => {
    const io = (w.workflowIO ?? {}) as Record<string, { direction?: string }>;
    return Object.values(io).filter((entry) => entry && entry.direction === "input").length;
  })();
  return (
    <div
      key={w.id}
      data-workflow-id={w.id}
      data-card-id={w.id}
      className={`group relative flex flex-col rounded-2xl border bg-white/[0.02] p-4 transition-all hover:border-violet-500/30 hover:bg-white/[0.04] ${
        dragOverCardId === w.id
          ? "border-cyan-400/70 ring-2 ring-cyan-400/40 shadow-[0_0_0_4px_rgba(34,211,238,0.12)]"
          : "border-white/[0.06]"
      }`}
      onDragOver={(event) => onCardDragOver(event, w)}
      onDragLeave={(event) => onCardDragLeave(event, w)}
      onDrop={(event) => void onCardDrop(event, w)}
    >
      {/* 2026-08-12 R76: drag-to-upgrade overlay. Pointer-events-none so the
          drop handler still fires on the card; only lights up when this card
          is the actual drag target. */}
      {dragOverCardId === w.id && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center rounded-2xl bg-cyan-500/[0.08] backdrop-blur-[1px]">
          <Icon name="upload" size={22} className="mb-1 text-cyan-300" />
          <p className="text-[12px] font-medium text-cyan-100">拖到这里升级为真实 API</p>
          <p className="mt-0.5 text-[10px] text-cyan-200/70">rawJson 保留 · 仅替换 graph</p>
        </div>
      )}
      {/* 2026-08-16 R-ardot85: 工作流标题上移到预览之上 + outer click 拆除。
          卡片背景不再直接进入 WorkflowCanvasEditor，编辑入口只剩 footer
          中的「编辑」按钮（紫字）。原 `cursor-pointer` + `onClick={() =>
          setEditingId(w.id)}` 已经删除，避免误触开大画布。 */}
      <h3
        className={`mb-2 break-words text-sm font-semibold leading-snug text-gray-100 ${
          isTechnicalName(w.name) ? "font-mono" : ""
        }`}
        style={{ color: "#F4F4F8" }}
        title={w.name}
      >
        {w.name}
      </h3>
      {/* 2026-08-16 R-ardot95: the IO chip strip doubles as a secondary
          editor-entry trigger.  R-ardot85 deliberately removed the
          card-wide click to prevent accidental opens of the canvas
          editor — but the IO preview is what authors look at first when
          scanning a card, so clicking anywhere in that area should
          also enter the editor (same behaviour as the footer "编辑"
          button).  The whole 80px preview region — including the empty
          gradient padding around the chips — is now the click target,
          with a soft hover state so the affordance is obvious. */}
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setEditingId(w.id);
        }}
        className="group/io relative mb-3 flex h-20 w-full items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-violet-500/10 to-sky-500/10 text-left transition-colors hover:from-violet-500/15 hover:to-sky-500/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/40"
        title="点击进入工作流编辑器"
      >
        {(() => {
          const ioCount = w.workflowIO ? Object.keys(w.workflowIO).length : 0;
          if (ioCount > 0) return <WorkflowIOThumb io={w.workflowIO} />;
          /* 2026-08-12 R70-1: 未配置 IO 时预览区留白，不再渲染 graph 的
           * bezier 缩略图或 shuffle 占位图标，避免「已配置」的误导观感。 */
          return null;
        })()}
      </button>
      <div className="flex flex-wrap items-center gap-1.5">
        {/* 2026-08-13 R* v1: 多模式 chip + +N pill。点击主 chip 或 +N pill
            都开同一多选 popover：搜索/分类勾选/取消·保存。
            主 chip 颜色按 defaultMode 的 category 上色（image=violet /
            video=sky / audio=amber），多出一律走紫底 8% 弱化占位。
            R-ardot87 (2026-08-16): 工作流初始导入不再自动推断类型（用户
            手动设过的才记录），所以这里**永远渲染** chip —— 旧逻辑在
            `effModes.length === 0` 时直接 return null，结果新导入的工作
            流卡片没有入口点让用户选类型。现在 modes 为空时显示「未选」chip
            （MultiModeSelect 内部已处理空态：title "未选 · "），点开就
            是 popover，用户挑完保存后变正常 chip。 */}
        {(() => {
          const effMode = normalizeTaskType(w.taskType ?? "");
          const effModes =
            Array.isArray(w.modes) && w.modes.length > 0
              ? w.modes
              : effMode
                ? [effMode]
                : [];
          const defaultMode =
            w.defaultMode && effModes.includes(w.defaultMode)
              ? w.defaultMode
              : effModes[0] ?? "";
          return (
            <span
              onClick={(event) => event.stopPropagation()}
              title={
                effModes.length === 0
                  ? "点击选择工作流类型（未选）"
                  : "点击管理此工作流支持的模式（多选）"
              }
            >
              <MultiModeSelect
                modes={effModes}
                defaultMode={defaultMode}
                onChange={(ms, def) => void patchModes(w.id, ms, def)}
              />
            </span>
          );
        })()}
        <span className="rounded-md bg-white/10 px-2 py-0.5 text-[11px] text-gray-400">
          {paramCount} 个参数位
        </span>
        {/* API / RAW / ⚠仅RAW 三态徽章（2026-08-09）：
            - hasApi ⇔ graph 实际可执行；没有 graph 时不显示 API。
            - RAW 仅作为「额外保留了原始 UI 格式」的提示，与可用性无关。
            - !hasApi && hasRaw 时加 ⚠ 仅 RAW + ring ring-red-500/30，
              明确告知「此工作流不可用」并给出后续导出指引。
            - apiOrigin === "derived" 时 API 徽章旁挂「派生」角标。 */}
        {(() => {
          const { hasApi, hasRaw, apiOrigin } = deriveFormatFlags(w);
          return (
            <>
              {hasApi && (
                <span
                  className="flex items-center gap-1 rounded-md bg-sky-500/15 px-2 py-0.5 text-[11px] font-medium text-sky-300"
                  title={
                    apiOrigin === "derived"
                      ? "API 格式：由原始 (RAW) 工作流自动转换而来的派生 API，用于执行。节点坐标与连接已自动构造。"
                      : "API 格式：你从 ComfyUI 的「导出(API 格式)」拿到的可执行格式（graph）。"
                  }
                >
                  API
                  {apiOrigin === "derived" && (
                    <span
                      className="rounded bg-sky-500/25 px-1 text-[9px] font-semibold uppercase tracking-wide text-sky-200"
                      title="派生 · 由 RAW 自动转换，并非来自 ComfyUI 的 API 格式导出"
                    >
                      派生
                    </span>
                  )}
                </span>
              )}
              {hasRaw && (
                <span
                  className="rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-300"
                  title="原始格式（可选，保留节点坐标）"
                >
                  RAW
                </span>
              )}
              {!hasApi && hasRaw && (
                <span
                  className="rounded-md bg-red-500/15 px-2 py-0.5 text-[11px] font-semibold text-red-300 ring-1 ring-red-500/30"
                  title="仅有原始 UI 格式，graph 为空。需在 ComfyUI 中右键 → Save (API Format) 重新导出后再使用"
                >
                  ⚠ 仅 RAW
                </span>
              )}
            </>
          );
        })()}
        {(w.source ?? (w.sourcePath ? "local" : "online")) === "local" ? (
          <span
            className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300"
            title={`本地工作流 · 已连接文件：\n${w.sourcePath}\n修改保存后刷新即可同步`}
          >
            本地
          </span>
        ) : (
          <span
            className="rounded-md bg-white/10 px-2 py-0.5 text-[11px] font-medium text-gray-400"
            title="在线工作流 · 粘贴/API 导入，保存在数据库"
          >
            在线
          </span>
        )}
        {/* 2026-08-10 R16: manual-sync chip.
            - dirty   → amber 圆形 dot + 「↻ 文件已修改」chip (clickable);
            - missing → red 圆形 dot + 「📁 文件已不存在」chip (read-only);
            - otherwise nothing. The chip doubles as the entry point into
            the resyncWorkflow handler below. */}
        {(() => {
          const { dirty, missing } = deriveSyncFlags(w);
          if (dirty) {
            return (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  void resyncWorkflow(w.id, w.name);
                }}
                disabled={resyncBusy === w.id}
                className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-200 transition-colors hover:bg-amber-500/25 disabled:opacity-60"
                title="磁盘文件自上次同步后已改动，点击以最新文件内容覆盖当前 DB 行"
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300 shadow-[0_0_6px_rgba(251,191,36,0.7)]" />
                {resyncBusy === w.id ? "同步中…" : "↻ 文件已修改"}
              </button>
            );
          }
          if (missing) {
            return (
              <span
                className="inline-flex items-center gap-1 rounded-md bg-red-500/15 px-2 py-0.5 text-[11px] font-medium text-red-300"
                title={`磁盘文件已不存在：\n${w.sourcePath ?? ""}\n请检查路径或重新载入`}
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-300" />
                📁 文件已不存在
              </span>
            );
          }
          // R-ardot105 (2026-08-17): the row was just auto-relinked to a
          // renamed file this refresh.  Surface a soft confirmation chip so
          // the move is visible even after the toast auto-dismisses.  The
          // link is healthy again, so no action is offered.
          if (w.diskRenamed && w.diskRenamedTo) {
            return (
              <span
                className="inline-flex items-center gap-1 rounded-md bg-violet-500/15 px-2 py-0.5 text-[11px] font-medium text-violet-200"
                title={`已在磁盘上检测到文件改名，已自动重新链接：\n${w.diskRenamedTo}`}
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-violet-300" />
                已重新链接
              </span>
            );
          }
          return null;
        })()}
        {/* 2026-08-10 R13: SourceRootChip removed from the chip strip.
            The directory this row lives under is now part of the
            RootGroupHeader rendered above the card in the local tab;
            repeating it here would be redundant. */}

        {/* 2026-08-15 模型标签 chips + 「＋」绑定 */}
        {(() => {
          const cur = ((w as any).modelTags as string[] | undefined) ?? [];
          const open = assigningId === w.id;
          const toggle = (name: string) => {
            const next = cur.includes(name)
              ? cur.filter((cur) => cur !== name)
              : [...cur, name];
            void patchModelTags(w.id, next);
          };
          return (
            <span
              className="relative inline-flex items-center gap-1"
              onClick={(event) => event.stopPropagation()}
            >
              {cur.map((mt) => (
                <span
                  key={mt}
                  className="rounded-md bg-fuchsia-500/15 px-2 py-0.5 text-[11px] font-medium text-fuchsia-200"
                >
                  {mt}
                </span>
              ))}
              <button
                type="button"
                onClick={(event) => {
                  const r = (event.currentTarget as HTMLButtonElement).getBoundingClientRect();
                  setAssignRect({ top: r.bottom + 6, left: r.left, width: r.width });
                  setAssigningId(open ? null : w.id);
                }}
                className="rounded-md border border-white/15 px-1.5 py-0.5 text-[11px] text-gray-300 hover:bg-white/10"
                title="绑定 / 解绑模型标签"
              >
                ＋
              </button>
            </span>
          );
        })()}
      </div>
      <p className="mt-1 text-xs font-medium text-gray-400">{ago(w.createdAt)}</p>
      <div className="mt-3 space-y-2">
        {(() => {
          const { usable } = deriveFormatFlags(w);
          if (usable) {
            return (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onUse?.(w.id, { name: w.name, taskType: w.taskType });
                }}
                className="w-full rounded-lg bg-violet-500/90 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-violet-500"
                title="跳到画布并放置工作流节点"
              >
                使用 →
              </button>
            );
          }
          return (
            <button
              type="button"
              disabled
              className="w-full cursor-not-allowed rounded-lg bg-white/[0.05] px-3 py-2 text-xs font-semibold text-gray-500"
              title="此工作流 graph 为空，需要在 ComfyUI 中右键 → Save (API Format) 重新导出后才能使用"
            >
              不可用 ↗
            </button>
          );
        })()}
        <div className="flex items-center gap-2.5">
          {/* 2026-08-10 R16: explicit "↻ 同步" entry point.  Renders
              only when the row is locally dirty (disk mtime > DB mtime).
              The amber chip in the strip is the *status*; this button is
              the *action* and stays even when the user collapsed the
              chip visually by accident. */}
          {deriveSyncFlags(w).dirty && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                void resyncWorkflow(w.id, w.name);
              }}
              disabled={resyncBusy === w.id}
              className="text-xs font-medium text-amber-200 transition-colors hover:text-amber-100 disabled:opacity-60"
              title="把磁盘上最新文件内容写回数据库（不改动磁盘文件）"
            >
              {resyncBusy === w.id ? "同步中…" : "↻ 同步"}
            </button>
          )}
          {/* 2026-08-11 R37: 查看源文件按钮 — SourceModal 一直存在却从未挂
              触发按钮，这里补上。点开弹出只读 modal，可切 API/RAW tab、
              复制或下载该 workflow 的 JSON 文件。放在「编辑」之前作为最
              轻的「只读 view」动作。
              2026-08-11 R38: all four footer buttons switched from
              `font-medium` (which inherited 16px from the card body) to
              `text-xs font-medium` (12px).  The card title is `text-sm
              font-semibold` (14px/600) — without the override the four
              action buttons outweighed it visually because they shared
              the same pixel size and added color noise.  `gap-3` →
              `gap-2.5` to tighten spacing for the smaller font. */}
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setSourceFor({ id: w.id, name: w.name });
            }}
            className="text-xs font-medium text-sky-300 transition-colors hover:text-sky-200"
            title="查看工作流文件内容（API / RAW 两种 JSON）"
          >
            查看
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setEditingId(w.id);
            }}
            className="text-xs font-medium text-violet-300 transition-colors hover:text-violet-200"
            title="在画布中编辑输入输出端口"
          >
            编辑
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setPendingDelete({ id: w.id, name: w.name });
            }}
            className="text-xs font-medium text-gray-300 transition-colors hover:text-red-300"
          >
            删除
          </button>
          {/* 2026-08-11 R38: download was a single `下载合并包` button
              producing a `{ api, raw, name, taskType }` packed blob.
              User feedback — too coarse; users want to download ONE
              format at a time.  Split into `下载API` + `下载RAW`; the
              RAW button disables itself when the row has no rawJson
              (`hasRaw === false` from `deriveFormatFlags`).  Filename
              pattern: `{name}.api.json` / `{name}.raw.json`. */}
          {(() => {
            const { hasRaw } = deriveFormatFlags(w);
            return (
              <>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    void downloadJson(w.id, w.name, "api");
                  }}
                  disabled={bundleBusy === w.id}
                  className="text-xs font-medium text-emerald-300 transition-colors hover:text-emerald-200 disabled:opacity-50"
                  title="下载 API 格式 JSON（即 graph，可直接执行）"
                >
                  {bundleBusy === w.id ? "下载中…" : "下载API"}
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    void downloadJson(w.id, w.name, "raw");
                  }}
                  disabled={bundleBusy === w.id || !hasRaw}
                  className="text-xs font-medium text-emerald-300 transition-colors hover:text-emerald-200 disabled:opacity-40"
                  title={hasRaw ? "下载原始 workflow JSON（保留节点坐标）" : "该工作流未保存 RAW 格式"}
                >
                  下载RAW
                </button>
              </>
            );
          })()}
        </div>
        {/* 2026-08-15 模型标签绑定 popover（portal 到 body，逃出卡片/滚动裁剪） */}
        {assigningId === w.id && assignRect && createPortal(
          (() => {
            const cur = ((w as any).modelTags as string[] | undefined) ?? [];
            const toggle = (name: string) => {
              const next = cur.includes(name)
                ? cur.filter((cur) => cur !== name)
                : [...cur, name];
              void patchModelTags(w.id, next);
            };
            return (
              <>
                <div
                  className="fixed inset-0 z-[90]"
                  onClick={() => {
                    setAssigningId(null);
                    setAssignRect(null);
                  }}
                />
                <div
                  className="fixed z-[91] w-56 rounded-xl border border-white/10 bg-[#1b1b24] p-2 shadow-2xl"
                  style={{ top: assignRect.top, left: assignRect.left }}
                >
                  <div className="mb-1 px-1 text-[11px] font-medium text-gray-400">绑定模型标签</div>
                  {modelTags.length === 0 && (
                    <div className="px-2 py-1 text-[11px] text-gray-500">先到「管理模型」添加标签</div>
                  )}
                  <div className="max-h-44 overflow-y-auto">
                    {modelTags.map((modelTag) =>
{
                      const checked = cur.includes(modelTag.name);
                      return (
                        <label
                          key={modelTag.id}
                          className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs text-gray-200 hover:bg-white/5"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggle(modelTag.name)}
                            className="accent-fuchsia-500"
                          />
                          <span className="truncate">{modelTag.name}</span>
                        </label>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setAssigningId(null);
                      setAssignRect(null);
                    }}
                    className="mt-1.5 w-full rounded-md bg-white/5 py-1 text-[11px] text-gray-300 hover:bg-white/10"
                  >
                    完成
                  </button>
                </div>
              </>
            );
          })(),
          document.body
        )}
      </div>
    </div>
  );

});
