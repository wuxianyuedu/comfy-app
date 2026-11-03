"use client";
/* 分组参数控件 —— 入口（已拆分）。每组两种范式，由 StyleSwitcher 下拉切换：
 * 尺寸组（图片）分别填宽高 ⇄ 比例 + 清晰度；视频组分别填 ⇄ 时长 + 画质 + 比例。
 * 最终都经 onChange 写回真正底层 widget（width/height/length/aspect/quality），管线其余完全不动；
 * 所选范式按工作流存 localStorage。拆件：MultiSegmentPopover / StyleSwitcher / DimensionControl /
 * AspectMegapixelControl / DimensionControlParts / VideoControl / VideoField / presets / SizePresetTableModal。 */
import type { DimensionGroup, EnrichedWidget, VideoGroup } from "../workflow-io";
import { DimensionControl } from "./DimensionControl";
import { VideoControl } from "./VideoControl";
import { SECTION_ACCENT } from "./DynamicWorkflowForm/constants";
import { SectionHeader } from "./DynamicWorkflowForm/SectionHeader";

function GroupedControls({
  dimension,
  video,
  values,
  onChange,
  workflowId,
  compact,
  disabled,
  onRequiredChange,
  mode,
  visibilityMode,
  onVisibilityChange,
  collapseGrouped,
}: {
  /** 画布 / 库内（`compact`）把组合控件收窄成一块（宽度按内容），而不是摊成
   * 逐行参数清单。`false` 保留宽版整块录入（宽版表单 / CreatePanel）。 */
  collapseGrouped?: boolean;
  compact?: boolean;
  dimension: DimensionGroup | null;
  disabled?: boolean;
  /** 多模式作者态：透传给组合卡按该模式解析必填/可见性（与独立参数行一致）。 */
  mode?: string | null;
  onChange: (next: Record<string, unknown>) => void;
  /** 编辑态：组合行替代了独立参数行，把必填/可选切换透传进组合卡。 */
  onRequiredChange?: (ioKey: string, required: boolean) => void;
  onVisibilityChange?: (ioKey: string, visible: boolean) => void;

  values: Record<string, unknown>;
  video: VideoGroup | null;
  /** IO 编辑态：行内 👁 切换参数在 visibilityMode 模式下的可见性。 */
  visibilityMode?: string | null;
  workflowId?: string;
}) {
  if (!dimension && !video) {
    return null;
  }
  const count = (dimension ? 1 : 0) + (video ? 1 : 0);

  const set = (ioKey: string, v: unknown) => {
    onChange({ ...values, [ioKey]: v });
  };
  const setMany = (patch: Record<string, unknown>) => {
    onChange({ ...values, ...patch });
  };

  /* 组合控件覆盖到的端口（宽/高、比例/像素/倍数、时长/画质/比例）。 */
  const keys = new Set<string>();
  for (const group of [dimension, video]) {
    for (const entry of groupEntries(group)) {
      if (entry?.ioKey) {
        keys.add(entry.ioKey);
      }
    }
  }
  /* 画布/库内（compact）把组合控件收窄成同一块控件：控件照旧画（比例/像素/倍数的录入入口，带下拉菜单），
   * 只是宽度按内容收窄、整块贴右沿；覆盖到的参数以真正参数行摆在框外左侧，一行一个、带大端点。
   * 用户口径（ISSUE #355）：「红框部分对齐到右侧，左侧留出的区域放置那三个参数……圆点要和其他参数一致」。
   * collapseGrouped={false} 保留完整录入（宽版表单 / CreatePanel 的既有观感）。 */
  const narrow = compact && keys.size > 0 && collapseGrouped !== false;

  return (
    <>
      {!compact && <SectionHeader accent={SECTION_ACCENT} count={count} label="组合参数" />}
      <div className="flex-col gap-3">
        {dimension && (
          <DimensionControl
            disabled={disabled}
            group={dimension}
            mode={mode}
            /* 画布 / 库内：控件按内容收窄（`w-fit`），不再占满整行。 */
            narrow={narrow}
            onRequiredChange={onRequiredChange}
            onVisibilityChange={onVisibilityChange}
            set={set}
            setMany={setMany}
            values={values}
            visibilityMode={visibilityMode}
            workflowId={workflowId}
          />
        )}
        {video && (
          <VideoControl
            disabled={disabled}
            group={video}
            narrow={narrow}
            set={set}
            values={values}
            workflowId={workflowId}
          />
        )}
      </div>
    </>
  );
}

/** 组合控件覆盖到的端口（顺序 = 声明顺序，两端稳定）。 */
function groupEntries(group: DimensionGroup | VideoGroup | null): Array<EnrichedWidget> {
  if (!group) {
    return [];
  }
  return [
    "width" in group ? group.width : undefined,
    "height" in group ? group.height : undefined,
    "aspect" in group ? group.aspect : undefined,
    "megapixels" in group ? group.megapixels : undefined,
    "multiple" in group ? group.multiple : undefined,
    "length" in group ? group.length : undefined,
    "quality" in group ? group.quality : undefined,
  ].filter((entry): entry is EnrichedWidget => !!entry);
}

export { GroupedControls };
