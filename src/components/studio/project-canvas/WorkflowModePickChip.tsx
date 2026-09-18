"use client";

/** extracted from WorkflowNode.tsx — mode picker chip
 *  (Dropdown 3, ) + the canvas-transform auto-close watcher.
 *  Behaviour and visuals unchanged.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useStore } from "@xyflow/react";
import { ALL_WORKFLOW_TYPES } from "~/lib/workflow/workflow-types";
import { usePopoverDismiss, usePopoverPosition } from "./workflow-node-popover";

interface WorkflowModePickChipProps {
  modes: string[];
  defaultMode: string | null;
  onChange: (modes: string[], defaultMode: string) => void;
  disabled?: boolean;
}

/* transform 订阅收敛（商业级性能）。
 * 之前 ModePickChip 顶层常驻订阅 state.transform —— 画布每 pan/zoom 一次，
 * 所有工作流节点都会跟着全量重渲染，即使 99% 的节点弹层根本没打开。
 * 现在把订阅下沉到只在弹层打开时才挂载的 PopoverAutoClose：
 *   - 弹层关闭（绝大多数时间）：零订阅，画布缩放/平移完全不碰这些节点；
 *   - 弹层打开：仅该节点订阅 transform，画布一动就关弹层（行为与原来一致）。
 * 语义等价：挂载首帧跳过，transform 首次变化即关闭；卸载即取消订阅。 */
function PopoverAutoClose({ onClose }: { onClose: () => void }) {
  const transform = useStore((state) => state.transform);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    onClose();
  }, [transform, onClose]);
  return null;
}

export function WorkflowModePickChip({
  modes,
  defaultMode,
  onChange,
  disabled,
}: WorkflowModePickChipProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const pos = usePopoverPosition(open, triggerRef, 240);
  usePopoverDismiss(open, triggerRef, popRef, () => setOpen(false));

  const defType = ALL_WORKFLOW_TYPES.find(
    (ALL_WORKFLOW_TYPES) => ALL_WORKFLOW_TYPES.code === defaultMode,
  );
  const triggerLabel = defType?.label ?? defaultMode ?? "未选";
  const hasModes = modes.length > 0;

  /* 按 `modes` 顺序过滤 — 工作流模板的 modes 数组是"权威列表"，
   * 弹层严格只列这 N 个。ALL_WORKFLOW_TYPES 是查 label/code 元数据用。 */
  const items = useMemo(
    () =>
      modes
        .map((code) => ALL_WORKFLOW_TYPES.find((def) => def.code === code))
        .filter((t): t is (typeof ALL_WORKFLOW_TYPES)[number] => Boolean(t)),
    [modes],
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
      {open && <PopoverAutoClose onClose={() => setOpen(false)} />}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={disabled}
        className={`nodrag nopan border-primary/55 bg-node-accent flex h-6 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] ${
          disabled ? "opacity-50" : ""
        }`}
      >
        <span
          className={`font-semibold ${hasModes ? "text-ink-bright" : "text-ink-muted"}`}
          style={{ fontFamily: "var(--font-sans)", fontSize: 10 }}
        >
          {hasModes ? triggerLabel : "未选"}
        </span>
        {/* 不再显示 +N 徽章 — 弹层只列工作流实际支持的 N 个模式，
         *  trigger 只展示当前默认，没必要再用 +N 暗示"还有几个未展示" */}
        <span
          className={`text-ink-muted shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          style={{ fontFamily: "var(--font-sans)", fontSize: 9 }}
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
            style={{
              position: "fixed",
              left: pos.left,
              top: pos.top,
              width: pos.width,
              zIndex: 50,
            }}
            className="border-border-strong bg-card rounded-xl border py-1 shadow-2xl shadow-black/10 dark:shadow-violet-500/20"
          >
            {/* 仅展示工作流 modes 数组里的 N 个，单选 + 点选即切换 */}
            {items.length === 0 ? (
              <div className="text-ink-muted px-3 py-3 text-center text-[11px]">
                该工作流没有声明可用模式
              </div>
            ) : (
              items.map((item) => {
                const isDef = defaultMode === item.code;
                return (
                  <div
                    key={item.code}
                    role="option"
                    aria-selected={isDef}
                    tabIndex={0}
                    onClick={() => pick(item.code)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        pick(item.code);
                      }
                    }}
                    className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[12px] transition-colors ${
                      isDef
                        ? "bg-violet-500/14 text-violet-700 dark:text-violet-100"
                        : "text-ink-bright hover:bg-subtle"
                    }`}
                  >
                    {/* radio dot — 单选，无 checkbox */}
                    <span
                      className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${
                        isDef
                          ? "border-violet-400 bg-violet-500/20"
                          : "border-border-strong bg-subtle"
                      }`}
                    >
                      {isDef && (
                        <span className="h-1.5 w-1.5 rounded-full bg-violet-300" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {item.label}
                    </span>
                    <span
                      className="bg-subtle text-ink-muted shrink-0 rounded px-1 py-px text-[9.5px]"
                      style={{ fontFamily: "var(--font-sans)" }}
                    >
                      {item.code}
                    </span>
                  </div>
                );
              })
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
