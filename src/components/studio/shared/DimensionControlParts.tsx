"use client";
/* 尺寸组合控件之间共用的零件（视图层）：
 *   · 两个子控件收窄后的 group 类型；
 *   · 必填 / 显隐徽标（组合行替代了独立参数行，原来行上的徽标要在组合卡内补回）；
 *   · 「尺寸表」入口与当前场景提示（两个子控件脚注共用）。
 * 抽出来只为让两个子控件各自独立成文件，行为与拆前完全一致。 */

import type { ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";

import { SIZE_SCENE_LABELS, type SizeScene } from "~/lib/size-presets";
import {
  isVisibleInMode,
  resolveEntryRequired,
  type DimClarityPreset,
  type DimensionGroup,
  type EnrichedWidget,
} from "./workflow-io";

/** W/H 形态的尺寸组（比例 + 分辨率 / 百万像素 → 算宽高）。 */
export type SizeGroup = DimensionGroup & {
  width: EnrichedWidget;
  height: EnrichedWidget;
};
/** 宽高比 + 百万像素 (+ 倍数) 形态的尺寸组（ResolutionSelector 类节点）。 */
export type AspectMegaGroup = DimensionGroup & {
  aspect: EnrichedWidget;
  megapixels: EnrichedWidget;
  multiple?: EnrichedWidget;
};

/** 组合参数的宽高上限比常规参数宽：尺寸表里超宽 4k 档是 5120 宽。 */
export const GROUPED_SIZE_MAX = 8192;

/** 「像素」大类两个子类的说明（弹层里显示，解释这一档宽高从哪来）。 */
export const CLARITY_HINT: Record<DimClarityPreset["kind"], string> = {
  pixel: "按场景尺寸表取宽高",
  megapixel: "总像素预算，宽高由倍数对齐",
};

/** 组合参数子 pin 的必填 / 显隐控制：grouped 行替代了各自的独立参数行，
 *  原来的必填/可选徽标与 👁 会跟着消失 —— 在组合卡内按 pin 补回。
 *  仅编辑态（IO 预览多模式作者态）传入回调时渲染。
 *
 *  required / visible 都按当前 mode 解析（resolveEntryRequired /
 *  isVisibleInMode）：IO 预览在模式页签下把必填/显隐写进 `modes[mode]`
 *  覆盖层，这里必须读同源回读，否则点完按钮 UI 不回读、看起来像“无法切换”
 *  （历史根因：原实现直读条目级 `pin.required`，与模式级写入错层）。 */
export function RequiredChips({
  pins,
  onRequiredChange,
  mode,
  visibilityMode,
  onVisibilityChange,
}: {
  pins: (EnrichedWidget | undefined)[];
  onRequiredChange?: (ioKey: string, required: boolean) => void;
  /** 多模式作者态：按该模式解析必填（未设模式覆盖时回退条目级）。 */
  mode?: string | null;
  /** IO 编辑态：按该模式解析可见性（undefined 不渲染 👁）。 */
  visibilityMode?: string | null;
  onVisibilityChange?: (ioKey: string, visible: boolean) => void;
}) {
  const live = pins.filter((pin): pin is EnrichedWidget => !!pin);
  const showAny =
    !!onRequiredChange || (!!onVisibilityChange && !!visibilityMode);
  if (!showAny || live.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-end gap-1 pt-1">
      {live.map((pin) => {
        const required = !!resolveEntryRequired(pin, mode);
        const visible =
          visibilityMode == null ? true : isVisibleInMode(pin, visibilityMode);
        return (
          <span
            key={pin.ioKey}
            className="flex items-center gap-1 rounded border border-white/6 bg-black/20 px-1.5 py-0.5"
            data-dimension-pin={pin.ioKey}
          >
            <span
              className="max-w-[80px] truncate text-[10px] text-(--color-ink-soft)"
              title={pin.label ?? pin.name}
            >
              {pin.label ?? pin.name}
            </span>
            {onRequiredChange && (
              <button
                type="button"
                onClick={() => onRequiredChange(pin.ioKey, !required)}
                title={
                  required
                    ? "已标记为必填，点击切换为可选"
                    : "点击将其标记为必填"
                }
                className={`nodrag nopan rounded px-1.5 py-px text-[10px] font-medium transition-colors ${
                  required
                    ? "border border-red-400/40 bg-red-500/15 text-red-300 hover:bg-red-500/25"
                    : "border border-white/8 bg-white/2 text-gray-500 hover:bg-white/6 hover:text-gray-300"
                }`}
              >
                {required ? "必填" : "可选"}
              </button>
            )}
            {onVisibilityChange && visibilityMode && (
              <button
                type="button"
                title={
                  visible
                    ? "该参数在当前模式下已可见，点击隐藏"
                    : "该参数在当前模式下已隐藏，点击恢复显示"
                }
                onClick={() => onVisibilityChange(pin.ioKey, !visible)}
                onMouseDown={(ev) => ev.stopPropagation()}
                className={`nodrag nopan rounded p-0.5 transition-colors ${
                  visible
                    ? "text-gray-300 hover:bg-white/8 hover:text-gray-100"
                    : "text-gray-600 hover:bg-white/8 hover:text-gray-200"
                }`}
              >
                {visible ? <Eye size={11} /> : <EyeOff size={11} />}
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}

/** 尺寸表配置入口 + 当前场景提示（摆在弹层脚注里，两个子控件共用）。 */
export function SizeTableFooter({
  scene,
  onOpen,
  extra,
}: {
  scene: SizeScene;
  onOpen: () => void;
  extra?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onOpen}
        className="nodrag nopan rounded-md border border-white/12 px-2 py-1 text-[10px] text-(--color-ink-muted) transition-colors hover:bg-white/6 hover:text-(--color-ink-bright)"
      >
        尺寸表（{SIZE_SCENE_LABELS[scene]}场景）…
      </button>
      {extra}
    </div>
  );
}
