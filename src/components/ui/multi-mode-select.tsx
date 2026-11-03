"use client";

/** MultiModeSelect —— 一个工作流可挂多种模式（multi-select chip）：主 chip 显示默认 mode（按所在分类着色）、+N pill 弱化占位；点任一入口开同一个多选 popover（搜索 label / code / subCategory、按 image / video / audio 分类分组页签、每行 = checkbox + label + code + 默认 toggle、底部取消 / 保存并显示已选条数）。
 * 浮层走 `~/components/ui/popover`（规范 16 §16.2.3 P2）：此前这里照抄了 SelectMenu 的全套自搓浮层（portal + fixed 定位 + 滚动重定位 + 手写 Esc / 外点关闭 + z-index 魔数），同一件事在库里有两份副本；现在定位与关闭语义交给 base-ui，本组件只留「多选 + 草稿」。
 * 为什么没合到 shadcn `Combobox`（P67 §12.18 中间地带 · 已评估保留；曾装的 Base UI 版 Combobox 因 src 内 0 消费点已删除）：本件有 3 条 Combobox 撑不住的复合语义 —— ① draft / apply 事务（面板内 `useState<Set<string>>(new Set(modes))` 起草稿，只有点「保存」才 onChange 回父层、取消直接关不改动；Combobox 是即时选中即 onChange，硬合等于把 Combobox 二次包装再多做套状态同步）；② `defaultMode` 指针（`modes` 里额外标一位默认并显示在 chip 主色上，`draftDefault` 随草稿编辑、保存时若被取消勾选回退到 `arr[0]` 以保证 defaultMode ⊆ modes；Combobox 只有一维选中集）；③ 分类页签（打开时定位到第一个已选模式的分类、每段独立展示候选；Combobox 是单一搜索列表、没有页签维度）。
 * 三条业务判据叠加，本件是「草稿事务化的多选编辑器」、Combobox 是「即选即提交的可搜索下拉」—— 语义不同，保留自绘（§12.18）；共性（浮层定位 / 外点关闭 / Esc）已吃 base-ui Popover，独立的 draft / tab / default 三态是本件核心。若未来重新引入 Base UI Combobox 或本件被拆解，这段选型论证需重新评估。 */

import { useCallback, useMemo, useState } from "react";
import { textHandler } from "~/lib/form-props";

import { Button } from "~/components/ui/button";
import { enterCommit } from "~/components/ui/use-enter-commit";
import { simpleKeyHandler } from "~/components/ui/simple-key-handler";
import { matchesNeedle, normalizeNeedle } from "~/lib/list-filter";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { ALL_WORKFLOW_TYPES, type WorkflowCategory } from "~/lib/workflow/workflow-types";

/* ── per-category pill colors（走语义 token，规范 03 §3.6.2）── */
const CATEGORY_PILL: Record<WorkflowCategory, string> = {
  image: "bg-primary-500/15 ring-1 ring-inset ring-primary-500/25",
  video: "bg-info/15 ring-info/25 ring-1 ring-inset",
  audio: "bg-warning/15 ring-warning/25 ring-1 ring-inset",
};
const CATEGORY_TEXT: Record<WorkflowCategory, string> = {
  image: "text-primary-strong",
  video: "text-info-strong",
  audio: "text-warning-strong",
};
const CATEGORY_LABEL: Record<WorkflowCategory, string> = {
  image: "图像",
  video: "视频",
  audio: "音频",
};
/* 当前页签下划线的高亮色 */
const CATEGORY_ACCENT: Record<WorkflowCategory, string> = {
  image: "bg-primary-400",
  video: "bg-info",
  audio: "bg-warning",
};

