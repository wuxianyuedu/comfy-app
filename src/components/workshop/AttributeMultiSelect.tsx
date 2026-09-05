"use client";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search, X } from "lucide-react";
import type { OptionGroup } from "@/lib/workshop/character-options";

/**
 * AttributeMultiSelect —— 角色属性穷举式多选下拉。
 *
 * 把服装/外貌/性格/气质/风格从"手写自由文本"升级为"下拉穷举勾选"：
 *  - 选中项以可删除 chip 平铺展示；
 *  - 点「+ 选择」开 popover：按分组分类 + 搜索过滤 + 复选框多选；
 *  - popover 底部提供「添加自定义」以覆盖穷举之外的同义表达。
 *
 * 复用 DarkSelect 的 portal + fixed 定位算法（Esc / 外点关闭、滚动/缩放
 * 重定位、右侧溢出左移、空间不足向上翻）。
 */
interface AttributeMultiSelectProps {
  label: string;
  groups: OptionGroup[];
  /** 当前已选中值（源即 Character 对应字段） */
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

const POPOVER_MAX_H = 320;
const VIEWPORT_MARGIN = 8;
const POPOVER_MIN_WIDTH = 300;

export function AttributeMultiSelect({
  label,
  groups,
  value,
  onChange,
  placeholder = "从下拉中选择…",
  disabled = false,
  className = "",
}: AttributeMultiSelectProps) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [custom, setCustom] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{
    left: number;
    top: number;
    width: number;
    up: boolean;
  }>({
    left: 0,
    top: 0,
    width: POPOVER_MIN_WIDTH,
    up: false,
  });

  const selected = new Set(value);

  // 关闭于 Esc / 外点
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
          panelRef.current?.contains(e.target as Node)
        ) {
          return;
        }
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler, true);
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("mousedown", handler, true);
      document.removeEventListener("keydown", handler);
    };
  }, [open]);

  // popover 定位（fixed、跟随 trigger、上下翻转）
  useEffect(() => {
    if (!open) return;
    const recompute = () => {
      const btn = triggerRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const desiredWidth = Math.max(rect.width, POPOVER_MIN_WIDTH);
      const maxWidth = Math.max(0, window.innerWidth - VIEWPORT_MARGIN * 2);
      const width = Math.min(desiredWidth, maxWidth);
      let left = rect.left;
      if (left + width > window.innerWidth - VIEWPORT_MARGIN) {
        left = Math.max(
          VIEWPORT_MARGIN,
          window.innerWidth - VIEWPORT_MARGIN - width,
        );
      }
      const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_MARGIN;
      const up = spaceBelow < POPOVER_MAX_H && rect.top > spaceBelow;
      setPos({
        left,
        top: up
          ? Math.max(VIEWPORT_MARGIN, rect.top - POPOVER_MAX_H - 4)
          : rect.bottom + 4,
        width,
        up,
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

  function toggle(opt: string) {
    const next = new Set(selected);
    if (next.has(opt)) next.delete(opt);
    else next.add(opt);
    // 保持 value 原顺序（含自定义项），新选中项追加在末尾
    const ordered = value.filter((v) => next.has(v));
    for (const v of next) if (!ordered.includes(v)) ordered.push(v);
    onChange(ordered);
  }

  function removeOne(opt: string) {
    onChange(value.filter((v) => v !== opt));
  }

  function addCustom() {
    const t = custom.trim();
    if (!t) return;
    if (!selected.has(t)) onChange([...value, t]);
    setCustom("");
    // 选中后保持展开，便于连续添加
  }

  // 仅保留命中的分组/选项
  const kw = keyword.trim();
  const visibleGroups = kw
    ? groups
        .map((g) => ({
          ...g,
          options: g.options.filter((o) => o.includes(kw)),
        }))
        .filter((g) => g.options.length > 0)
    : groups;

  return (
    <div className={className}>
      <span className="text-muted-foreground mb-1 block text-xs">{label}</span>

      {/* chips + 触发按钮 */}
      <div className="border-border bg-bg flex flex-wrap items-center gap-1.5 rounded-md border px-1.5 py-1.5">
        {value.map((v) => (
          <span
            key={v}
            className="bg-primary-soft text-primary flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
          >
            {v}
            <button
              type="button"
              onClick={() => removeOne(v)}
              className="text-primary/60 hover:text-red-500"
              aria-label={`移除 ${v}`}
            >
              <X size={11} />
            </button>
          </span>
        ))}
        <button
          ref={triggerRef}
          type="button"
          role="combobox"
          aria-controls={panelId}
          aria-expanded={open}
          aria-haspopup="listbox"
          disabled={disabled}
          onClick={() => {
            setOpen((v) => !v);
            if (!open) setKeyword("");
          }}
          className={`border-border text-muted-foreground hover:border-primary hover:text-primary ml-1 inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-xs transition-colors disabled:opacity-40 ${
            disabled ? "" : ""
          }`}
        >
          + 选择{placeholder ? "" : ""}
          <ChevronDown
            size={11}
            className={`transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
        {value.length === 0 && (
          <span className="text-muted-foreground/60 px-1 text-[11px]">
            {placeholder}
          </span>
        )}
      </div>

      {/* 下拉面板 */}
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            id={panelId}
            ref={panelRef}
            role="listbox"
            aria-multiselectable="true"
            style={{
              position: "fixed",
              left: pos.left,
              top: pos.top,
              width: pos.width,
              zIndex: 9999,
            }}
            className="border-border overflow-hidden rounded-lg border bg-(--color-card) shadow-lg shadow-black/40"
          >
            {/* 搜索 */}
            <div className="border-border flex items-center gap-1.5 border-b px-2 py-1.5">
              <Search size={13} className="text-muted-foreground shrink-0" />
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                className="placeholder:text-muted-foreground/50 min-w-0 flex-1 bg-transparent text-xs outline-none"
                placeholder="搜索…"
              />
            </div>

            {/* 选项（分组） */}
            <div className="max-h-56 overflow-y-auto px-1 py-1">
              {visibleGroups.length === 0 ? (
                <p className="text-muted-foreground px-2 py-2 text-[11px]">
                  未找到匹配项，可在下方添加自定义。
                </p>
              ) : (
                visibleGroups.map((g) => (
                  <div key={g.title} className="mb-1">
                    <p className="text-muted-foreground/70 px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase">
                      {g.title}
                    </p>
                    {g.options.map((opt) => {
                      const on = selected.has(opt);
                      return (
                        <label
                          key={opt}
                          role="option"
                          aria-selected={on}
                          onClick={() => toggle(opt)}
                          className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs transition-colors ${
                            on
                              ? "bg-primary-soft text-primary"
                              : "text-ink/80 hover:bg-subtle"
                          }`}
                        >
                          <span
                            className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded border ${
                              on
                                ? "border-primary bg-primary text-white"
                                : "border-border bg-bg"
                            }`}
                          >
                            {on && <Check size={10} />}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{opt}</span>
                        </label>
                      );
                    })}
                  </div>
                ))
              )}
            </div>

            {/* 自定义添加 */}
            <div className="border-border flex items-center gap-1.5 border-t px-2 py-1.5">
              <input
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCustom();
                  }
                }}
                className="border-border bg-bg focus:border-primary min-w-0 flex-1 rounded border px-1.5 py-0.5 text-xs outline-none"
                placeholder="没有想要的？自定义添加后回车"
              />
              <button
                type="button"
                onClick={addCustom}
                disabled={!custom.trim()}
                className="bg-primary shrink-0 rounded px-2 py-0.5 text-xs font-medium text-white disabled:opacity-40"
              >
                添加
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
