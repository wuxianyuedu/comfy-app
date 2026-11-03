"use client";

/** 从 WorkflowNode.tsx 抽出 —— 模式选择章
 *  与画布变换时的自动关闭监听。
 *  行为与视觉不变。浮层壳与选项行走 `ui/option-list-popover`
 *  （规范 16 §16.2.4.14）。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@xyflow/react";
import { ALL_WORKFLOW_TYPES } from "~/lib/workflow/workflow-types";
import { OptionListPopover } from "~/components/ui/option-list-popover";

type WorkflowModePickChipProps = {
  defaultMode: string | null;
  disabled?: boolean;
  modes: Array<string>;
  onChange: (modes: Array<string>, defaultMode: string) => void;
};

/* transform 订阅收敛：顶层常驻订阅会让画布每次 pan/zoom 全量重渲染所有节点，
 * 即使 99% 的弹层没打开。订阅下沉到只在弹层打开时挂载的 PopoverAutoClose：
 * 关闭时零订阅；打开时仅该节点订阅，画布一动即关弹层。语义等价：挂载首帧跳过，
 * transform 首次变化即关闭，卸载即取消订阅。 */
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
  /* 订阅只在弹层打开时挂载 —— 所以开合状态要留在本组件（受控传给基元），
   * 好决定 `PopoverAutoClose` 挂不挂。 */
  const [open, setOpen] = useState(false);

  const defType = ALL_WORKFLOW_TYPES.find((workflowType) => workflowType.code === defaultMode);
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
    if (code !== defaultMode) {
      onChange(modes, code);
    }
  };

  return (
    <>
      {open && (
        <PopoverAutoClose
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
      <OptionListPopover
        align="start"
        contentClassName="w-60 rounded-xl"
        disabled={disabled}
        emptyHint="该工作流没有声明可用模式"
        items={items.map((item) => {
          const isDef = defaultMode === item.code;
          return {
            value: item.code,
            label: item.label,
            /* radio dot — 单选，无 checkbox（选中时底色与勾由基元给）。 */
            prefix: (
              <span
                className={`flex size-3.5 shrink-0 items-center justify-center rounded-full border ${
                  isDef ? "border-primary bg-primary-soft" : "border-border-strong bg-subtle"
                }`}
              >
                {isDef && <span className="bg-primary-strong size-1.5 rounded-full" />}
              </span>
            ),
            suffix: (
              <span
                className="bg-subtle text-ink-muted shrink-0 rounded px-1 py-px text-[9.5px]"
                style={{ fontFamily: "var(--font-sans)" }}
              >
                {item.code}
              </span>
            ),
          };
        })}
        onOpenChange={setOpen}
        onSelect={pick}
        trigger={
          <span
            className={`font-semibold ${hasModes ? "text-ink-bright" : "text-ink-muted"}`}
            style={{ fontFamily: "var(--font-sans)", fontSize: 10 }}
          >
            {hasModes ? triggerLabel : "未选"}
          </span>
        }
        triggerClassName="border-primary/55 bg-node-accent h-6 shrink-0 rounded-lg border px-2.5 text-xs disabled:opacity-50"
        triggerTitle="工作流模式选择"
        value={defaultMode ?? ""}
      />
    </>
  );
}
