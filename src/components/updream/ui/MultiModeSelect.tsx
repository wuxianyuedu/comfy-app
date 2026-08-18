"use client";

/**
 * MultiModeSelect — 2026-08-13 v1
 *
 * 一个工作流支持多种模式（multi-select chip），每个工作流卡片右上角替代
 * R70-2 的单选 DarkSelect：
 *   - 主 chip：默认 mode（紫色基调，按所在分类上色）
 *   - +N pill：附加模式弱化占位（紫底 8% + 灰字）
 *   - 点主 chip 或 +N pill 都开同一多选 popover：
 *       · 搜索框（label / code / subCategory）
 *       · 按 image / video / audio 分类分组
 *       · 每行 = checkbox + label + code + 默认 toggle
 *       · 底部 取消 / 保存（显示已选条数）
 *
 * 同期复用 DarkSelect (R55/R56) 的 React Portal + viewport popover 算法
 *（Esc/outside-click、滚动/resize 自动重定位、右侧溢出左移）。
 *
 * R* 配套关系：modes / defaultMode 已通过 prisma 迁移持久化（SQLite 用 JSON
 * 字符串列 `WorkflowTemplate.modes` + `defaultMode`）。PATCH /api/workflows/[id]
 * 接收 { modes, defaultMode } 一次性落库，defaultMode 同时回写 taskType 列以
 * 兼容旧的 ?type= 筛选。列表与详情路由均返回解析后的数组。
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  ALL_WORKFLOW_TYPES,
  type WorkflowCategory,
} from "@/lib/workflow-types";

/* ── per-category pill colors ── */
const CATEGORY_PILL: Record<WorkflowCategory, string> = {
  image: "bg-violet-500/15 ring-1 ring-inset ring-violet-500/25",
  video: "bg-sky-500/15 ring-1 ring-inset ring-sky-500/25",
  audio: "bg-amber-500/15 ring-1 ring-inset ring-amber-500/25",
};
const CATEGORY_TEXT: Record<WorkflowCategory, string> = {
  image: "text-violet-300",
  video: "text-sky-300",
  audio: "text-amber-300",
};
const CATEGORY_LABEL: Record<WorkflowCategory, string> = {
  image: "图像",
  video: "视频",
  audio: "音频",
};

interface MultiModeSelectProps {
  /** All selected mode codes (defaultMode ⊆ modes).  Empty array → blank chip. */
  modes: string[];
  /** Default mode code (defaultMode must be in `modes`). */
  defaultMode: string;
  onChange: (modes: string[], defaultMode: string) => void;
  className?: string;
  disabled?: boolean;
}

const POPOVER_MAX_H = 360;
const VIEWPORT_MARGIN = 8;
const POPOVER_MIN_WIDTH = 280;

