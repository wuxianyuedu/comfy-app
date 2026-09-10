"use client";

// 单个「可编辑参数」行：标签行（可改名 / 必填切换 / 可见性 / 类型徽章）+ 控件行。
// 纯展示：状态全部由外部传入，交互通过回调上抛。

import { Eye, EyeOff } from "lucide-react";

import { EditableLabel } from "~/components/studio/shared/EditableLabel";
import { PortHandle } from "~/components/studio/shared/WorkflowFormControls";
import {
  ioLabel,
  typeDisplay,
  type EnrichedWidget,
  type WorkflowIOEntry,
} from "~/components/studio/shared/workflow-io";
import { ACCENT } from "../constants";
import { controlTypeFallback } from "../dynamic-workflow-form-config";
import { WidgetControl } from "./WidgetControl";

interface WidgetInputRowProps {
  entry: EnrichedWidget;
  /** 全量 pin —— ioLabel() 靠它在标签撞名时回退到原始 name，保持可辨识。 */
  allPins: readonly WorkflowIOEntry[];
  value: unknown;
  compact: boolean;
  disabled: boolean;
  /** 该行是当前上传目标且上传进行中。 */
  uploading: boolean;
  seedMode?: string;
  onSeedModeChange?: (mode: string) => void;
  onValueChange: (value: unknown) => void;
  onPickFile: () => void;
  onLabelChange?: (label: string) => void;
  onRequiredChange?: (required: boolean) => void;
  /** IO 编辑态：该参数在当前模式下的可见性（undefined = 不渲染 👁）。 */
  visible?: boolean;
  onVisibilityChange?: (visible: boolean) => void;
  /** 当前模式下被隐藏（IO 编辑预览置灰呈现，眼睛可恢复）。 */
  dimmed?: boolean;
  /** 挂左侧可连接端点（画布节点用），圆心骑跨卡片左缘。 */
  withHandle?: boolean;
}