type MultiModeSelectProps = {
  className?: string;
  /** 默认模式码（defaultMode 必须 ∈ `modes`）。 */
  defaultMode: string;
  disabled?: boolean;
  /** 隐藏右侧的「+N」徽标：调用方（如详情页）自行把全部模式列在上方，
   *  徽标就成了冗余。popover 仍可从主 chip 打开。 */
  hideExtraBadge?: boolean;
  /** 全部已选模式码（defaultMode ⊆ modes）。空数组 → 空 chip。 */
  modes: Array<string>;
  onChange: (modes: Array<string>, defaultMode: string) => void;
};

const POPOVER_MAX_H = 360;

export function MultiModeSelect({
  modes,
  defaultMode,
  onChange,
  className = "",
  disabled = false,
  hideExtraBadge = false,
}: MultiModeSelectProps) {
  const [open, setOpen] = useState(false);
  // 浮层当前展示的分类页签（图像/视频/音频）。
  const [activeTab, setActiveTab] = useState<WorkflowCategory>("image");
  // 浮层内的草稿状态 —— 只在保存时提交。
  const [draft, setDraft] = useState<Set<string>>(new Set(modes));
  /** 弹窗内的默认模式草稿（必须 ∈ draft），保存时一并落库。 */
  const [draftDefault, setDraftDefault] = useState<string>(defaultMode);
  const [query, setQuery] = useState("");

  // 只在浮层由关闭转为打开时重置草稿。
  // 用户正在勾选时**不要**重置，否则父组件带着新的 `modes` 数组引用重渲染，
  // 就会把用户的选择抹掉。
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setDraft(new Set(modes));
      setDraftDefault(defaultMode);
      setQuery("");
      // 打开时定位到第一个已选模式的分类（回退到图像）。
      const firstSelected = ALL_WORKFLOW_TYPES.find((type) => modes.includes(type.code));
      setActiveTab(firstSelected?.category ?? "image");
    }
  }

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
    const arr = [...draft];
    // 默认模式取弹窗内的草稿；草稿被取消勾选时回退到第一个选中项，
    // 保证 defaultMode ⊆ modes 的约束成立。
    const def = arr.includes(draftDefault) ? draftDefault : (arr[0] ?? "");
    onChange(arr, def);
    setOpen(false);
  }, [draft, draftDefault, onChange]);

  // chip 的高亮色由默认模式的分类决定。
  const accent = useMemo(() => {
    const first = ALL_WORKFLOW_TYPES.find((type) => modes.includes(type.code));
    const def = ALL_WORKFLOW_TYPES.find((type) => type.code === defaultMode);
    const cat: WorkflowCategory = first?.category ?? def?.category ?? "image";
    return { pill: CATEGORY_PILL[cat], text: CATEGORY_TEXT[cat] };
  }, [modes, defaultMode]);

  // 过滤并按分类归并后的选项，供浮层使用。
  const grouped = useMemo(() => {
    /* 归一化（trim + 折小写）走 `~/lib/list-filter`（规范 16 §16.2.4.16）；
     * 「可搜哪四个字段」是本域判据，留在调用处。 */
    const lowerQuery = normalizeNeedle(query);
    const filtered = ALL_WORKFLOW_TYPES.filter(
      (type) =>
        matchesNeedle(lowerQuery, type.code) ||
        matchesNeedle(lowerQuery, type.label) ||
        matchesNeedle(lowerQuery, type.subCategory ?? "") ||
        matchesNeedle(lowerQuery, type.fullName),
    );
    const groupedMap: Partial<Record<WorkflowCategory, typeof ALL_WORKFLOW_TYPES>> = {};
    for (const type of filtered) {
      (groupedMap[type.category] ??= []).push(type);
    }
    return groupedMap;
  }, [query]);

  /* 当前页签分类下的模式项（无命中时列表区渲染空态）。 */
  const items = grouped[activeTab] ?? [];

  const firstSelected = ALL_WORKFLOW_TYPES.find((type) => modes.includes(type.code));
  const mainLabel = firstSelected ? firstSelected.label : "选择模式";
  const plusN = Math.max(0, modes.length - 1);

  return (
    /* SAFETY: 类型断言已复核 */
    <Popover onOpenChange={setOpen} open={open}>
      <span
        className={`inline-flex items-center gap-1 ${disabled ? "pointer-events-none opacity-50" : ""}`}
      >
        {/* 主 chip —— 点击它打开浮层 */}
        <PopoverTrigger
          render={
            <Button
              className={`text-2xs h-auto gap-1 rounded-md px-2 py-0.5 font-medium hover:brightness-110 ${accent.pill} ${accent.text} ${className}`}
              disabled={disabled}
              variant="ghost"
            />
          }
          title={`当前 ${modes.length} 种模式 · 点击管理`}
        >
          <span>{modes.length === 0 ? "选择模式" : mainLabel}</span>
          <svg className="shrink-0" fill="none" height="10" viewBox="0 0 12 12" width="10">
            <path
              d="M3 4.5L6 7.5L9 4.5"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.5"
            />
          </svg>
        </PopoverTrigger>

        {/* +N pill —— 点击它也打开同一个浮层 */}
        {plusN > 0 && !hideExtraBadge && (
          <Button
            className="text-ink-faint bg-primary-500/10 hover:bg-primary-500/20 hover:text-primary-strong text-2xs h-auto rounded-md px-1.5 py-0.5 font-medium"
            onClick={() => {
              setOpen(true);
            }}
            title={`还有 ${plusN} 种其他模式，点击管理`}
            variant="ghost"
          >
            +{plusN}
          </Button>
        )}
      </span>

      <PopoverContent
        align="start"
        aria-label="工作流模式编辑器"
        className="border-border-strong bg-card w-[min(92vw,320px)] gap-0 overflow-hidden rounded-xl p-0 shadow-2xl shadow-black/5 dark:shadow-black/40"
        role="dialog"
        sideOffset={4}
      >
        {/* search */}
        <div className="border-border-subtle border-b p-2">
          <input
            autoFocus
            onChange={textHandler(setQuery)}
            placeholder="搜索模式（标签 / 缩写）…"
            type="text"
            value={query}
            {...enterCommit({ onCommit: handleSave })}
            className="bg-subtle text-ink-bright placeholder:text-ink-fainter focus:bg-surface-2 focus:ring-primary-500/30 w-full rounded-md px-2.5 py-1.5 text-sm transition-colors outline-none focus:ring-1"
          />
        </div>

        {/* tabs — switchable 图像 / 视频 / 音频 */}
        <div className="border-border-subtle flex items-center gap-1 border-b px-2 pt-2">
          {(["image", "video", "audio"] as Array<WorkflowCategory>).map((cat) => {
            const selCount = (grouped[cat] ?? []).filter((type) => draft.has(type.code)).length;
            const isActive = activeTab === cat;
            return (
              <Button
                className={`relative h-auto flex-1 rounded-t-md px-2 py-1.5 text-xs font-semibold ${
                  isActive
                    ? `${CATEGORY_TEXT[cat]} bg-surface-2 hover:bg-surface-2`
                    : "text-ink-muted hover:text-ink-strong"
                }`}
                key={cat}
                onClick={() => {
                  setActiveTab(cat);
                }}
                variant="ghost"
              >
                {CATEGORY_LABEL[cat]}
                {selCount > 0 && (
                  <span className={`text-3xs ml-1 ${CATEGORY_TEXT[cat]}`}>{selCount}</span>
                )}
                {isActive && (
                  <span
                    className={`absolute inset-x-2 -bottom-px h-0.5 rounded-full ${CATEGORY_ACCENT[cat]}`}
                  />
                )}
              </Button>
            );
          })}
        </div>

        {/* 列表 —— 只列当前页签分类下的项 */}
        <div className="overflow-y-auto py-1" style={{ maxHeight: POPOVER_MAX_H }}>
          {items.length === 0 ? (
            <div className="text-ink-muted px-3 py-4 text-center text-xs">
              {query.trim() ? "没有匹配的模式" : `${CATEGORY_LABEL[activeTab]}暂无模式`}
            </div>
          ) : (
            items.map((item) => {
              const isSelected = draft.has(item.code);
              const isDraftDefault = draftDefault === item.code;
              return (
                /* 键出口是 `{...simpleKeyHandler(…)}` 的**属性展开**，而
                 * `jsx-a11y/click-events-have-key-events` 只读字面量 `onKeyDown`
                 * —— 规则认不出展开。豁免已在 `scripts/.a11y-rule-ledger.json`
                 * 的 `inlineExemptions` 登记（守它的是 `check-click-keyboard.cjs`）。 */
                /* oxlint-disable-next-line jsx_a11y/click-events-have-key-events -- 键出口是 simpleKeyHandler 的属性展开，规则读不到 */
                <div
                  className={`flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left transition-colors ${
                    isSelected
                      ? "bg-primary-500/10 text-primary-strong"
                      : "text-ink-strong hover:bg-subtle"
                  }`}
                  key={item.code}
                  /* 选项行是 `role="checkbox"` 的可点整行（不是 `<button>`），因此必须自带键盘等价物：ARIA 的 `checkbox` 角色承诺「Space 可切换」，只挂 `onClick` 就是「鼠标点得开、键盘进不来」。
                   * 键判据走 `simpleKeyHandler`（§16.2.4.57 的唯一出口：归一键名 + `preventDefault` 显式），不在这里手写第二份 `event.key === " "` —— 那正是这条账要消除的形态。 */
                  onClick={() => {
                    toggle(item.code);
                  }}
                  {...simpleKeyHandler(["Space", "Enter"], () => {
                    toggle(item.code);
                  })}
                  aria-checked={isSelected}
                  role="checkbox"
                  tabIndex={0}
                >
                  {/* checkbox: 每个被选中的模式都显示勾选标记 */}
                  <span
                    className={`flex size-4 shrink-0 items-center justify-center rounded border ${
                      isSelected
                        ? "border-primary-500/60 bg-primary-500/30"
                        : "border-border-strong bg-card"
                    }`}
                  >
                    {isSelected && (
                      <svg fill="none" height="10" viewBox="0 0 12 12" width="10">
                        <path
                          d="M2.5 6l2.5 2.5L9.5 3.5"
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="1.5"
                        />
                      </svg>
                    )}
                  </span>
                  <span className="flex-1 truncate text-sm font-medium">{item.label}</span>
                  {/* 默认模式标记：点星星把该模式设为默认（未选中会顺带勾上） */}
                  <Button
                    className={`text-3xs h-auto shrink-0 rounded px-1 py-0.5 font-medium ${
                      isDraftDefault
                        ? "bg-primary-500/25 text-primary-strong hover:bg-primary-500/25"
                        : "text-ink-muted hover:bg-surface-2 hover:text-ink-strong"
                    }`}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (!draft.has(item.code)) {
                        toggle(item.code);
                      }
                      setDraftDefault(item.code);
                    }}
                    title={isDraftDefault ? "当前默认模式" : "设为默认模式"}
                    variant="ghost"
                  >
                    {isDraftDefault ? "★ 默认" : "☆ 默认"}
                  </Button>
                  <span className={`text-2xs shrink-0 ${CATEGORY_TEXT[activeTab]} opacity-60`}>
                    {item.code}
                  </span>
                </div>
              );
            })
          )}
        </div>

        {/* footer */}
        <div className="border-border-subtle flex items-center gap-2 border-t p-2">
          <Button
            className="h-auto flex-1 rounded-md px-3 py-1.5 text-sm"
            onClick={() => {
              setOpen(false);
            }}
            variant="secondary"
          >
            取消
          </Button>
          <Button
            className="h-auto flex-1 rounded-md px-3 py-1.5 text-sm font-semibold"
            disabled={draft.size === 0}
            onClick={handleSave}
            variant="primary-solid"
          >
            保存（{draft.size}）
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
