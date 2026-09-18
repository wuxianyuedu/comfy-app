"use client";
import { useId, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { Button } from "~/components/ui/button";
import type { OptionGroup } from "~/lib/workshop/character-options";

/**
 * AttributeMultiSelect —— 角色属性穷举式多选下拉。
 *
 * 把服装/外貌/性格/气质/风格从"手写自由文本"升级为"下拉穷举勾选"：
 *  - 选中项以可删除 chip 平铺展示；
 *  - 点「+ 选择」开 popover：按分组分类 + 搜索过滤 + 复选框多选；
 *  - popover 底部提供「添加自定义」以覆盖穷举之外的同义表达。
 *
 * 浮层走 `~/components/ui/popover`（规范 16 §16.2.3 P2）：此前这里自搓了一套
 * portal + fixed 定位 + Esc/外点关闭 + 滚动重定位，`SelectMenu` 里还有一份 ——
 * 定位与关闭语义本就不该由每个调用点各写一遍。翻上/翻下、右边界收边、随触发
 * 元素滚动重定位全部交给 base-ui Positioner。
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

  const selected = new Set(value);

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
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => removeOne(v)}
              className="text-primary/60 hover:text-danger-strong"
              aria-label={`移除 ${v}`}
            >
              <X size={11} />
            </Button>
          </span>
        ))}
        <Popover
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (next) setKeyword("");
          }}
        >
          <PopoverTrigger
            ref={triggerRef}
            type="button"
            role="combobox"
            id={panelId}
            disabled={disabled}
            className="border-border text-muted-foreground hover:border-primary hover:text-primary ml-1 inline-flex h-auto items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-xs transition-colors disabled:opacity-40"
          >
            + 选择
            <ChevronDown
              size={11}
              className={`transition-transform ${open ? "rotate-180" : ""}`}
            />
          </PopoverTrigger>
          {value.length === 0 && (
            <span className="text-muted-foreground/60 px-1 text-[11px]">
              {placeholder}
            </span>
          )}

          {/* 下拉面板 */}
          <PopoverContent
            align="start"
            aria-label={`${label}多选`}
            className="border-border bg-card w-[300px] gap-0 overflow-hidden rounded-lg p-0 shadow-lg shadow-black/8 dark:shadow-black/40"
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
              <Button
                type="button"
                onClick={addCustom}
                disabled={!custom.trim()}
                className="h-auto shrink-0 rounded px-2 py-0.5 text-xs font-medium text-white disabled:opacity-40"
              >
                添加
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
