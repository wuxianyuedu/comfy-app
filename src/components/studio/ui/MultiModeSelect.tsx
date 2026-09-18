"use client";

/**
 * MultiModeSelect — v1
 *
 * 一个工作流支持多种模式（multi-select chip），每个工作流卡片右上角替代
 * 的单选 DarkSelect：
 *   - 主 chip：默认 mode（紫色基调，按所在分类上色）
 *   - +N pill：附加模式弱化占位（紫底 8% + 灰字）
 *   - 点主 chip 或 +N pill 都开同一多选 popover：
 *       · 搜索框（label / code / subCategory）
 *       · 按 image / video / audio 分类分组
 *       · 每行 = checkbox + label + code + 默认 toggle
 *       · 底部 取消 / 保存（显示已选条数）
 *
 * 同期复用 DarkSelect 的 React Portal + viewport popover 算法
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
} from "~/lib/workflow/workflow-types";

/* ── per-category pill colors ── */
const CATEGORY_PILL: Record<WorkflowCategory, string> = {
  image: "bg-violet-500/15 ring-1 ring-inset ring-violet-500/25",
  video: "bg-sky-500/15 ring-1 ring-inset ring-sky-500/25",
  audio: "bg-amber-500/15 ring-1 ring-inset ring-amber-500/25",
};
const CATEGORY_TEXT: Record<WorkflowCategory, string> = {
  image: "text-violet-700 dark:text-violet-300",
  video: "text-sky-700 dark:text-sky-300",
  audio: "text-amber-700 dark:text-amber-300",
};
const CATEGORY_LABEL: Record<WorkflowCategory, string> = {
  image: "图像",
  video: "视频",
  audio: "音频",
};
/* accent color for the active tab underline */
const CATEGORY_ACCENT: Record<WorkflowCategory, string> = {
  image: "bg-violet-400",
  video: "bg-sky-400",
  audio: "bg-amber-400",
};

