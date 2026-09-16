"use client";

import { AuroraBackground } from "@/components/studio/ui/AuroraBackground";
import { Icon } from "@/components/ui/icon";
import { folderMeta, getFolderTooltip } from "@/lib/model-types";

import { useModelFolderConfig } from "./hooks/use-model-folder-config";
import { useModelLibrary } from "./hooks/use-model-library";
import {
  ALL_TYPES,
  type FolderConfigRow as FolderConfigRowData,
  fmtSize,
} from "./model-library-config";
import { overlayClass } from "~/lib/full-screen-layer";

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
            <button
              onClick={() => c.setConfigOpen(true)}
              className="border-border bg-subtle text-ink-bright inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors hover:border-violet-500/40 hover:text-violet-700 dark:text-violet-500"
            >
              <Icon name="settings" size={16} />
              模型目录配置
            </button>
            <input
              value={c.q}
              onChange={(event) => c.setQ(event.target.value)}
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
              <button
                onClick={() => c.setConfigOpen(true)}
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-violet-500/20 px-4 py-2 text-sm font-medium text-violet-700 transition-colors hover:bg-violet-500/30 dark:text-violet-300"
              >
                <Icon name="settings" size={16} />
                去配置目录
              </button>
            </div>
          </div>
        ) : (
          // compact list — each row is [type pill][filename][size].
          // The old card grid (4 cols + 28px placeholder icon + duplicate fileName)
          // was way too heavy; an N-row gallery is way more legible for what is
          // ultimately a 1-line filename + size payload.
          <div
            role="list"
            aria-label="模型文件列表"
            className="border-border-subtle bg-card overflow-hidden rounded-xl border"
          >
            {c.filtered.map((m, idx) => {
              const meta = folderMeta(m.type);
              const isLast = idx === c.filtered.length - 1;
              return (
                <div
                  key={m.id}
                  role="listitem"
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
                    title={m.fileName}
                  >
                    {m.fileName}
                  </span>
                  {!m.isAvailable && (
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
                    {fmtSize(m.fileSize)}
                  </span>
                </div>
              );
            })}
          </div>
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
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? "bg-violet-500/20 text-violet-700 dark:text-violet-300"
          : "bg-subtle text-ink-faint hover:text-ink-bright)"
      }`}
    >
      {label}
    </button>
  );
}

/* ── 模型目录配置 Modal ──
 * Surfaces every ComfyUI directory the scanner can visit.  Each row's type
 * is auto-resolved from the directory name (curated lookup → fuzzy match
 * → CHECKPOINT fallback) so the user only needs to enable / disable the
 * directory — they don't pick a type.  An "advanced" panel per row lets
 * the user add *extra* COMBO field types (e.g. expose this folder's files
 * under an additional field). */
/**
 * 模型目录配置弹层 —— 视图层（规范 17 §17.2 第③层）。
 * 列表拉取、启用/停用/删除与重新扫描在 hooks/use-model-folder-config.ts。
 */
function ModelConfigModal({ onClose }: { onClose: () => void }) {
  const c = useModelFolderConfig();

  return (
    <div
      className={overlayClass(
        "modal",
        "z-50 flex items-center justify-center p-4",
      )}
    >
      <div
        className="absolute inset-0 bg-black/25 backdrop-blur-sm dark:bg-black/60"
        onClick={onClose}
      />
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
          <button
            onClick={onClose}
            className="text-ink-muted hover:bg-surface-2 hover:text-ink-bright) rounded-lg p-1.5 transition-colors"
          >
            <Icon name="close" size={18} />
          </button>
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
              <span className="text-rose-700 dark:text-rose-400">{c.err}</span>
            )}
          </div>
          <button
            onClick={() => void c.rescan()}
            disabled={c.scanning}
            className="border-border bg-subtle text-ink-bright inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors hover:border-violet-500/40 hover:text-violet-700 disabled:opacity-50 dark:text-violet-500"
          >
            <Icon
              name={c.scanning ? "loader" : "shuffle"}
              size={14}
              className={c.scanning ? "animate-spin" : ""}
            />
            {c.scanning ? "扫描中…" : "重新扫描"}
          </button>
        </div>

        {/* search + filter */}
        <div className="flex items-center gap-3 px-5 py-3">
          <input
            value={c.q}
            onChange={(event) => c.setQ(event.target.value)}
            placeholder="搜索目录名…"
            className="border-border bg-subtle text-ink-bright flex-1 rounded-lg border px-3 py-2 text-sm outline-none focus:border-violet-500/40"
          />
          <label className="text-ink-faint flex shrink-0 cursor-pointer items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={c.onlyEnabled}
              onChange={(event) => c.setOnlyEnabled(event.target.checked)}
              className="border-border-strong bg-surface-2 h-3.5 w-3.5 rounded text-violet-700 focus:ring-violet-400/40 dark:text-violet-400"
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
    </div>
  );
}

/**
 * Single folder row.  Same shape is used for both enabled and available
 * sections — the only difference is which button is shown.  The type pill
 * shows the directory name verbatim (it IS the type); hover for an
 * explanation.
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
            <button
              onClick={toggleEnabled}
              className="rounded-lg bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-500/25 dark:text-emerald-400"
            >
              已启用
            </button>
          ) : (
            <button
              onClick={enableFromAvailable}
              className="inline-flex items-center gap-1 rounded-lg bg-violet-500/20 px-3 py-1.5 text-xs font-medium text-violet-700 transition-colors hover:bg-violet-500/30 dark:text-violet-300"
            >
              <Icon name="plus" size={12} />
              启用
            </button>
          )}
          {row.hasConfig && (
            <button
              onClick={remove}
              className="text-ink-muted hover:bg-surface-2 hover:text-ink-strong rounded-md px-2 py-1 text-[11px] transition-colors"
              title="删除配置（不再扫描）"
            >
              删除
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