export function WidgetInputRow({
  entry,
  allPins,
  value,
  compact,
  disabled,
  uploading,
  seedMode,
  onSeedModeChange,
  onValueChange,
  onPickFile,
  onLabelChange,
  onRequiredChange,
  visible,
  onVisibilityChange,
  dimmed = false,
  withHandle = false,
}: WidgetInputRowProps) {
  const accent = ACCENT[entry.control];
  const label = ioLabel(entry, allPins);

  /* 类型徽章：打印 pin 真实声明的类型（用户规则「type 是什么就显示什么类型」），
   * 仅当 IO 未富化到 type 时才回退到控件推导出的名义类型 —— 对照组是
   * normalizeTypeChip 的白名单回退：那会把自定义节点的 IMAGEUPLOAD 之类
   * 悄悄改成 INT/STRING，用户看到的类型与工作流里的定义对不上。 */
  const typeChip = (
    <span
      className="inline-flex shrink-0 items-center rounded-[3px] px-1.5 py-0.5 text-[10px] font-semibold"
      style={{
        fontFamily: "var(--font-sans)",
        background: "var(--color-border-strong)",
        color: "var(--color-ink-muted)",
      }}
    >
      {typeDisplay(entry.type, controlTypeFallback(entry.control))}
    </span>
  );

  /* 标签行：传了 onLabelChange 时标签可单击就地改名（Enter / 失焦提交，Esc
   * 撤销）；未传时 EditableLabel 退化为普通 span，画布等只读表单不受影响。
   * 强调圆点与必填切换只在 IO-edit 模式出现（CreatePanel / 画布节点隐藏）。 */
  const labelRow = (
    <div className="flex h-5 items-center justify-between gap-2.5">
      {/* 标签区：圆点 + EditableLabel 占满左侧 flex-1 区域，长标签可截断。 */}
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        {onRequiredChange && (
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: accent }}
          />
        )}
        <EditableLabel
          label={label}
          title={`${entry.nodeTitle ?? ""} · ${entry.name}`}
          onChange={onLabelChange}
        />
      </span>
      {/* 操作区：「必填 / 👁」与类型徽章始终固定在行右侧 —— 与编辑态与否无关，
          避免一进入改名输入态按钮就跑到输入框旁边。 */}
      <span className="flex shrink-0 items-center gap-1.5">
        {onRequiredChange && (
          <button
            type="button"
            title={
              entry.required
                ? "已标记为必填，点击切换为可选"
                : "点击将其标记为必填"
            }
            onClick={() => onRequiredChange(!entry.required)}
            onMouseDown={(ev) => ev.stopPropagation()}
            className={`nodrag nopan shrink-0 rounded px-1.5 py-px text-[10px] font-medium transition-colors ${
              entry.required
                ? "border border-red-400/40 bg-red-500/15 text-red-300 hover:bg-red-500/25"
                : "border border-white/8 bg-white/2 text-gray-500 hover:bg-white/6 hover:text-gray-300"
            }`}
          >
            {entry.required ? "必填" : "可选"}
          </button>
        )}
        {onVisibilityChange && (
          <button
            type="button"
            title={
              visible === false
                ? "该参数在当前模式下已隐藏，点击恢复显示"
                : "点击在当前模式下隐藏此参数"
            }
            onClick={() => onVisibilityChange(visible === false)}
            onMouseDown={(ev) => ev.stopPropagation()}
            className={`nodrag nopan shrink-0 rounded p-0.5 transition-colors ${
              visible === false
                ? "text-gray-600 hover:text-gray-300"
                : "text-gray-300 hover:bg-white/8 hover:text-gray-100"
            }`}
          >
            {visible === false ? <EyeOff size={11} /> : <Eye size={11} />}
          </button>
        )}
        {typeChip}
      </span>
    </div>
  );

  /* link 类型没有可用控件，只保留端点与「只接受连线」提示。 */
  if (entry.control === "link") {
    if (compact) {
      return (
        <div className={`relative ${dimmed ? "opacity-50" : ""}`}>
          {withHandle && (
            <PortHandle
              id={entry.ioKey}
              dir="in"
              type={entry.type}
              style={{ top: 16, transform: "translateY(-50%)" }}
            />
          )}
          <div className="px-[14px] pt-1.5">{labelRow}</div>
          <div className="px-[14px] pt-1 pb-1.5">
            <span className="text-[11px] text-gray-500">只接受连线</span>
          </div>
        </div>
      );
    }
    return (
      <div className={`relative ${dimmed ? "opacity-50" : ""}`}>
        {withHandle && (
          <PortHandle id={entry.ioKey} dir="in" type={entry.type} />
        )}
        <div className="flex items-center gap-2 rounded-md bg-(--color-canvas-deep) px-2.5 py-1.5 pr-[14px] pl-[14px]">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: accent }}
          />
          <span className="min-w-0 flex-1 truncate text-[11px] text-(--color-ink-soft)">
            {label}
          </span>
          {/* link 行同样打印 pin 真实声明的类型：MODEL / CLIP / LATENT /
              IMAGEUPLOAD 等自定义类型一律原样展示，不回退成 "*"。 */}
          <span
            className="inline-flex shrink-0 items-center rounded-[3px] px-1.5 py-0.5 text-[10px] font-semibold"
            style={{
              fontFamily: "var(--font-sans)",
              background: "var(--color-border-strong)",
              color: "var(--color-ink-muted)",
            }}
          >
            {typeDisplay(entry.type)}
          </span>
        </div>
      </div>
    );
  }

  const control = (
    <WidgetControl
      entry={entry}
      label={label}
      value={value}
      compact={compact}
      disabled={disabled}
      uploading={uploading}
      seedMode={seedMode}
      onSeedModeChange={onSeedModeChange}
      onValueChange={onValueChange}
      onPickFile={onPickFile}
    />
  );

  /* compact（画布节点）走双行：第 1 行标签 + 类型徽章，第 2 行控件独占一行
   * —— 所有标签的视觉基线对齐到第一行，控件拿到全宽。 */
  if (compact) {
    return (
      <div className={`relative ${dimmed ? "opacity-50" : ""}`}>
        {withHandle && (
          /* 圆心锁到标签行中线（pt-1.5 = 6 + h-5 / 2 = 10 = 16px）：默认的
           * top:50% 会让圆点掉在两行之间、与参数名错位。 */
          <PortHandle
            id={entry.ioKey}
            dir="in"
            type={entry.type}
            style={{ top: 16, transform: "translateY(-50%)" }}
          />
        )}
        <div className="px-[14px] pt-1.5">{labelRow}</div>
        <div className="px-[14px] pt-1 pb-1.5">{control}</div>
      </div>
    );
  }

  /* 宽版：标签行在上，控件紧随其后。handle 挂在行 wrapper 上，圆心才能骑跨
   * 卡片左缘 —— 放进带 padding 的子行会让圆心内缩 14px，与端口行错位。 */
  return (
    <div className={`relative ${dimmed ? "opacity-50" : ""}`}>
      {withHandle && <PortHandle id={entry.ioKey} dir="in" type={entry.type} />}
      <div className="px-[14px] pt-1.5">{labelRow}</div>
      {control}
    </div>
  );
}
