"use client";
import { useId, useRef, useState } from "react";
import { textHandler } from "~/lib/form-props";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { Button } from "~/components/ui/button";
import { enterCommit } from "~/components/ui/use-enter-commit";
import { simpleKeyHandler } from "~/components/ui/simple-key-handler";
import { filterGroupsByKeyword } from "~/lib/list-filter";
import type { OptionGroup } from "~/lib/workshop/character-options";

/**
 * AttributeMultiSelect —— 角色属性穷举式多选下拉：选中项以可删除 chip 平铺，「+ 选择」开 popover（分组 + 搜索 + 复选），底部可「添加自定义」覆盖同义表达。
 * 浮层走 `~/components/ui/popover`（规范 16 §16.2.3 P2），翻上/翻下、右边界收边、滚动重定位交给 base-ui Positioner，不再每个调用点自写定位与关闭语义。
 */
type AttributeMultiSelectProps = {
  className?: string;
  disabled?: boolean;
  groups: Array<OptionGroup>;
  label: string;
  onChange: (value: Array<string>) => void;
  placeholder?: string;
  /** 当前已选中值（源即 Character 对应字段） */
  value: Array<string>;
};

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
  const listboxId = `${panelId}-listbox`;
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [custom, setCustom] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const selected = new Set(value);

  function toggle(opt: string) {
    const next = new Set(selected);
    if (next.has(opt)) {
      next.delete(opt);
    } else {
      next.add(opt);
    }
    // 保持 value 原顺序（含自定义项），新选中项追加在末尾
    const ordered = value.filter((v) => next.has(v));
    for (const v of next) {
      if (!ordered.includes(v)) {
        ordered.push(v);
      }
    }
    onChange(ordered);
  }

  function removeOne(opt: string) {
    onChange(value.filter((v) => v !== opt));
  }

  function addCustom() {
    const t = custom.trim();
    if (!t) {
      return;
    }
    if (!selected.has(t)) {
      onChange([...value, t]);
    }
    setCustom("");
    // 选中后保持展开，便于连续添加
  }

  /* 仅保留命中的分组/选项 —— 归一化（trim + 折小写）、分组保序、空组丢弃
   * 都收在 `~/lib/list-filter`（规范 16 §16.2.4.16）。此前这里只写了
   * `trim()`：候选值里含拉丁字母的项（`JK制服` / `T恤` / `3D`）因此大小写敏感，
   * 用户输 `jk` 一条也搜不到。 */
  const visibleGroups = filterGroupsByKeyword(groups, keyword, "options");

  return (
    <div className={className}>
      <span className="text-muted-foreground mb-1 block text-xs">{label}</span>

      {/* chips + 触发按钮 */}
      <div className="border-border bg-bg flex flex-wrap items-center gap-1.5 rounded-md border px-1.5 py-1.5">
        {value.map((v) => (
          <span
            className="bg-primary-soft text-primary flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
            key={v}
          >
            {v}
            <Button
              aria-label={`移除 ${v}`}
              className="text-primary/60 hover:text-danger-strong"
              onClick={() => {
                removeOne(v);
              }}
              size="icon-xs"
              variant="ghost"
            >
              <X data-icon="inline-start" size={11} />
            </Button>
          </span>
        ))}
        <Popover
          onOpenChange={(next) => {
            setOpen(next);
            if (next) {
              setKeyword("");
            }
          }}
          open={open}
        >
          <PopoverTrigger
            aria-controls={listboxId}
            aria-expanded={open}
            className="border-border text-muted-foreground hover:border-primary hover:text-primary ml-1 inline-flex h-auto items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-xs transition-colors disabled:opacity-40"
            disabled={disabled}
            id={panelId}
            ref={triggerRef}
            role="combobox"
            type="button"
          >
            + 选择
            <ChevronDown className={`transition-transform ${open ? "rotate-180" : ""}`} size={11} />
          </PopoverTrigger>
          {value.length === 0 && (
            <span className="text-muted-foreground/60 text-2xs px-1">{placeholder}</span>
          )}

          {/* 下拉面板 */}
          <PopoverContent
            align="start"
            aria-label={`${label}多选`}
            className="border-border bg-card w-75 gap-0 overflow-hidden rounded-lg p-0 shadow-lg shadow-black/8 dark:shadow-black/40"
          >
            {/* 搜索 */}
            <div className="border-border flex items-center gap-1.5 border-b px-2 py-1.5">
              <Search className="text-muted-foreground shrink-0" size={13} />
              <input
                className="placeholder:text-muted-foreground/50 min-w-0 flex-1 bg-transparent text-xs outline-none"
                onChange={textHandler(setKeyword)}
                placeholder="搜索…"
                value={keyword}
              />
            </div>

            {/* 选项（分组） · role="option" 要求 listbox 父级 · 允许多选 */}
            <div
              aria-multiselectable="true"
              className="max-h-56 overflow-y-auto px-1 py-1"
              id={listboxId}
              role="listbox"
            >
              {visibleGroups.length === 0 ? (
                <p className="text-muted-foreground text-2xs px-2 py-2">
                  未找到匹配项，可在下方添加自定义。
                </p>
              ) : (
                visibleGroups.map((g) => (
                  <div className="mb-1" key={g.title}>
                    <p className="text-muted-foreground/70 text-3xs px-2 py-0.5 font-medium tracking-wide uppercase">
                      {g.title}
                    </p>
                    {g.options.map((opt) => {
                      const on = selected.has(opt);
                      return (
                        /* oxlint-disable-next-line jsx_a11y/click-events-have-key-events -- 同上：选项行的键出口是 `simpleKeyHandler` 的展开（`tabIndex` 本轮已补）。 */
                        <div
                          aria-selected={on}
                          key={opt}
                          onClick={() => {
                            toggle(opt);
                          }}
                          role="option"
                          /* 行可聚焦 + Enter/Space 切换：此前只有 `onClick`、连
                           * `tabIndex` 都没有，键盘用户完全进不来。键判据走 §16.2.4.57
                           * 的唯一出口（`simpleKeyHandler` 是属性展开，a11y 规则按字面量
                           * 找不到 `onKeyDown`，豁免登记在 `scripts/.a11y-rule-ledger.json`）。 */
                          tabIndex={0}
                          /* 选项行是 `role="checkbox"` 的可点整行（不是 `<button>`：行里
                           * 还有「点 label 选、点默认星切默认」两个动作，合成 button 会吞掉
                           * 后者的键语义）。Enter/Space 由 `simpleKeyHandler` 给（§16.2.4.57
                           * 唯一出口：只挂 `onClick` 就是「鼠标点得开、键盘进不来」）。 */
                          {...simpleKeyHandler(["Space", "Enter"], () => {
                            toggle(opt);
                          })}
                          className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs transition-colors ${
                            on ? "bg-primary-soft text-primary" : "text-ink/80 hover:bg-subtle"
                          }`}
                        >
                          <span
                            className={`grid size-3.5 shrink-0 place-items-center rounded border ${
                              on ? "border-primary bg-primary text-white" : "border-border bg-bg"
                            }`}
                          >
                            {on && <Check size={10} />}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{opt}</span>
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </div>

            {/* 自定义添加 */}
            <div className="border-border flex items-center gap-1.5 border-t px-2 py-1.5">
              <input
                onChange={textHandler(setCustom)}
                value={custom}
                {...enterCommit({ onCommit: addCustom })}
                className="border-border bg-bg focus:border-primary min-w-0 flex-1 rounded border px-1.5 py-0.5 text-xs outline-none"
                placeholder="没有想要的？自定义添加后回车"
              />
              <Button
                className="h-auto shrink-0 rounded px-2 py-0.5 text-xs font-medium text-white disabled:opacity-40"
                disabled={!custom.trim()}
                onClick={addCustom}
                type="button"
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
