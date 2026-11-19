"use client";
/* 分组参数控件入口（已拆分）。每组两种范式，经下拉（StyleSwitcher）切换：尺寸组 = 分别填宽高 ⇄ 比例 +
 * 清晰度；视频组 = 分别填写 ⇄ 时长 + 画质 + 比例。范式最终都经 onChange 写回底层 widget，管线不动；
 * 所选范式按工作流存 localStorage。拆件：DimensionControl / AspectMegapixelControl / VideoControl / SizePresetTableModal 等。 */
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
      if (entry.ioKey) {
        keys.add(entry.ioKey);
      }
    }
  }
  /* compact：组合控件收窄成一块、宽度按内容、整块贴右沿（仍是这几个端口的录入入口）；
   *  覆盖到的参数以真正的参数行摆在框外左侧，各带与其他输入行同款的大端点（ISSUE #355）。
   *  collapseGrouped={false} 保留宽版整块录入（宽版表单 / CreatePanel 的既有观感）。 */
  const narrow = compact === true && keys.size > 0 && collapseGrouped !== false;

  return (
    <>
      {compact !== true && <SectionHeader accent={SECTION_ACCENT} count={count} label="组合参数" />}
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
