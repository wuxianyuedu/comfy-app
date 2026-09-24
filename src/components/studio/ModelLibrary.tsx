"use client";

import { useState, type CSSProperties } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AuroraBackground } from "~/components/ui/aurora-background";
import { textHandler } from "~/lib/form-props";
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Spinner } from "~/components/ui/page-loading";
import { folderMeta, getFolderTooltip } from "~/lib/model-types";

import { useModelFolderConfig } from "./hooks/use-model-folder-config";
import { useModelLibrary } from "./hooks/use-model-library";
import {
  ALL_TYPES,
  type FolderConfigRow as FolderConfigRowData,
  type ModelRow,
  fmtSize,
} from "./model-library-config";
import { Dialog, DialogContent } from "~/components/ui/dialog";

/**
 * 工作室模型库 —— 视图层（规范 17 §17.2 第③层）。
 * 列表拉取与筛选在 hooks/use-model-library.ts，派生计算与常量在
 * model-library-config.ts。本文件只渲染；对外导出名与 props 保持不变。
 */
export function ModelLibrary() {
  const c = useModelLibrary();

  return (
    <div className="h-full overflow-y-auto">
      <AuroraBackground />
      <div className="mx-auto max-w-[1200px] px-4 py-8 sm:px-8 sm:py-10">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-title text-ink text-xl font-bold">模型库</h1>
            <p className="text-ink-muted mt-1 text-sm">
              本机 ComfyUI 可用模型，按扫描目录分类 ——
              每个目录即一种独立的模型类型。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => c.setConfigOpen(true)}
              className="border-border bg-subtle text-ink-bright hover:border-primary/40 hover:text-primary h-auto gap-1.5 rounded-lg px-3 py-2"
            >
              <Icon name="settings" size={16} />
              模型目录配置
            </Button>
            <input
              value={c.q}
              onChange={textHandler(c.setQ)}
              placeholder="搜索模型名称…"
              className="border-border bg-subtle text-ink-bright w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-violet-500/40 sm:w-64"
            />
          </div>
        </div>

        <div className="mb-5 flex flex-wrap gap-2">
          <FilterChip
            active={c.filter === ALL_TYPES}
            onClick={() => c.setFilter(ALL_TYPES)}
            label={`全部 (${c.models.length})`}
          />
          {c.typeChips.map(([t, count]) => {
            const meta = folderMeta(t);
            return (
              <FilterChip
                key={t}
                active={c.filter === t}
                onClick={() => c.setFilter(t)}
                label={`${meta.label} (${count})`}
              />
            );
          })}
        </div>

        {c.loading ? (
          <p className="text-ink-muted text-sm">加载中…</p>
        ) : c.filtered.length === 0 ? (
          <div className="border-border text-ink-muted grid min-h-[300px] place-items-center rounded-2xl border border-dashed">
            <div className="text-center">
              <p className="text-ink-strong text-lg font-medium">
                模型库还没有内容
              </p>
              <p className="mt-1 max-w-md text-sm">
                没启用任何模型目录时这里为空。打开「模型目录配置」勾选需要扫描的目录，重新扫描后即可在此查看。
              </p>
              <Button
                variant="primary"
                onClick={() => c.setConfigOpen(true)}
                className="mt-4 h-auto gap-1.5 rounded-lg px-4 py-2"
              >
                <Icon name="settings" size={16} />
                去配置目录
              </Button>
            </div>
          </div>
        ) : (
          // 紧凑列表 —— 每行是 [类型药丸][文件名][大小]。
          // 旧的卡片栅格（4 列 + 28px 占位图标 + 重复的 fileName）
          // 太重；对最终只是「一行文件名 + 大小」的这种负载，
          // N 行画廊可读性好得多。行数可能上探到三位数（LoRA/ckpt 混放），
          // 交给 ModelList 做定高虚拟滚动（量不到视口时退回整页渲染）。
          <ModelList items={c.filtered} />
        )}
      </div>

      {c.configOpen && (
        <ModelConfigModal
          onClose={() => {
            c.setConfigOpen(false);
            c.reload();
          }}
        />
      )}
    </div>
  );
}

