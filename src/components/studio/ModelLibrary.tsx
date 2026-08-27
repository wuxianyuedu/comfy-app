/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-floating-promises, @typescript-eslint/no-empty-function */
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AuroraBackground } from "@/components/studio/AuroraBackground";
import { Icon } from "@/components/ui/Icon";
import { folderMeta, getFolderTooltip } from "@/lib/model-types";
import { api } from "~/trpc/react";

interface ModelRow {
  id: string;
  name: string;
  type: string;
  fileName: string;
  isAvailable: boolean;
  fileSize?: number | null;
  createdAt: string;
}

/** Shape of a row from GET /api/models/config (subset we render). */
interface FolderConfigRow {
  folder: string;
  /** The directory name IS the model type (R-ardot45). */
  type: string;
  label: string;
  enabled: boolean;
  hasConfig: boolean;
  count: number;
}

function fmtSize(n?: number | null) {
  if (!n) return "—";
  if (n > 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (n > 1024 * 1024) return `${(n / 1024 / 1024).toFixed(0)} MB`;
  return `${(n / 1024).toFixed(0)} KB`;
}

export function ModelLibrary() {
  const [models, setModels] = useState<ModelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<string>("ALL");
  const [configOpen, setConfigOpen] = useState(false);

  const listQ = api.model.list.useQuery();
  const syncMut = api.model.sync.useMutation();

  const loadModels = useCallback(() => {
    setLoading(true);
    listQ
      .refetch()
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [listQ]);

  useEffect(() => {
    // Sync silently on mount so the library reflects the current config
    // without the user having to click "重新扫描" first. Defer out of the
    // effect body (React 19 rule: no setState synchronously within an effect).
    const t = setTimeout(() => syncMut.mutate(undefined, { onSettled: () => loadModels() }), 0);
    return () => clearTimeout(t);
  }, [syncMut, loadModels]);

  // react-query list -> local rows state (adjusted during render, React 19
  // pattern: no setState synchronously within an effect).
  const [prevListData, setPrevListData] = useState(listQ.data);
  if (listQ.data && listQ.data !== prevListData) {
    setPrevListData(listQ.data);
    setModels((listQ.data.models ?? []) as unknown as ModelRow[]);
  }

  const filtered = useMemo(() => {
    return models.filter((model) =>
{
      if (filter !== "ALL" && model.type !== filter) return false;
      if (q && !`${model.name} ${model.fileName}`.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [models, q, filter]);

  // Distinct types present in the data, with counts — each is a directory
  // name (its own model type).  Drives the filter chips.
  const typeChips = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of models) counts.set(m.type, (counts.get(m.type) ?? 0) + 1);
    return Array.from(counts.entries()).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  }, [models]);

  return (
    <div className="h-full overflow-y-auto">
      <AuroraBackground />
      <div className="mx-auto max-w-[1200px] px-4 sm:px-8 py-8 sm:py-10">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-title text-xl font-bold text-gray-100">模型库</h1>
            <p className="mt-1 text-sm text-gray-500">
              本机 ComfyUI 可用模型，按扫描目录分类 —— 每个目录即一种独立的模型类型。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setConfigOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-gray-200 transition-colors hover:border-violet-500/40 hover:text-violet-200"
            >
              <Icon name="settings" size={16} />
              模型目录配置
            </button>
            <input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="搜索模型名称…"
              className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-gray-200 outline-none focus:border-violet-500/40 sm:w-64"
            />
          </div>
        </div>

        <div className="mb-5 flex flex-wrap gap-2">
          <FilterChip active={filter === "ALL"} onClick={() => setFilter("ALL")} label={`全部 (${models.length})`} />
          {typeChips.map(([t, count]) => {
            const meta = folderMeta(t);
            return (
              <FilterChip
                key={t}
                active={filter === t}
                onClick={() => setFilter(t)}
                label={`${meta.label} (${count})`}
              />
            );
          })}
        </div>

        {loading ? (
          <p className="text-sm text-gray-500">加载中…</p>
        ) : filtered.length === 0 ? (
          <div className="grid min-h-[300px] place-items-center rounded-2xl border border-dashed border-white/[0.08] text-gray-500">
            <div className="text-center">
              <p className="text-lg font-medium text-gray-300">模型库还没有内容</p>
              <p className="mt-1 max-w-md text-sm">
                没启用任何模型目录时这里为空。打开「模型目录配置」勾选需要扫描的目录，重新扫描后即可在此查看。
              </p>
              <button
                onClick={() => setConfigOpen(true)}
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-violet-500/20 px-4 py-2 text-sm font-medium text-violet-200 transition-colors hover:bg-violet-500/30"
              >
                <Icon name="settings" size={16} />
                去配置目录
              </button>
            </div>
          </div>
        ) : (
          // R-ardot46: compact list — each row is [type pill][filename][size].
          // The old card grid (4 cols + 28px placeholder icon + duplicate fileName)
          // was way too heavy; an N-row gallery is way more legible for what is
          // ultimately a 1-line filename + size payload.
          <div
            role="list"
            aria-label="模型文件列表"
            className="overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.015]"
          >
            {filtered.map((m, idx) => {
              const meta = folderMeta(m.type);
              const isLast = idx === filtered.length - 1;
              return (
                <div
                  key={m.id}
                  role="listitem"
                  className={`group flex items-center gap-3 px-3 py-2 transition-colors hover:bg-white/[0.04] ${
                    isLast ? "" : "border-b border-white/[0.04]"
                  }`}
                >
                  <span
                    className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium ${meta.color}`}
                  >
                    {meta.label}
                  </span>
                  <span
                    className="min-w-0 flex-1 truncate font-mono text-sm text-gray-200"
                    title={m.fileName}
                  >
                    {m.fileName}
                  </span>
                  {!m.isAvailable && (
                    <span
                      className="shrink-0 rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] text-gray-400"
                      title="当前未在 ComfyUI 扫描结果中"
                    >
                      不可用
                    </span>
                  )}
                  <span className="shrink-0 text-xs text-gray-500 tabular-nums" title="文件大小">
                    {fmtSize(m.fileSize)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {configOpen && (
        <ModelConfigModal
          onClose={() => {
            setConfigOpen(false);
            syncMut.mutate(undefined, { onSettled: () => loadModels() });
          }}
        />
      )}
    </div>
  );
}

function FilterChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
        active ? "bg-violet-500/20 text-violet-200" : "bg-white/[0.04] text-gray-400 hover:text-gray-200"
      }`}
    >
      {label}
    </button>
  );
}

/* ── 模型目录配置 Modal (R-ardot43) ──
 * Surfaces every ComfyUI directory the scanner can visit.  Each row's type
 * is auto-resolved from the directory name (curated lookup → fuzzy match
 * → CHECKPOINT fallback) so the user only needs to enable / disable the
 * directory — they don't pick a type.  An "advanced" panel per row lets
 * the user add *extra* COMBO field types (e.g. expose this folder's files
 * under an additional field). */
function ModelConfigModal({ onClose }: { onClose: () => void }) {
  const [folders, setFolders] = useState<FolderConfigRow[]>([]);
  const [comfyReachable, setComfyReachable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [scanning, setScanning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [onlyEnabled, setOnlyEnabled] = useState(false);

  const configQ = api.model.configList.useQuery();
  const saveMut = api.model.configSave.useMutation();
  const delMut = api.model.configDelete.useMutation();
  const syncMut = api.model.sync.useMutation();

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      await configQ.refetch();
    } catch {
      setErr("网络错误");
    } finally {
      setLoading(false);
    }
  }, [configQ]);

  useEffect(() => {
    // Defer the initial load out of the effect body (React 19 rule: no
    // setState synchronously within an effect).
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  // react-query config data -> local folders state (adjusted during render,
  // React 19 pattern).
  const [prevCfgData, setPrevCfgData] = useState(configQ.data);
  if (configQ.data && configQ.data !== prevCfgData) {
    setPrevCfgData(configQ.data);
    setFolders(configQ.data.folders ?? []);
    setComfyReachable(Boolean(configQ.data.comfyReachable));
  }

  const runMutate = useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (e: any) {
        setErr(e?.message ?? "网络错误");
      }
      await load();
    },
    [load]
  );

  const handleToggle = useCallback(
    (folder: string, enabled: boolean) =>
      runMutate(() => saveMut.mutateAsync({ folder, enabled })),
    [runMutate, saveMut]
  );
  const handleAdd = useCallback(
    (folder: string) => runMutate(() => saveMut.mutateAsync({ folder, enabled: true })),
    [runMutate, saveMut]
  );
  const handleDelete = useCallback(
    (folder: string) => runMutate(() => delMut.mutateAsync({ folder })),
    [runMutate, delMut]
  );

  const rescan = useCallback(async () => {
    setScanning(true);
    setErr(null);
    try {
      await syncMut.mutateAsync();
    } catch (e: any) {
      setErr(e?.message ?? "扫描失败");
    }
    setScanning(false);
    await load();
  }, [load, syncMut]);

  const enabledRows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return folders
      .filter((file) => file.enabled)
      .filter((file) => !term || `${file.folder} ${file.label}`.toLowerCase().includes(term));
  }, [folders, q]);
  const availableRows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return folders
      .filter((file) => !file.enabled)
      .filter((file) => !term || file.folder.toLowerCase().includes(term));
  }, [folders, q]);
  const visibleEnabled = onlyEnabled ? enabledRows : enabledRows;
  const enabledCount = enabledRows.length;
  const totalCount = folders.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0E0E16] shadow-2xl shadow-black/50">
        {/* header */}
        <div className="flex items-start justify-between border-b border-white/[0.06] px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-gray-100">
              <Icon name="foldertree" size={18} className="text-violet-300" />
              模型目录配置
            </h2>
            <p className="mt-0.5 text-xs text-gray-500">
              勾选需要扫描的 ComfyUI 模型目录；每个目录即独立模型类型（目录名即类型名）。禁用后该目录模型将从模型库与画布 COMBO 下拉中隐藏。
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-white/[0.06] hover:text-gray-200"
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        {/* status + scan */}
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-3">
          <div className="flex items-center gap-3 text-xs">
            {comfyReachable ? (
              <span className="text-emerald-300">● ComfyUI 已连接 · 共 {totalCount} 个目录</span>
            ) : (
              <span className="text-amber-300">● ComfyUI 未连接</span>
            )}
            <span className="text-gray-500">· 已启用 {enabledCount} 个</span>
            {err && <span className="text-rose-300">{err}</span>}
          </div>
          <button
            onClick={rescan}
            disabled={scanning}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-gray-200 transition-colors hover:border-violet-500/40 hover:text-violet-200 disabled:opacity-50"
          >
            <Icon name={scanning ? "loader" : "shuffle"} size={14} className={scanning ? "animate-spin" : ""} />
            {scanning ? "扫描中…" : "重新扫描"}
          </button>
        </div>

        {/* search + filter */}
        <div className="flex items-center gap-3 px-5 py-3">
          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="搜索目录名…"
            className="flex-1 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-gray-200 outline-none focus:border-violet-500/40"
          />
          <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs text-gray-400">
            <input
              type="checkbox"
              checked={onlyEnabled}
              onChange={(event) => setOnlyEnabled(event.target.checked)}
              className="h-3.5 w-3.5 rounded border-white/20 bg-white/10 text-violet-500 focus:ring-violet-400/40"
            />
            仅显示已启用
          </label>
        </div>

        {/* list */}
        <div className="flex-1 overflow-y-auto px-5 pb-5">
          {loading ? (
            <p className="text-sm text-gray-500">加载中…</p>
          ) : totalCount === 0 ? (
            <div className="grid min-h-[160px] place-items-center rounded-xl border border-dashed border-white/[0.08] text-gray-500">
              <p className="text-sm">
                {comfyReachable
                  ? "ComfyUI 中没有可识别的模型目录。"
                  : "未连接 ComfyUI；请先启动本地 ComfyUI。"}
              </p>
            </div>
          ) : (
            <>
              {visibleEnabled.length > 0 && (
                <section className="mb-6">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-xs font-medium uppercase tracking-wide text-gray-400">
                      已启用 · {visibleEnabled.length}
                    </h3>
                  </div>
                  <div className="space-y-2">
                    {visibleEnabled.map((visibleEnabled) =>
(
                      <FolderConfigRow
                        key={visibleEnabled.folder}
                        row={visibleEnabled}
                        onToggle={handleToggle}
                        onAdd={handleAdd}
                        onDelete={handleDelete}
                      />
                    ))}
                  </div>
                </section>
              )}

              {!onlyEnabled && availableRows.length > 0 && (
                <section>
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-xs font-medium uppercase tracking-wide text-gray-400">
                      可添加 · {availableRows.length}
                    </h3>
                    <p className="text-[11px] text-gray-500">点「启用」加入扫描列表</p>
                  </div>
                  <div className="space-y-2">
                    {availableRows.map((availableRow) =>
(
                      <FolderConfigRow
                        key={availableRow.folder}
                        row={availableRow}
                        onToggle={handleToggle}
                        onAdd={handleAdd}
                        onDelete={handleDelete}
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
 * explanation (R-ardot45).
 */
function FolderConfigRow({
  row,
  onToggle,
  onAdd,
  onDelete,
}: {
  row: FolderConfigRow;
  onToggle: (folder: string, enabled: boolean) => void;
  onAdd: (folder: string) => void;
  onDelete: (folder: string) => void;
}) {
  const primaryMeta = folderMeta(row.type);

  const toggleEnabled = () => onToggle(row.folder, !row.enabled);
  const enableFromAvailable = () => onAdd(row.folder);
  const remove = () => onDelete(row.folder);

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm text-gray-200">{row.folder}</span>
            <span
              className={`cursor-help rounded-md px-2 py-0.5 text-[11px] font-medium ${primaryMeta.color}`}
              title={getFolderTooltip(row.folder)}
            >
              {primaryMeta.label}
            </span>
            {row.count > 0 && (
              <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] text-gray-400">
                {row.count} 个文件
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {row.enabled ? (
            <button
              onClick={toggleEnabled}
              className="rounded-lg bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-300 transition-colors hover:bg-emerald-500/25"
            >
              已启用
            </button>
          ) : (
            <button
              onClick={enableFromAvailable}
              className="inline-flex items-center gap-1 rounded-lg bg-violet-500/20 px-3 py-1.5 text-xs font-medium text-violet-200 transition-colors hover:bg-violet-500/30"
            >
              <Icon name="plus" size={12} />
              启用
            </button>
          )}
          {row.hasConfig && (
            <button
              onClick={remove}
              className="rounded-md px-2 py-1 text-[11px] text-gray-500 transition-colors hover:bg-white/[0.06] hover:text-gray-300"
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