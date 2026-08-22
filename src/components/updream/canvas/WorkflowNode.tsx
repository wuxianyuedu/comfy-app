/**
 * WorkflowNode.tsx — 自定义工作流节点的「设计驱动 + 功能承载」组件（内容层）。
 *
 * 视觉严格对齐 Ardot 稿 714503087315759（v2）：frame 3:12 NodeCard-v2。
 * 本文件是「测试自定义工作流」纯视觉稿（WorkflowNode.ardot.tsx）的功能版——
 * 同样的视觉元素（Card / Header / 3-chip / 端口行 / 生成按钮），叠加运行时逻辑：
 * NodeProps 数据、splitWorkflowIO 动态端口、生成按钮状态机。
 *
 * 与纯视觉稿的边界（按用户「除了测试节点有的元素，不要多加」）：
 *  - 不引入内层面板 #0B0B10（稿无）
 *  - 不引入结果卡 / 替换按钮（稿无，后续再补）
 *  - 端口 Handle 与稿一致：12px、描边 in #4D4D59 / out #16161C、投影、骑跨卡边
 *
 * R-ardot25 (2026-08-14): 3 个 chip 改为真正的「独立 dropdown」——之前 3 个 chip
 *  共享同一个 `open` state + 同一个 popover（点哪个都展同一个），用户体感"不是
 *  独立的"。新版每个 chip 自己控 open、自己位置、自己列表：
 *    ① SourceFilterChip（本机 / 在线 / 全部）— popover 内 3 radio
 *    ② WorkflowPickChip（受 SourceFilter 过滤的工作流列表）— popover 列名
 *    ③ ModePickChip（按当前工作流的 modes 配置多选 + 默认）— popover 完整 multi-select
 *
 * 外壳（Card 圆角14、无 overflow-hidden 以保护 Handle 骑跨）由 CanvasNode 持有。
 */
"use client";

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useStore } from "@xyflow/react";
import { DynamicWorkflowForm, PortHandle } from "@/components/updream/shared/DynamicWorkflowForm";
import { type WorkflowIOMap, splitWorkflowIO, ioLabel } from "@/components/updream/shared/workflow-io";
import { type CanvasNodeData, NODE_META, STATUS_LABEL } from "./canvas-types";
import { Icon } from "@/components/ui/Icon";
import { ALL_WORKFLOW_TYPES } from "@/lib/workflow-types";

export type WorkflowSourceFilter = "all" | "local" | "online";

export interface WorkflowModesState {
  modes: string[];
  defaultMode: string | null;
}

export interface WorkflowNodeProps {
  id: string;
  data: CanvasNodeData;
  /** 该工作流暴露的 IO 映射（来自 GET /api/workflows/[id]）。 */
  wfIO: WorkflowIOMap | null;
  wfIOLoading: boolean;
  /** 工作流列表是否仍在加载。为 true 时工作流选择区显示"加载中"而非空态。 */
  wfListLoading?: boolean;
  /** 完整工作流列表（含 sourcePath / taskType）。 */
  wfList: { id: string; name: string; taskType?: string; sourcePath?: string | null; modelTags?: string[] }[];
  /** R-ardot25: 当前工作流的 modes 配置（来自 /api/workflows/[id] 的 modes/defaultMode）。 */
  wfModes?: WorkflowModesState | null;
  /** R-ardot25: 父级（CanvasNode）持的来源筛选 — 影响 chip2 列表。 */
  sourceFilter?: WorkflowSourceFilter;
  /** 2026-08-15: 用户级模型标签库（全局），驱动 chip4 的模型筛选列表。 */
  modelTagLib?: { id: string; name: string; count: number }[];
  /** 2026-08-15: 画布节点会话级模型筛选值（"all" 或某标签名）。 */
  modelFilter?: string;
  onPatch: (p: Partial<CanvasNodeData>) => void;
  onSourceFilterChange: (f: WorkflowSourceFilter) => void;
  onModelFilterChange?: (f: string) => void;
  onGenerate: () => void;
  onSelectWorkflow: (v: string) => void;
  onFormChange: (next: Record<string, unknown>) => void;
  onSeedModeChange: (ioKey: string, mode: string) => void;
  onModesChange: (modes: string[], defaultMode: string) => void;
}