const MODEL_ROW_H = 37; // px，单行（truncate 不换行）：py-2 + text-sm 行高 + 1px 分隔

/**
 * 模型文件列表 —— 定高虚拟滚动（规范 §2.6）。行数上探三位数时只渲染视口内的
 * 一段，DOM 数量恒定；量不到视口高度（jsdom 不做布局 / 首帧未测量）时退回
 * 整页渲染 —— 虚拟化是性能优化，绝不能变成「内容看不见」（同 LogPanel 口径）。
 */
function ModelList({ items }: { items: ModelRow[] }) {
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  // virtualizer 的读数（getVirtualItems/getTotalSize）只在本组件 render 内消费，
  // 不外传给被 memo 的子组件，不存在该规则担心的「跨组件陈旧 UI」风险，此告警对本用法是误报。
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollEl,
    estimateSize: () => MODEL_ROW_H,
    overscan: 12,
  });
  const measured = (scrollEl?.clientHeight ?? 0) > 0;

  return (
    <div
      ref={setScrollEl}
      role="list"
      aria-label="模型文件列表"
      className="border-border-subtle bg-card max-h-[70vh] overflow-auto rounded-xl border"
    >
      {measured ? (
        <div
          style={{
            height: virtualizer.getTotalSize(),
            position: "relative",
            width: "100%",
          }}
        >
          {virtualizer.getVirtualItems().map((vi) => {
            const m = items[vi.index];
            if (!m) return null;
            return (
              <ModelRowLine
                key={vi.key}
                model={m}
                isLast={vi.index === items.length - 1}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: vi.size,
                  transform: `translateY(${vi.start}px)`,
                }}
              />
            );
          })}
        </div>
      ) : (
        items.map((m, idx) => (
          <ModelRowLine
            key={m.id}
            model={m}
            isLast={idx === items.length - 1}
          />
        ))
      )}
    </div>
  );
}

