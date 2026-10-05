"use client";
/* 分组参数控件 —— 入口（已拆分）。
 *
 * 每组两种「范式」，可由一个下拉（StyleSwitcher）切换：
 * • 尺寸组（图片） —— 分别填写宽高 ⇄ 比例 + 清晰度（内部算宽高）
 * • 视频组 —— 分别填写 ⇄ 时长 + 画质 + 比例
 *
 * 每种选择最终都经`onChange` 把**真正底层**的 widget 值
 *（width/height/length/aspect/quality）写回去，所以管线其余部分
 *（reconcile → toWorkflowInputsPayload → /api/generate）
 * 完全不动。所选范式按工作流持久化在
 * localStorage 里，好让用户的偏好扛过重新加载。
 *
 * 拆分为：MultiSegmentPopover.tsx / StyleSwitcher.tsx /
 * DimensionControl.tsx（入口 + 宽高形态）/ AspectMegapixelControl.tsx
 *（比例 + 百万像素 + 倍数形态）/ DimensionControlParts.tsx（共用零件）/
 * 其余拆件：VideoControl.tsx / VideoField.tsx / grouped-controls-presets.ts /
 * SizePresetTableModal.tsx（尺寸表配置）。
 * ───────────────────────────────────────────────────────────────────────── */
import {
  type DimensionGroup,
  type EnrichedWidget,
  type VideoGroup,
} from "../workflow-io";
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
  dimension: DimensionGroup | null;
  video: VideoGroup | null;
  values: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  workflowId?: string;
  compact?: boolean;
  disabled?: boolean;
  /** 画布 / 库内（`compact`）把组合控件收窄成一块（宽度按内容），而不是摊成
   * 逐行参数清单。`false` 保留宽版整块录入（宽版表单 / CreatePanel）。 */
  collapseGrouped?: boolean;

  /** 编辑态：组合行替代了独立参数行，把必填/可选切换透传进组合卡。 */
  onRequiredChange?: (ioKey: string, required: boolean) => void;
  /** 多模式作者态：透传给组合卡按该模式解析必填/可见性（与独立参数行一致）。 */
  mode?: string | null;
  /** IO 编辑态：行内 👁 切换参数在 visibilityMode 模式下的可见性。 */
  visibilityMode?: string | null;
  onVisibilityChange?: (ioKey: string, visible: boolean) => void;
}) {
  if (!dimension && !video) return null;
  const count = (dimension ? 1 : 0) + (video ? 1 : 0);

  const set = (ioKey: string, v: unknown) =>
    onChange({ ...values, [ioKey]: v });
  const setMany = (patch: Record<string, unknown>) =>
    onChange({ ...values, ...patch });

  /* 组合控件覆盖到的端口（宽/高、比例/像素/倍数、时长/画质/比例）。 */
  const keys = new Set<string>();
  for (const group of [dimension, video]) {
    for (const entry of groupEntries(group)) {
      if (entry?.ioKey) keys.add(entry.ioKey);
    }
  }
  /* 画布 / 库内（`compact`）把组合控件**收窄成同一块控件** —— 控件本身照旧画出来
   * （它就是这几个端口的录入入口，带下拉菜单切换比例 / 像素 / 倍数），只是宽度按
   * 内容收窄、整块贴右沿。
   *
   * 覆盖到的参数以**真正的参数行**形态摆在框外左侧：一行一个、各带与节点上其他
   * 输入行同款的大端点。用户口径是「红框部分对齐到右侧，左侧留出的区域放置那三个
   * 参数，三个参数要到框外，参数左侧的圆点要和其他参数一致」（ISSUE #355）。
   *
   *`collapseGrouped={false}` 保留组合控件的完整录入能力（宽版表单 / CreatePanel
   * 的既有观感：作者在那里要的是整块录入，不是收窄控件）。 */
  const narrow = compact && keys.size > 0 && collapseGrouped !== false;

  return (
    <>
      {!compact && (
        <SectionHeader label="组合参数" accent={SECTION_ACCENT} count={count} />
      )}
      <div className="flex-col gap-3">
        {dimension && (
          <DimensionControl
            group={dimension}
            values={values}
            set={set}
            setMany={setMany}
            disabled={disabled}
            workflowId={workflowId}
            /* 画布 / 库内：控件按内容收窄（`w-fit`），不再占满整行。 */
            narrow={narrow}
            onRequiredChange={onRequiredChange}
            mode={mode}
            visibilityMode={visibilityMode}
            onVisibilityChange={onVisibilityChange}
          />
        )}
        {video && (
          <VideoControl
            group={video}
            values={values}
            set={set}
            workflowId={workflowId}
            disabled={disabled}
            narrow={narrow}
          />
        )}
      </div>
    </>
  );
}

/** 组合控件覆盖到的端口（顺序 = 声明顺序，两端稳定）。 */
function groupEntries(
  group: DimensionGroup | VideoGroup | null,
): EnrichedWidget[] {
  if (!group) return [];
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