/* ── popover 通用工具 ──
 *  3 个 dropdown 共享同样的 portal + viewport 算法（up/down flip + 超出
 *  右边左移），但每个有自己的 triggerRef / open。 */
const POPOVER_MIN_W = 240;
const POPOVER_MAX_H = 320;
const VIEWPORT_MARGIN = 8;

function usePopoverPosition(open: boolean, triggerRef: React.RefObject<HTMLElement | null>, width: number) {
  const [pos, setPos] = useState({ left: 0, top: 0, width });
  useLayoutEffect(() => {
    if (!open) return;
    const r = () => {
      const t = triggerRef.current;
      if (!t) return;
      const rect = t.getBoundingClientRect();
      const w = Math.max(rect.width, width, POPOVER_MIN_W);
      const maxW = Math.max(0, window.innerWidth - VIEWPORT_MARGIN * 2);
      const popW = Math.min(w, maxW);
      let left = rect.left;
      if (left + popW > window.innerWidth - VIEWPORT_MARGIN) {
        left = Math.max(VIEWPORT_MARGIN, window.innerWidth - VIEWPORT_MARGIN - popW);
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
        width: popW,
      });
    };
    r();
    /* R-ardot38: 持续 rAF 重算 —— 画布 transform 变化时 trigger 在视口里的位置
     *  会动，但 React 不重渲染 useLayoutEffect 的 deps（open/width/triggerRef
     *  都没变）。关闭 popover 时立刻 cancel，零开销。 */
    let raf = 0;
    const tick = () => {
      r();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    window.addEventListener("scroll", r, true);
    window.addEventListener("resize", r);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", r, true);
      window.removeEventListener("resize", r);
    };
  }, [open, width, triggerRef]);
  return pos;
}

/* ── Dropdown 4 (2026-08-15)：按模型标签筛选工作流 ──
 *  列表来自用户级全局标签库 modelTagLib；选中某标签名即只显示挂了该标签的
 *  工作流。与「本机/在线」同源级筛选，互不写 patch，仅当前节点 lifespan 生效。 */
function ModelFilterChip({
  value,
  tags,
  onChange,
}: {
  value: string;
  tags: { id: string; name: string; count: number }[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const pos = usePopoverPosition(open, triggerRef, 200);

  useEffect(() => {
    if (!open) return;
    const h = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (e instanceof MouseEvent) {
        const target = e.target as Node | null;
        if (
          target &&
          !triggerRef.current?.contains(target) &&
          !popRef.current?.contains(target)
        ) {
          setOpen(false);
        }
      }
    };
    document.addEventListener("mousedown", h, true);
    document.addEventListener("click", h, true);
    document.addEventListener("keydown", h);
    return () => {
      document.removeEventListener("mousedown", h, true);
      document.removeEventListener("click", h, true);
      document.removeEventListener("keydown", h);
    };
  }, [open]);

  const label = value === "all" ? "全部模型" : value;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="nodrag nopan flex h-6 shrink-0 items-center gap-1.5 rounded-lg border border-[#FF5CA8]/[0.35] bg-[#1E1A2E] px-2.5 text-[12px]"
        title={value === "all" ? "按模型筛选" : `已筛选模型：${value}`}
      >
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: value === "all" ? "#FF5CA8" : "#FF8AC4" }}
        />
        <span
          className="max-w-[80px] truncate font-semibold text-[#FF8AC4]"
          style={{ fontFamily: "'Noto Sans SC', system-ui, sans-serif", fontSize: 10 }}
        >
          {label}
        </span>
        <span
          className={`shrink-0 text-[#6E6E80] transition-transform ${open ? "rotate-180" : ""}`}
          style={{ fontFamily: "'Inter', system-ui, sans-serif", fontSize: 9 }}
        >
          ▾
        </span>
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popRef}
            role="listbox"
            aria-label="按模型筛选工作流"
            style={{ position: "fixed", left: pos.left, top: pos.top, width: pos.width, zIndex: 50 }}
            className="max-h-72 overflow-y-auto rounded-lg border border-white/[0.08] bg-[#16161C] py-1 shadow-2xl shadow-fuchsia-500/20"
          >
            <button
              type="button"
              role="option"
              aria-selected={value === "all"}
              onClick={() => {
                onChange("all");
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] transition-colors ${
                value === "all" ? "bg-fuchsia-500/20 text-fuchsia-200" : "text-gray-300 hover:bg-white/[0.06]"
              }`}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#FF5CA8" }} />
              <span className="flex-1">全部模型</span>
              {value === "all" && <span className="text-fuchsia-300">✓</span>}
            </button>
            {tags.length === 0 && (
              <div className="px-3 py-2 text-[10px] text-gray-500">标签库为空，去工作流库「管理模型」添加</div>
            )}
            {tags.map((t) => {
              const sel = t.name === value;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="option"
                  aria-selected={sel}
                  onClick={() => {
                    onChange(t.name);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] transition-colors ${
                    sel ? "bg-fuchsia-500/20 text-fuchsia-200" : "text-gray-300 hover:bg-white/[0.06]"
                  }`}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#FF8AC4" }} />
                  <span className="flex-1 truncate">{t.name}</span>
                  <span className="text-[9px] tabular-nums text-gray-500">{t.count}</span>
                  {sel && <span className="text-fuchsia-300">✓</span>}
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
}