function ModelRowLine({
  model,
  isLast,
  style,
}: {
  model: ModelRow;
  isLast: boolean;
  style?: CSSProperties;
}) {
  const meta = folderMeta(model.type);
  return (
    <div
      role="listitem"
      style={style}
      className={`group hover:bg-subtle flex items-center gap-3 px-3 py-2 transition-colors ${
        isLast ? "" : "border-border-subtle border-b"
      }`}
    >
      <span
        className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium ${meta.color}`}
      >
        {meta.label}
      </span>
      <span
        className="text-ink-bright) min-w-0 flex-1 truncate font-mono text-sm"
        title={model.fileName}
      >
        {model.fileName}
      </span>
      {!model.isAvailable && (
        <span
          className="bg-surface-2 text-ink-faint shrink-0 rounded-md px-1.5 py-0.5 text-[10px]"
          title="当前未在 ComfyUI 扫描结果中"
        >
          不可用
        </span>
      )}
      <span
        className="text-ink-muted shrink-0 text-xs tabular-nums"
        title="文件大小"
      >
        {fmtSize(model.fileSize)}
      </span>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <Button
      variant="ghost"
      size="xs"
      onClick={onClick}
      className={`h-auto rounded-full px-3 py-1.5 ${
        active
          ? "bg-primary-500/20 text-primary-strong hover:bg-primary-500/30"
          : "bg-subtle text-ink-faint hover:text-ink-bright"
      }`}
    >
      {label}
    </Button>
  );
}

/* ── 模型目录配置弹窗 ──
 * 呈现扫描器能访问的每个 ComfyUI 目录。每行的类型
 * 由目录名自动解析（精选查表 → 模糊匹配
 * → CHECKPOINT 兜底），所以用户只需启用 / 停用
 * 目录 —— 不用选类型。每行的「高级」面板让
 * 用户追加*额外*的 COMBO 字段类型（例如把该文件夹的文件
 * 额外暴露在另一个字段下）。 */
/**
 * 模型目录配置弹层 —— 视图层（规范 17 §17.2 第③层）。
 * 列表拉取、启用/停用/删除与重新扫描在 hooks/use-model-folder-config.ts。
 */
function ModelConfigModal({ onClose }: { onClose: () => void }) {
  const c = useModelFolderConfig();

  /* 关闭语义（Esc / 点遮罩 / 焦点锁与归还）交给 `ui/dialog`：此前把遮罩写成
     一个**兄弟 div** 单独接 `onClick`（与全库其余弹窗的「外层带 onClick +
     内层 stopPropagation」又是一种写法），Esc 没接、焦点不锁也不归还。 */
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        aria-label="模型库"
        showCloseButton={false}
        className="bg-transparent p-0 ring-0"
        popupClassName="max-w-3xl"
      >
        <div className="border-border bg-panel relative flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border shadow-2xl shadow-black/25 dark:shadow-black/50">
          {/* header */}
          <div className="border-border-subtle flex items-start justify-between border-b px-5 py-4">
            <div>
              <h2 className="text-ink flex items-center gap-2 text-base font-semibold">
                <Icon
                  name="foldertree"
                  size={18}
                  className="text-violet-700 dark:text-violet-400"
                />
                模型目录配置
              </h2>
              <p className="text-ink-muted mt-0.5 text-xs">
                勾选需要扫描的 ComfyUI
                模型目录；每个目录即独立模型类型（目录名即类型名）。禁用后该目录模型将从模型库与画布
                COMBO 下拉中隐藏。
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              className="text-ink-muted hover:bg-surface-2 hover:text-ink-bright rounded-lg"
              aria-label="关闭"
            >
              <Icon name="close" size={18} />
            </Button>
          </div>

          {/* status + scan */}
          <div className="border-border-subtle flex items-center justify-between gap-3 border-b px-5 py-3">
            <div className="flex items-center gap-3 text-xs">
              {c.comfyReachable ? (
                <span className="text-emerald-700 dark:text-emerald-400">
                  ● ComfyUI 已连接 · 共 {c.totalCount} 个目录
                </span>
              ) : (
                <span className="text-amber-700 dark:text-amber-400">
                  ● ComfyUI 未连接
                </span>
              )}
              <span className="text-ink-muted">
                · 已启用 {c.enabledRows.length} 个
              </span>
              {c.err && (
                <span className="text-rose-700 dark:text-rose-400">
                  {c.err}
                </span>
              )}
            </div>
            <Button
              variant="outline"
              size="xs"
              onClick={() => void c.rescan()}
              disabled={c.scanning}
              className="border-border bg-subtle text-ink-bright hover:border-primary/40 hover:text-primary h-auto gap-1.5 rounded-lg px-3 py-1.5"
            >
              {c.scanning ? (
                <Spinner className="size-3.5" />
              ) : (
                <Icon name="shuffle" size={14} />
              )}
              {c.scanning ? "扫描中…" : "重新扫描"}
            </Button>
          </div>

          {/* search + filter */}
          <div className="flex items-center gap-3 px-5 py-3">
            <input
              value={c.q}
              onChange={textHandler(c.setQ)}
              placeholder="搜索目录名…"
              className="border-border bg-subtle text-ink-bright flex-1 rounded-lg border px-3 py-2 text-sm outline-none focus:border-violet-500/40"
            />
            <label className="text-ink-faint flex shrink-0 cursor-pointer items-center gap-2 text-xs">
              <Checkbox
                checked={c.onlyEnabled}
                onCheckedChange={(checked) =>
                  c.setOnlyEnabled(checked === true)
                }
                className="border-border-strong bg-surface-2 size-3.5 rounded text-violet-700 focus:ring-violet-400/40 dark:text-violet-400"
              />
              仅显示已启用
            </label>
          </div>

          {/* list */}
          <div className="flex-1 overflow-y-auto px-5 pb-5">
            {c.loading ? (
              <p className="text-ink-muted text-sm">加载中…</p>
            ) : c.totalCount === 0 ? (
              <div className="border-border text-ink-muted grid min-h-[160px] place-items-center rounded-xl border border-dashed">
                <p className="text-sm">
                  {c.comfyReachable
                    ? "ComfyUI 中没有可识别的模型目录。"
                    : "未连接 ComfyUI；请先启动本地 ComfyUI。"}
                </p>
              </div>
            ) : (
              <>
                {c.enabledRows.length > 0 && (
                  <section className="mb-6">
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="text-ink-faint text-xs font-medium tracking-wide uppercase">
                        已启用 · {c.enabledRows.length}
                      </h3>
                    </div>
                    <div className="space-y-2">
                      {c.enabledRows.map((row) => (
                        <FolderConfigRow
                          key={row.folder}
                          row={row}
                          onToggle={c.toggle}
                          onAdd={c.add}
                          onDelete={c.remove}
                        />
                      ))}
                    </div>
                  </section>
                )}

                {!c.onlyEnabled && c.availableRows.length > 0 && (
                  <section>
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="text-ink-faint text-xs font-medium tracking-wide uppercase">
                        可添加 · {c.availableRows.length}
                      </h3>
                      <p className="text-ink-muted text-[11px]">
                        点「启用」加入扫描列表
                      </p>
                    </div>
                    <div className="space-y-2">
                      {c.availableRows.map((row) => (
                        <FolderConfigRow
                          key={row.folder}
                          row={row}
                          onToggle={c.toggle}
                          onAdd={c.add}
                          onDelete={c.remove}
                        />
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 单个文件夹行。已启用区与可用区用同一形状
 * —— 唯一区别是显示哪个按钮。类型药丸
 * 原样显示目录名（它**就是**类型）；悬停看
 * 说明。
 */
function FolderConfigRow({
  row,
  onToggle,
  onAdd,
  onDelete,
}: {
  row: FolderConfigRowData;
  onToggle: (folder: string, enabled: boolean) => void;
  onAdd: (folder: string) => void;
  onDelete: (folder: string) => void;
}) {
  const primaryMeta = folderMeta(row.type);

  const toggleEnabled = () => onToggle(row.folder, !row.enabled);
  const enableFromAvailable = () => onAdd(row.folder);
  const remove = () => onDelete(row.folder);

  return (
    <div className="border-border-subtle bg-card rounded-xl border px-3 py-2.5">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-ink-bright) font-mono text-sm">
              {row.folder}
            </span>
            <span
              className={`cursor-help rounded-md px-2 py-0.5 text-[11px] font-medium ${primaryMeta.color}`}
              title={getFolderTooltip(row.folder)}
            >
              {primaryMeta.label}
            </span>
            {row.count > 0 && (
              <span className="bg-surface-2 text-ink-faint rounded-md px-1.5 py-0.5 text-[10px]">
                {row.count} 个文件
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {row.enabled ? (
            <Button
              variant="success"
              size="xs"
              onClick={toggleEnabled}
              className="h-auto rounded-lg px-3 py-1.5"
            >
              已启用
            </Button>
          ) : (
            <Button
              variant="primary"
              size="xs"
              onClick={enableFromAvailable}
              className="h-auto gap-1 rounded-lg px-3 py-1.5"
            >
              <Icon name="plus" size={12} />
              启用
            </Button>
          )}
          {row.hasConfig && (
            <Button
              variant="ghost"
              size="xs"
              onClick={remove}
              className="text-ink-muted hover:bg-surface-2 hover:text-ink-strong h-auto rounded-md px-2 py-1"
              title="删除配置（不再扫描）"
            >
              删除
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