export function MultiModeSelect({
  modes,
  defaultMode,
  onChange,
  className = "",
  disabled = false,
}: MultiModeSelectProps) {
  const [open, setOpen] = useState(false);
  // Draft state inside the popover — only flushed on save.
  const [draft, setDraft] = useState<Set<string>>(new Set(modes));
  const [draftDefault, setDraftDefault] = useState<string>(
    defaultMode || modes[0] || ""
  );
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState<{ left: number; top: number; width: number }>({
    left: 0,
    top: 0,
    width: 0,
  });
  const triggerRef = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  // Reset draft whenever the popover opens OR upstream modes change.
  useEffect(() => {
    if (open) {
      setDraft(new Set(modes));
      setDraftDefault(defaultMode || modes[0] || "");
      setQuery("");
    }
  }, [open, modes, defaultMode]);

  // Outside-click + Escape close.  Reuses DarkSelect's exact pattern (R55).
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent && e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (e instanceof MouseEvent) {
        if (
          triggerRef.current?.contains(e.target as Node) ||
          popRef.current?.contains(e.target as Node)
        )
          return;
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler, true);
    document.addEventListener("click", handler, true);
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("mousedown", handler, true);
      document.removeEventListener("click", handler, true);
      document.removeEventListener("keydown", handler);
    };
  }, [open]);

  // Position compute — same algorithm as DarkSelect but with up/down flip on height.
  useLayoutEffect(() => {
    if (!open) return;
    const recompute = () => {
      const btn = triggerRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const desiredWidth = Math.max(rect.width, POPOVER_MIN_WIDTH);
      const maxAllowedWidth = Math.max(
        0,
        window.innerWidth - VIEWPORT_MARGIN * 2
      );
      const popoverWidth = Math.min(desiredWidth, maxAllowedWidth);
      let left = rect.left;
      if (left + popoverWidth > window.innerWidth - VIEWPORT_MARGIN) {
        left = Math.max(
          VIEWPORT_MARGIN,
          window.innerWidth - VIEWPORT_MARGIN - popoverWidth
        );
      }
      const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_MARGIN;
      const place: "down" | "up" =
        spaceBelow >= POPOVER_MAX_H || spaceBelow >= rect.top ? "down" : "up";
      setPos({
        left,
        top:
          place === "down"
            ? rect.bottom + 4
            : Math.max(VIEWPORT_MARGIN, rect.top - POPOVER_MAX_H - 4),
        width: popoverWidth,
      });
    };
    recompute();
    window.addEventListener("scroll", recompute, true);
    window.addEventListener("resize", recompute);
    return () => {
      window.removeEventListener("scroll", recompute, true);
      window.removeEventListener("resize", recompute);
    };
  }, [open]);

  const toggle = useCallback(
    (code: string) => {
      setDraft((prev) => {
        const next = new Set(prev);
        if (next.has(code)) {
          // Disallow removing the only selected mode (chip would go blank).
          if (next.size <= 1) return prev;
          next.delete(code);
          // If we just unchecked the default, promote one of the remaining.
          if (code === draftDefault) {
            const remaining = ALL_WORKFLOW_TYPES.map((t) => t.code).filter(
              (c) => next.has(c)
            );
            setDraftDefault(remaining[0] ?? code);
          }
        } else {
          next.add(code);
        }
        return next;
      });
    },
    [draftDefault]
  );

  const setAsDefault = useCallback(
    (code: string) => {
      setDraftDefault(code);
      setDraft((prev) => {
        if (prev.has(code)) return prev;
        const next = new Set(prev);
        next.add(code);
        return next;
      });
    },
    []
  );

  const handleSave = useCallback(() => {
    const arr = Array.from(draft);
    if (arr.length === 0) return; // safety — should be unreachable (UI blocks it)
    const def = arr.includes(draftDefault) ? draftDefault : arr[0];
    onChange(arr, def);
    setOpen(false);
  }, [draft, draftDefault, onChange]);

  const handleCancel = useCallback(() => setOpen(false), []);

  // Default mode's category drives the chip accent.
  const accent = useMemo(() => {
    const def = ALL_WORKFLOW_TYPES.find((t) => t.code === defaultMode);
    const cat: WorkflowCategory = def?.category ?? "image";
    return { pill: CATEGORY_PILL[cat], text: CATEGORY_TEXT[cat] };
  }, [defaultMode]);

  // Filtered + grouped (by category) options.  Used inside the popover.
  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = ALL_WORKFLOW_TYPES.filter((t) => {
      if (!q) return true;
      return (
        t.code.toLowerCase().includes(q) ||
        t.label.toLowerCase().includes(q) ||
        (t.subCategory?.toLowerCase().includes(q) ?? false) ||
        (t.fullName.toLowerCase().includes(q) ?? false)
      );
    });
    const g: Partial<Record<WorkflowCategory, typeof ALL_WORKFLOW_TYPES>> = {};
    for (const t of filtered) {
      (g[t.category] ??= []).push(t);
    }
    return g;
  }, [query]);

  const def = ALL_WORKFLOW_TYPES.find((t) => t.code === defaultMode);
  const mainLabel = def ? def.label : defaultMode || "未选";
  const plusN = Math.max(0, modes.length - 1);

  return (
    <span
      className={`inline-flex items-center gap-1 ${disabled ? "opacity-50 pointer-events-none" : ""}`}
      ref={triggerRef}
    >
      {/* main chip — clicking opens the popover */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (!disabled) setOpen((v) => !v);
        }}
        title={`当前 ${modes.length} 种模式 · 默认 ${mainLabel} · 点击管理`}
        className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition-all hover:brightness-110 ${accent.pill} ${accent.text} ${className}`}
      >
        <span>
          {mainLabel} · {defaultMode}
        </span>
        <svg
          className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          width="10"
          height="10"
          viewBox="0 0 12 12"
          fill="none"
        >
          <path
            d="M3 4.5L6 7.5L9 4.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {/* +N pill — clicking also opens the popover (same triggerRef) */}
      {plusN > 0 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (!disabled) setOpen(true);
          }}
          title={`还有 ${plusN} 种其他模式，点击管理`}
          className="inline-flex items-center rounded-md bg-violet-500/[0.08] px-1.5 py-0.5 text-[11px] font-medium text-gray-400 transition-colors hover:bg-violet-500/[0.18] hover:text-violet-200"
        >
          +{plusN}
        </button>
      )}

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popRef}
            role="dialog"
            aria-label="工作流模式编辑器"
            style={{
              position: "fixed",
              left: pos.left,
              top: pos.top,
              width: pos.width,
              zIndex: 9999,
            }}
            className="rounded-xl border border-white/[0.08] bg-[#16161C] shadow-2xl shadow-violet-500/20"
          >
            {/* search */}
            <div className="border-b border-white/[0.06] p-2">
              <input
                autoFocus
                type="text"
                placeholder="搜索模式（标签 / 缩写）…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleSave();
                  }
                }}
                className="w-full rounded-md bg-white/[0.04] px-2.5 py-1.5 text-sm text-gray-200 placeholder-gray-500 outline-none transition-colors focus:bg-white/[0.06] focus:ring-1 focus:ring-violet-500/30"
              />
            </div>

            {/* list — grouped by category */}
            <div
              style={{ maxHeight: POPOVER_MAX_H }}
              className="overflow-y-auto py-1"
            >
              {Object.entries(grouped).length === 0 && (
                <div className="px-3 py-4 text-center text-xs text-gray-500">
                  没有匹配的模式
                </div>
              )}
              {(
                [
                  "image",
                  "video",
                  "audio",
                ] as WorkflowCategory[]
              ).map((cat) => {
                const items = grouped[cat];
                if (!items || items.length === 0) return null;
                return (
                  <div key={cat}>
                    <div
                      className={`sticky top-0 px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider ${CATEGORY_TEXT[cat]} bg-[#16161C]/90 backdrop-blur`}
                    >
                      {CATEGORY_LABEL[cat]}
                    </div>
                    {items.map((t) => {
                      const isSelected = draft.has(t.code);
                      const isDefault = draftDefault === t.code;
                      return (
                        <div
                          key={t.code}
                          role="button"
                          tabIndex={0}
                          onClick={() => toggle(t.code)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              toggle(t.code);
                            }
                          }}
                          className={`flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left transition-colors ${
                            isSelected
                              ? "bg-violet-500/10 text-violet-100"
                              : "text-gray-300 hover:bg-white/[0.04]"
                          }`}
                        >
                          {/* checkbox */}
                          <span
                            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                              isSelected
                                ? "border-violet-500/60 bg-violet-500/30"
                                : "border-white/[0.18] bg-white/[0.02]"
                            }`}
                          >
                            {isSelected && (
                              <svg
                                width="10"
                                height="10"
                                viewBox="0 0 12 12"
                                fill="none"
                              >
                                <path
                                  d="M2.5 6l2.5 2.5L9.5 3.5"
                                  stroke="currentColor"
                                  strokeWidth="1.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            )}
                          </span>
                          <span className="flex-1 truncate text-[13px] font-medium">
                            {t.label}
                          </span>
                          <span
                            className={`shrink-0 text-[11px] ${CATEGORY_TEXT[cat]} opacity-60`}
                          >
                            {t.code}
                          </span>
                          {/* default toggle (visible only when selected) */}
                          {isSelected && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setAsDefault(t.code);
                              }}
                              title={
                                isDefault
                                  ? "当前默认模式"
                                  : "设为默认模式（卡片主 chip 显示）"
                              }
                              className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold transition-colors ${
                                isDefault
                                  ? "bg-violet-500/30 text-violet-100"
                                  : "bg-white/[0.06] text-gray-500 hover:bg-white/[0.10] hover:text-gray-300"
                              }`}
                            >
                              {isDefault ? "默认" : "设为默认"}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            {/* footer */}
            <div className="flex items-center gap-2 border-t border-white/[0.06] p-2">
              <button
                type="button"
                onClick={handleCancel}
                className="flex-1 rounded-md bg-white/[0.04] px-3 py-1.5 text-sm text-gray-300 transition-colors hover:bg-white/[0.08]"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={draft.size === 0}
                className="flex-1 rounded-md bg-violet-500/90 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:bg-white/[0.06] disabled:text-gray-500"
              >
                保存（{draft.size}）
              </button>
            </div>
          </div>,
          document.body
        )}
    </span>
  );
}