/* ── Dropdown 1：来源筛选（本机 / 在线 / 全部） ── */
function SourceFilterChip({
  value,
  onChange,
}: {
  value: WorkflowSourceFilter;
  onChange: (v: WorkflowSourceFilter) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const pos = usePopoverPosition(open, triggerRef, 160);

  useEffect(() => {
    if (!open) return;
    const h = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (e instanceof MouseEvent) {
        const target = e.target as Node | null;
        if (
          target &&
          !triggerRef.current?.contains(target) &&
          !popRef.current?.contains(target)
        ) {
          setOpen(false);
        }
      }
    };
    // Capture phase (R-ardot48): React Flow v12's pane handler calls
    // stopPropagation in the bubble phase, which can swallow our
    // document-level `mousedown` and leave the popover stuck open when
    // the user clicks the empty canvas. Listening in capture phase runs
    // us BEFORE any stopPropagation, and we also bind `click` because some
    // libraries only intercept the click phase.
    document.addEventListener("mousedown", h, true);
    document.addEventListener("click", h, true);
    document.addEventListener("keydown", h);
    return () => {
      document.removeEventListener("mousedown", h, true);
      document.removeEventListener("click", h, true);
      document.removeEventListener("keydown", h);
    };
  }, [open]);

  const isLocal = value === "local";
  const label = value === "all" ? "全部" : isLocal ? "本机" : "在线";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="nodrag nopan flex h-6 shrink-0 items-center gap-1.5 rounded-lg border border-[#7C5CFC]/[0.35] bg-[#1E1A2E] px-2.5 text-[12px]"
      >
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: value === "all" ? "#8B7CFC" : isLocal ? "#33D499" : "#8B7CFC" }}
        />
        <span
          className={`font-semibold ${
            value === "all" ? "text-[#A78BFA]" : isLocal ? "text-[#33D499]" : "text-[#A78BFA]"
          }`}
          style={{ fontFamily: "'Noto Sans SC', system-ui, sans-serif", fontSize: 10 }}
        >
          {label}
        </span>
        <span
          className={`shrink-0 text-[#6E6E80] transition-transform ${open ? "rotate-180" : ""}`}
          style={{ fontFamily: "'Inter', system-ui, sans-serif", fontSize: 9 }}
        >
          ▾
        </span>
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popRef}
            role="listbox"
            aria-label="工作流来源筛选"
            style={{ position: "fixed", left: pos.left, top: pos.top, width: pos.width, zIndex: 50 }}
            className="rounded-lg border border-white/[0.08] bg-[#16161C] py-1 shadow-2xl shadow-violet-500/20"
          >
            {(
              [
                { v: "all", label: "全部", dot: "#8B7CFC" },
                { v: "local", label: "本机", dot: "#33D499" },
                { v: "online", label: "在线", dot: "#8B7CFC" },
              ] as { v: WorkflowSourceFilter; label: string; dot: string }[]
            ).map((o) => {
              const sel = o.v === value;
              return (
                <button
                  key={o.v}
                  type="button"
                  role="option"
                  aria-selected={sel}
                  onClick={() => {
                    onChange(o.v);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] transition-colors ${
                    sel ? "bg-violet-500/20 text-violet-200" : "text-gray-300 hover:bg-white/[0.06]"
                  }`}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: o.dot }} />
                  <span className="flex-1">{o.label}</span>
                  {sel && <span className="text-violet-300">✓</span>}
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
}

/* ── Dropdown 2：工作流选择（受 SourceFilter 过滤） ── */
function WorkflowPickChip({
  value,
  options,
  onSelect,
  emptyHint,
  loading = false,
}: {
  value: string;
  options: { id: string; name: string; taskType?: string; sourcePath?: string | null; modelTags?: string[] }[];
  onSelect: (id: string) => void;
  emptyHint?: string;
  /** 列表仍在加载时显示"加载中"，避免把加载态误渲染成空态。 */
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const pos = usePopoverPosition(open, triggerRef, 280);

  useEffect(() => {
    if (!open) return;
    const h = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (e instanceof MouseEvent) {
        const target = e.target as Node | null;
        if (
          target &&
          !triggerRef.current?.contains(target) &&
          !popRef.current?.contains(target)
        ) {
          setOpen(false);
        }
      }
    };
    // Capture phase (R-ardot48): React Flow v12's pane handler calls
    // stopPropagation in the bubble phase, which can swallow our
    // document-level `mousedown` and leave the popover stuck open when
    // the user clicks the empty canvas. Listening in capture phase runs
    // us BEFORE any stopPropagation, and we also bind `click` because some
    // libraries only intercept the click phase.
    document.addEventListener("mousedown", h, true);
    document.addEventListener("click", h, true);
    document.addEventListener("keydown", h);
    return () => {
      document.removeEventListener("mousedown", h, true);
      document.removeEventListener("click", h, true);
      document.removeEventListener("keydown", h);
    };
  }, [open]);

  const sel = options.find((o) => o.id === value);
  const name = sel?.name ?? "选择工作流";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="nodrag nopan flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-[#7C5CFC]/[0.35] bg-[#1E1A2E] px-2.5 text-[12px]"
      >
        <span
          className="min-w-0 flex-1 truncate text-left font-semibold text-[#EDEDF2]"
          style={{ fontFamily: "'Inter', system-ui, sans-serif", fontSize: 11 }}
        >
          {loading && !sel ? (
            <span className="text-gray-500">加载中…</span>
          ) : sel ? (
            name
          ) : (
            <span className="text-gray-500">选择工作流…</span>
          )}
        </span>
        <span
          className={`shrink-0 text-[#6E6E80] transition-transform ${open ? "rotate-180" : ""}`}
          style={{ fontFamily: "'Inter', system-ui, sans-serif", fontSize: 9 }}
        >
          ▾
        </span>
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popRef}
            role="listbox"
            aria-label="选择工作流"
            style={{ position: "fixed", left: pos.left, top: pos.top, width: pos.width, zIndex: 50 }}
            className="max-h-72 overflow-y-auto rounded-lg border border-white/[0.08] bg-[#16161C] py-1 shadow-2xl shadow-violet-500/20"
          >
            {options.length === 0 &&
              (loading ? (
                <div className="flex items-center gap-2 px-3 py-3 text-[11px] text-gray-500">
                  <Icon name="loader" size={12} className="animate-spin" />
                  加载中…
                </div>
              ) : (
                <div className="px-3 py-3 text-[11px] text-gray-500">
                  {emptyHint ?? "暂无符合筛选的工作流"}
                </div>
              ))}
            {options.map((o) => {
              const ol = Boolean(o.sourcePath);
              const active = o.id === value;
              return (
                <button
                  key={o.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onSelect(o.id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] transition-colors ${
                    active ? "bg-violet-500/20 text-violet-200" : "text-gray-300 hover:bg-white/[0.06]"
                  }`}
                >
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${ol ? "bg-emerald-400" : "bg-violet-400"}`} />
                  <span className="min-w-0 flex-1 truncate">{o.name}</span>
                  {o.taskType && (
                    <span className="shrink-0 rounded bg-white/[0.06] px-1.5 py-0.5 text-[9.5px] text-[#9A9AAD]">
                      {o.taskType}
                    </span>
                  )}
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
}

/* ── Dropdown 3：单选模式切换（R-ardot36）────
 *  之前是「全 37 种模式 + checkbox 多选 + 默认切换 + 保存」；现在简化为：
 *    · 弹层只列当前工作流 `modes` 里的模式（filter ALL_WORKFLOW_TYPES），
 *      按 modes 顺序排，不再分 image/video/audio 大类；
 *    · 单选 radio dot，**不**显示 checkbox；
 *    · 点行即 onChange(modes, newDefault) + 关弹层，**无** footer / **无** 保存按钮。
 *  业务侧 modes 数组不变（工作流模板的固有属性，由库维护），只切 defaultMode；
 *  实际执行是后端 PATCH /api/workflows/[id] 时把 defaultMode 同步到 taskType。 */
function ModePickChip({
  modes,
  defaultMode,
  onChange,
  disabled,
}: {
  modes: string[];
  defaultMode: string | null;
  onChange: (modes: string[], defaultMode: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const pos = usePopoverPosition(open, triggerRef, 240);

  useEffect(() => {
    if (!open) return;
    const h = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (e instanceof MouseEvent) {
        const target = e.target as Node | null;
        if (
          target &&
          !triggerRef.current?.contains(target) &&
          !popRef.current?.contains(target)
        ) {
          setOpen(false);
        }
      }
    };
    // Capture phase (R-ardot48): React Flow v12's pane handler calls
    // stopPropagation in the bubble phase, which can swallow our
    // document-level `mousedown` and leave the popover stuck open when
    // the user clicks the empty canvas. Listening in capture phase runs
    // us BEFORE any stopPropagation, and we also bind `click` because some
    // libraries only intercept the click phase.
    document.addEventListener("mousedown", h, true);
    document.addEventListener("click", h, true);
    document.addEventListener("keydown", h);
    return () => {
      document.removeEventListener("mousedown", h, true);
      document.removeEventListener("click", h, true);
      document.removeEventListener("keydown", h);
    };
  }, [open]);

  /* R-ardot38: 画布 pan/zoom (s.transform 变化) 时主动关弹层 ——
   *  节点被拖走后 popover 即使有 rAF 跟位置也会"飘"，体验不好；
   *  用户更自然的预期是画布动一下弹层就消失。close 由父组件 cleanup 触发。 */
  const transform = useStore((s) => s.transform);
  useEffect(() => {
    if (!open) return;
    setOpen(false);
  }, [transform]);

  const defType = ALL_WORKFLOW_TYPES.find((t) => t.code === defaultMode);
  const triggerLabel = defType?.label ?? defaultMode ?? "未选";
  const hasModes = modes.length > 0;

  /* 按 `modes` 顺序过滤 — 工作流模板的 modes 数组是"权威列表"，
   * 弹层严格只列这 N 个。ALL_WORKFLOW_TYPES 是查 label/code 元数据用。 */
  const items = useMemo(
    () =>
      modes
        .map((code) => ALL_WORKFLOW_TYPES.find((t) => t.code === code))
        .filter((t): t is (typeof ALL_WORKFLOW_TYPES)[number] => Boolean(t)),
    [modes]
  );

  const pick = (code: string) => {
    if (code === defaultMode) {
      setOpen(false);
      return;
    }
    onChange(modes, code);
    setOpen(false);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className={`nodrag nopan flex h-6 shrink-0 items-center gap-1.5 rounded-lg border border-[#7C5CFC]/[0.55] bg-[#1E1A2E] px-2.5 text-[12px] ${
          disabled ? "opacity-50" : ""
        }`}
      >
        <span
          className={`font-semibold ${hasModes ? "text-[#EDEDF2]" : "text-gray-500"}`}
          style={{ fontFamily: "'Inter', system-ui, sans-serif", fontSize: 10 }}
        >
          {hasModes ? triggerLabel : "未选"}
        </span>
        {/* R-ardot38: 不再显示 +N 徽章 — 弹层只列工作流实际支持的 N 个模式，
         *  trigger 只展示当前默认，没必要再用 +N 暗示"还有几个未展示" */}
        <span
          className={`shrink-0 text-[#9A9AAD] transition-transform ${open ? "rotate-180" : ""}`}
          style={{ fontFamily: "'Inter', system-ui, sans-serif", fontSize: 9 }}
        >
          ▾
        </span>
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popRef}
            role="listbox"
            aria-label="工作流模式选择"
            style={{ position: "fixed", left: pos.left, top: pos.top, width: pos.width, zIndex: 50 }}
            className="rounded-xl border border-white/[0.08] bg-[#16161C] py-1 shadow-2xl shadow-violet-500/20"
          >
            {/* R-ardot36: 仅展示工作流 modes 数组里的 N 个，单选 + 点选即切换 */}
            {items.length === 0 ? (
              <div className="px-3 py-3 text-center text-[11px] text-[#9A9AAD]">
                该工作流没有声明可用模式
              </div>
            ) : (
              items.map((t) => {
                const isDef = defaultMode === t.code;
                return (
                  <div
                    key={t.code}
                    role="option"
                    aria-selected={isDef}
                    tabIndex={0}
                    onClick={() => pick(t.code)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        pick(t.code);
                      }
                    }}
                    className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[12px] transition-colors ${
                      isDef
                        ? "bg-violet-500/[0.14] text-violet-100"
                        : "text-gray-200 hover:bg-white/[0.04]"
                    }`}
                  >
                    {/* radio dot — 单选，无 checkbox */}
                    <span
                      className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${
                        isDef
                          ? "border-violet-400 bg-violet-500/20"
                          : "border-white/[0.20] bg-white/[0.02]"
                      }`}
                    >
                      {isDef && (
                        <span className="h-1.5 w-1.5 rounded-full bg-violet-300" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {t.label}
                    </span>
                    <span
                      className="shrink-0 rounded bg-white/[0.06] px-1 py-px text-[9.5px] text-[#9A9AAD]"
                      style={{ fontFamily: "'Inter', system-ui, sans-serif" }}
                    >
                      {t.code}
                    </span>
                  </div>
                );
              })
            )}
          </div>,
          document.body
        )}
    </>
  );
}

export function WorkflowNode({
  id,
  data: d,
  wfIO,
  wfIOLoading,
  wfListLoading = false,
  wfList,
  wfModes,
  sourceFilter = "all",
  modelTagLib = [],
  modelFilter = "all",
  onSourceFilterChange,
  onModelFilterChange,
  onGenerate,
  onSelectWorkflow,
  onFormChange,
  onSeedModeChange,
  onModesChange,
}: WorkflowNodeProps) {
    const meta = NODE_META[d.kind];

  /* 2026-08-22: 右上角显示「短序号」#1/#2…（按画布节点列表顺序）。
   * useStore 选择器结果不变时不触发重渲染：拖动/选中只改位置不改变 index，
   * 仅节点增删导致序号变化时才重渲染此节点。完整 id 保留在 title 中。 */
  const nodeSeq = useStore((s) => {
    const idx = s.nodes.findIndex((n) => n.id === id);
    return idx === -1 ? null : idx + 1;
  });

  /* R-ardot52 (2026-08-15): 在所有输入参数下方渲染 outputs row — 用户在
   *  IO-edit 配的 output 在画布节点上要可见。Header (h-8) 不放，回到 Ardot
   *  设计稿 v2 的「W + 标题 + 状态胶囊」三件套；outputs 单独成段放在
   *  DynamicWorkflowForm 之后、生成按钮之前。
   *  R-ardot53 (2026-08-15): outputs 视觉与 inputs 严格对齐成「双行结构」—
   *  第 1 行 labelRow（IO 紫点 + label + COMBO typeChip），第 2 行 dim 占位
   *  控件（h-28 与 inputs 控件行同高），端点 PortHandle 放最右（dir="out",
   *  right:-6）。`inputs` 一并解构出来给 ioLabel() 用作组内去重。 */
  const { inputs, outputs } = splitWorkflowIO(wfIO);

  /* R-ardot25: 按 sourceFilter 过滤 chip2 列表 — 让 chip1 真正参与决策。
   * 2026-08-15: 叠加模型筛选 — chip4 选中的标签名必须命中工作流的 modelTags。 */
  const filteredList = wfList.filter((w) => {
    if (sourceFilter === "all") return true;
    if (sourceFilter === "local") return Boolean(w.sourcePath);
    return !w.sourcePath;
  }).filter((w) => {
    if (modelFilter === "all") return true;
    const tags = w.modelTags ?? [];
    return tags.includes(modelFilter);
  });

  return (
    <>
      {/* 头部：W 图标 + 标题 + 状态胶囊（Ardot token，与测试节点一致） */}
      <div className="flex h-8 min-w-0 items-center justify-between gap-2 pl-[14px] pr-[14px]">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-label="类型 工作流"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[14px] text-[14px] font-bold text-[#7C5CFC]"
            style={{ background: "#2A1F4A", fontFamily: "'Inter', system-ui, sans-serif" }}
          >
            W
          </span>
          <span
            className="truncate text-[14px] font-bold text-[#EDEDF2]"
            style={{ fontFamily: "'Noto Sans SC', system-ui, sans-serif" }}
            title={meta.label}
          >
            {meta.label}
          </span>
        </div>
        <div
          className="flex h-5 shrink-0 items-center gap-[5px] rounded-[11px] bg-[#1E1A2E] px-2"
          title={`项目画布节点 Id：${id}`}
        >
          <span
            className="font-mono text-[10px] font-semibold text-cyan-200"
            style={{ fontFamily: "'JetBrains Mono', 'Fira Code', ui-monospace, monospace" }}
          >
            {nodeSeq !== null ? `#${nodeSeq}` : `#${id.length > 10 ? id.slice(0, 9) + "…" : id}`}
          </span>
        </div>
      </div>

      {/* 分隔线 340×1 #26262E */}
      <div className="h-px bg-[#26262E]" />

      {/* R-ardot83: 拆双行 — 头部窄节点挤 4 chip，按用户给优先级排。
       *   Row 1 (高优先级，筛选类)  ① SourceFilterChip + ④ ModelFilterChip
       *   Row 2 (中优先级，配置类)  ② WorkflowPickChip (flex-1) + ③ ModePickChip
       *  2026-08-16: 之前单行 h-11 在 ~300px 节点宽度下 WorkflowPickChip 被压
       *  截断成 "ima..."。拆行后 WorkflowPickChip 独占一行可读全名。 */}
      <div className="flex flex-col gap-1 pb-1.5 pl-[14px] pr-[14px]">
        {/* Row 1 — 高优先级筛选 chip：来源 + 模型 */}
        <div className="flex h-7 min-w-0 items-center gap-1">
          <SourceFilterChip value={sourceFilter} onChange={onSourceFilterChange} />
          <ModelFilterChip value={modelFilter} tags={modelTagLib} onChange={(v) => onModelFilterChange?.(v)} />
        </div>
        {/* Row 2 — 配置 chip：当前所选工作流 (flex-1) + 模式 */}
        <div className="flex h-7 min-w-0 items-center gap-1">
          <WorkflowPickChip
            value={d.workflowId ?? ""}
            options={filteredList}
            onSelect={onSelectWorkflow}
            loading={wfListLoading}
            emptyHint={
              sourceFilter !== "all"
                ? `当前筛选下没有工作流，切换「${sourceFilter === "local" ? "本机" : "在线"}」试试`
                : modelFilter !== "all"
                  ? `当前模型「${modelFilter}」下没有工作流`
                  : "暂无工作流，先去工作流库导入"
            }
          />
          <ModePickChip
            modes={wfModes?.modes ?? []}
            defaultMode={wfModes?.defaultMode ?? null}
            onChange={onModesChange}
            disabled={!d.workflowId}
          />
        </div>
      </div>

      {/* 动态表单：由工作流暴露的 IO 驱动，端口 Handle 与测试节点一致骑跨卡边
       *  R-ardot21 (2026-08-14): `showOutputs={false}` — 在画布场景下，workflow
       *  节点是叶节点（生成图片/视频），不需要被 wire 到下一个节点；显示
       *  右侧紫色 images 输出 Handle 会让用户误以为是漏出的 bug（"那个
       *  圆点不要"）。CreatePanel 路径仍走 `showOutputs={true}`，不影响。 */}
      <DynamicWorkflowForm
        io={wfIO ?? undefined}
        loading={wfIOLoading}
        values={d.workflowInputs ?? {}}
        onChange={onFormChange}
        compact
        showOutputs={false}
        workflowId={d.workflowId}
        seedModes={d.seedModes}
        onSeedModeChange={onSeedModeChange}
      />

      {/* R-ardot54 (2026-08-15): outputs row — 收成单行 labelRow（label + 右侧 type chip）。
       *  与 inputs labelRow 视觉严格一致，端点 PortHandle 放最右（dir="out"，right:-6），
       *  style top:16 锁 label-row 中线（pt-1.5=6 + h-5/2=10 = 16px）。
       *  不再放 dim 占位控件行——outputs 是只读语义，labelRow 已经说清楚「● images | IMAGE」
       *  这是一个输出端口，多一行业务信息也只会冗余。 */}
      {outputs.length > 0 && (
        <div className="border-t border-white/[0.06]">
          {outputs.map((o) => {
            /* 2026-08-15: conflict-aware — 与 inputs/outputs 同 group 去重。
             *  即使两个 outputs 同 label（如两个 IMAGE 都叫 "image"）也回退 name。 */
            const oLabel = ioLabel(o, [...inputs, ...outputs]);
            const oType = o.type;
            return (
              <div
                key={o.nodeId + ":" + o.name}
                className="relative"
              >
                {/* R-ardot58 (2026-08-15): 圆点几何位置上推 2px — 用户反馈
                 *  R-ardot57 的 `top:16`（= labelRow 中线 y=16）虽然几何计算
                 *  完美（pt-1.5=6 + h-5/2=10 = 16），但实际渲染圆点仍视觉下
                 *  偏 1-2px（React Flow Handle 自身 transform + 小圆点抗锯齿
                 *  的「向下漂移」错觉）。top:14 把圆心放到 y=14，比 chip 中线
                 *  16 往上 2px，对抗视觉下偏。PortHandle 12×12 圆, 圆心 y=14
                 *  ⇒ 圆可视 y=8..20, 落在 labelRow y=6..26 范围内居中略偏上,
                 *  视觉与 chip 中线 16 重合。boxShadow: \"none\" 关掉默认下偏
                 *  阴影（4px y blur 4px 向下晕 8px 是主要下偏源）。 */}
                <PortHandle
                  id={o.ioKey}
                  dir="out"
                  type={oType ?? "*"}
                  style={{
                    right: -6,
                    top: 14,
                    transform: "translateY(-50%)",
                    boxShadow: "none",
                  }}
                />
                {/* R-ardot56 (2026-08-15): 单行 labelRow — 与 inputs labelRow 镜像
                 *  顺序一致 = [label | typeChip]（label 在左、type 在右）。
                 *  `justify-end` 把整组贴紧 Card 右沿；端点 PortHandle 圆心锁
                 *  labelRow 中线（pt-1.5=6 + h-5/2=10=16px），与 typeChip 上下对齐。 */}
                <div className="flex h-5 items-center justify-end gap-1.5 px-[14px] pt-1.5">
                  <span
                    className="min-w-0 truncate text-[12px] font-semibold text-[#EDEDF2]"
                    style={{ fontFamily: "'Inter', system-ui, sans-serif" }}
                    title={`IO 输出 · ${oLabel}${oType ? ` · ${oType}` : ""}`}
                  >
                    {oLabel}
                  </span>
                  <span
                    className="inline-flex shrink-0 items-center rounded-[3px] px-1.5 py-0.5 text-[10px] font-semibold"
                    style={{
                      fontFamily: "'Inter', system-ui, sans-serif",
                      background: "#26262E",
                      color: "#9A9AAD",
                    }}
                  >
                    {oType}
                  </span>
                </div>
                {/* 下沿留 pb-2 让节点呼吸——与 inputs controlRow 末端的 pb-1.5 保持视觉等距 */}
                <div className="pb-2" />
              </div>
            );
          })}
        </div>
      )}

      {/* 生成按钮：全宽渐变，底部圆角贴合 Card（Card 无 overflow-hidden，故按钮自带 rounded-b） */}
      <button
        type="button"
        disabled={d.status === "running"}
        onClick={onGenerate}
        className="nodrag nopan flex h-[43px] w-full items-center justify-center gap-2 rounded-b-[14px] bg-gradient-to-r from-[#7C5CFC] to-[#FF5CA8] text-[13px] font-bold text-white shadow-[0_4px_12px_rgba(124,92,252,0.35)] transition-opacity hover:opacity-95 disabled:opacity-40"
        style={{ fontFamily: "'Noto Sans SC', system-ui, sans-serif" }}
      >
        {d.status === "running" ? "生成中…" : "▶ 用此工作流生成"}
      </button>
    </>
  );
}

export default React.memo(WorkflowNode);