interface MultiModeSelectProps {
  /** All selected mode codes (defaultMode ⊆ modes).  Empty array → blank chip. */
  modes: string[];
  /** Default mode code (defaultMode must be in `modes`). */
  defaultMode: string;
  onChange: (modes: string[], defaultMode: string) => void;
  className?: string;
  disabled?: boolean;
  /** 隐藏右侧的「+N」徽标：调用方（如详情页）自行把全部模式列在上方，
   *  徽标就成了冗余。popover 仍可从主 chip 打开。 */
  hideExtraBadge?: boolean;
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
  hideExtraBadge = false,
}: MultiModeSelectProps) {
  const [open, setOpen] = useState(false);
  // Which category tab is currently shown in the popover (图像/视频/音频).
  const [activeTab, setActiveTab] = useState<WorkflowCategory>("image");
  // Draft state inside the popover — only flushed on save.
  const [draft, setDraft] = useState<Set<string>>(new Set(modes));
  /** 弹窗内的默认模式草稿（必须 ∈ draft），保存时一并落库。 */
  const [draftDefault, setDraftDefault] = useState<string>(defaultMode);
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState<{ left: number; top: number; width: number }>({
    left: 0,
    top: 0,
    width: 0,
  });
  const triggerRef = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  // Reset draft only when the popover transitions from closed to open.
  // Do NOT reset while the user is actively checking items, otherwise
  // a parent re-render with a new `modes` array reference would wipe
  // the user's selection.
  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setDraft(new Set(modes));
      setDraftDefault(defaultMode);
      setQuery("");
      // Open on the category of the first selected mode (falls back to image).
      const firstSelected = ALL_WORKFLOW_TYPES.find((type) =>
        modes.includes(type.code),
      );
      setActiveTab(firstSelected?.category ?? "image");
    }
    prevOpenRef.current = open;
  }, [open, modes, defaultMode]);

  // Outside-click + Escape close. Reuses DarkSelect's exact pattern.
  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key === "Escape") {
        setOpen(false);
        return;
      }
      if (event instanceof MouseEvent) {
        if (
          triggerRef.current?.contains(event.target as Node) ||
          popRef.current?.contains(event.target as Node)
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
        window.innerWidth - VIEWPORT_MARGIN * 2,
      );
      const popoverWidth = Math.min(desiredWidth, maxAllowedWidth);
      let left = rect.left;
      if (left + popoverWidth > window.innerWidth - VIEWPORT_MARGIN) {
        left = Math.max(
          VIEWPORT_MARGIN,
          window.innerWidth - VIEWPORT_MARGIN - popoverWidth,
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

  const toggle = useCallback((code: string) => {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(code)) {
        next.delete(code);
      } else {
        next.add(code);
      }
      return next;
    });
  }, []);

  const handleSave = useCallback(() => {
    const arr = Array.from(draft);
    // 默认模式取弹窗内的草稿；草稿被取消勾选时回退到第一个选中项，
    // 保证 defaultMode ⊆ modes 的约束成立。
    const def = arr.includes(draftDefault) ? draftDefault : (arr[0] ?? "");
    onChange(arr, def);
    setOpen(false);
  }, [draft, draftDefault, onChange]);

  const handleCancel = useCallback(() => setOpen(false), []);

  // Default mode's category drives the chip accent.
  const accent = useMemo(() => {
    const first = ALL_WORKFLOW_TYPES.find((type) => modes.includes(type.code));
    const def = ALL_WORKFLOW_TYPES.find((type) => type.code === defaultMode);
    const cat: WorkflowCategory = first?.category ?? def?.category ?? "image";
    return { pill: CATEGORY_PILL[cat], text: CATEGORY_TEXT[cat] };
  }, [modes, defaultMode]);

  // Filtered + grouped (by category) options.  Used inside the popover.
  const grouped = useMemo(() => {
    const lowerQuery = query.trim().toLowerCase();
    const filtered = ALL_WORKFLOW_TYPES.filter((type) => {
      if (!lowerQuery) return true;
      return (
        type.code.toLowerCase().includes(lowerQuery) ||
        type.label.toLowerCase().includes(lowerQuery) ||
        (type.subCategory?.toLowerCase().includes(lowerQuery) ?? false) ||
        (type.fullName.toLowerCase().includes(lowerQuery) ?? false)
      );
    });
    const groupedMap: Partial<
      Record<WorkflowCategory, typeof ALL_WORKFLOW_TYPES>
    > = {};
    for (const type of filtered) {
      (groupedMap[type.category] ??= []).push(type);
    }
    return groupedMap;
  }, [query]);

  const firstSelected = ALL_WORKFLOW_TYPES.find((type) =>
    modes.includes(type.code),
  );
  const mainLabel = firstSelected ? firstSelected.label : "选择模式";
  const plusN = Math.max(0, modes.length - 1);

  return (
    <span
      className={`inline-flex items-center gap-1 ${disabled ? "pointer-events-none opacity-50" : ""}`}
      ref={triggerRef}
    >
      {/* main chip — clicking opens the popover */}
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          if (!disabled) setOpen((value) => !value);
        }}
        title={`当前 ${modes.length} 种模式 · 点击管理`}
        className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition-all hover:brightness-110 ${accent.pill} ${accent.text} ${className}`}
      >
        <span>{modes.length === 0 ? "选择模式" : mainLabel}</span>
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
      {plusN > 0 && !hideExtraBadge && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            if (!disabled) setOpen(true);
          }}
          title={`还有 ${plusN} 种其他模式，点击管理`}
          className="text-ink-faint inline-flex items-center rounded-md bg-violet-500/8 px-1.5 py-0.5 text-[11px] font-medium transition-colors hover:bg-violet-500/18 hover:text-violet-800 dark:text-violet-300 dark:hover:text-violet-300"
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
            className="border-border-strong bg-card rounded-xl border shadow-2xl shadow-black/5 dark:shadow-black/5 dark:shadow-violet-500/20"
          >
            {/* search */}
            <div className="border-border-subtle border-b p-2">
              <input
                autoFocus
                type="text"
                placeholder="搜索模式（标签 / 缩写）…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleSave();
                  }
                }}
                className="bg-subtle text-ink-bright placeholder:text-ink-fainter focus:bg-surface-2 w-full rounded-md px-2.5 py-1.5 text-sm transition-colors outline-none focus:ring-1 focus:ring-violet-500/30"
              />
            </div>

            {/* tabs — switchable 图像 / 视频 / 音频 */}
            <div className="border-border-subtle flex items-center gap-1 border-b px-2 pt-2">
              {(["image", "video", "audio"] as WorkflowCategory[]).map(
                (cat) => {
                  const selCount = (grouped[cat] ?? []).filter((type) =>
                    draft.has(type.code),
                  ).length;
                  const isActive = activeTab === cat;
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setActiveTab(cat)}
                      className={`relative flex-1 rounded-t-md px-2 py-1.5 text-xs font-semibold transition-colors ${
                        isActive
                          ? `${CATEGORY_TEXT[cat]} bg-surface-2`
                          : "text-ink-muted hover:text-ink-strong"
                      }`}
                    >
                      {CATEGORY_LABEL[cat]}
                      {selCount > 0 && (
                        <span
                          className={`ml-1 text-[10px] ${CATEGORY_TEXT[cat]}`}
                        >
                          {selCount}
                        </span>
                      )}
                      {isActive && (
                        <span
                          className={`absolute inset-x-2 -bottom-px h-0.5 rounded-full ${CATEGORY_ACCENT[cat]}`}
                        />
                      )}
                    </button>
                  );
                },
              )}
            </div>

            {/* list — only the active tab's category */}
            <div
              style={{ maxHeight: POPOVER_MAX_H }}
              className="overflow-y-auto py-1"
            >
              {(() => {
                const items = grouped[activeTab] ?? [];
                if (items.length === 0) {
                  return (
                    <div className="text-ink-muted px-3 py-4 text-center text-xs">
                      {query.trim()
                        ? "没有匹配的模式"
                        : `${CATEGORY_LABEL[activeTab]}暂无模式`}
                    </div>
                  );
                }
                return items.map((item) => {
                  const isSelected = draft.has(item.code);
                  const isDraftDefault = draftDefault === item.code;
                  return (
                    <div
                      key={item.code}
                      className={`flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left transition-colors ${
                        isSelected
                          ? "bg-violet-500/10 text-violet-700 dark:text-violet-300"
                          : "text-ink-strong hover:bg-subtle"
                      }`}
                      onClick={() => toggle(item.code)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          toggle(item.code);
                        }
                      }}
                      tabIndex={0}
                      role="checkbox"
                      aria-checked={isSelected}
                    >
                      {/* checkbox: 每个被选中的模式都显示勾选标记 */}
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          isSelected
                            ? "border-violet-500/60 bg-violet-500/30"
                            : "border-border-strong bg-card"
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
                        {item.label}
                      </span>
                      {/* 默认模式标记：点星星把该模式设为默认（未选中会顺带勾上） */}
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          if (!draft.has(item.code)) toggle(item.code);
                          setDraftDefault(item.code);
                        }}
                        title={isDraftDefault ? "当前默认模式" : "设为默认模式"}
                        className={`shrink-0 rounded px-1 py-0.5 text-[10px] font-medium transition-colors ${
                          isDraftDefault
                            ? "bg-violet-500/25 text-violet-700 dark:text-violet-300"
                            : "text-ink-muted hover:bg-surface-2 hover:text-ink-strong"
                        }`}
                      >
                        {isDraftDefault ? "★ 默认" : "☆ 默认"}
                      </button>
                      <span
                        className={`shrink-0 text-[11px] ${CATEGORY_TEXT[activeTab]} opacity-60`}
                      >
                        {item.code}
                      </span>
                    </div>
                  );
                });
              })()}
            </div>

            {/* footer */}
            <div className="border-border-subtle flex items-center gap-2 border-t p-2">
              <button
                type="button"
                onClick={handleCancel}
                className="bg-subtle text-ink-strong hover:bg-surface-2 flex-1 rounded-md px-3 py-1.5 text-sm transition-colors"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={draft.size === 0}
                className="disabled:bg-surface-2 disabled:text-ink-muted flex-1 rounded-md bg-violet-500/90 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed"
              >
                保存（{draft.size}）
              </button>
            </div>
          </div>,
          document.body,
        )}
    </span>
  );
}
