"use client";
/* Grouped parameter controls — entry point (split).
 *
 * Two "paradigms" per group, switchable from a single dropdown
 * (StyleSwitcher):
 *   • Dimension group (image)  — 分别填写宽高  ⇄  比例 + 清晰度（内部算宽高）
 *   • Video group              — 分别填写      ⇄  时长 + 画质 + 比例
 *
 * Every selection ultimately writes the REAL underlying widget values
 * (width/height/length/aspect/quality) back through `onChange`, so the
 * rest of the pipeline (reconcile → toWorkflowInputsPayload → /api/generate)
 * is untouched.  The chosen paradigm is persisted per-workflow in
 * localStorage so the user's preference sticks across reloads.
 *
 * Split into: MultiSegmentPopover.tsx / StyleSwitcher.tsx /
 * AlignMultipleStepper.tsx / DimensionControl.tsx / VideoControl.tsx /
 * VideoField.tsx / grouped-controls-presets.ts.
 * ───────────────────────────────────────────────────────────────────────── */
import {
  controlForEntry,
  type DimensionGroup,
  type EnrichedWidget,
  type VideoGroup,
  type WorkflowIOMap,
} from "./workflow-io";
import { WidgetInputRow } from "./DynamicWorkflowForm/sections/WidgetInputRow";
import { DimensionControl } from "./DimensionControl";
import { VideoControl } from "./VideoControl";

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
  io,
  allPins,
}: {
  dimension: DimensionGroup | null;
  video: VideoGroup | null;
  values: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  workflowId?: string;
  compact?: boolean;
  disabled?: boolean;
  /** 画布 / 库内（`compact`）默认把组合控件**折叠成逐行参数**：这几个参数各自的
   *  输入端口露出来，一行一个可连端点（ISSUE #355 复审「红框那块占满空间，需要
   *  将这几个参数的输入端口显示出来」）。用户可用「展开组合录入」切回组合卡。 */
  collapseGrouped?: boolean;
  /** 折叠态要靠它把该参数渲染成普通端口行（可连线的独立行）。 */
  io?: WorkflowIOMap | null;
  /** 全量 pin（ioLabel 撞名时回退用）。 */
  allPins?: readonly EnrichedWidget[];

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

  const set = (ioKey: string, v: unknown) => onChange({ ...values, [ioKey]: v });
  const setMany = (patch: Record<string, unknown>) => onChange({ ...values, ...patch });

  /* 组合控件覆盖到的端口（宽/高、比例/像素/倍数、时长/画质/比例）。 */
  const keys = new Set<string>();
  for (const group of [dimension, video]) {
    for (const entry of groupEntries(group)) {
      if (entry?.ioKey) keys.add(entry.ioKey);
    }
  }
  /* 画布 / 库内（`compact`）默认折叠成**逐行参数**：用户要的是「这几个参数的
   * 输入端口显示出来」（ISSUE #355 复审）—— 这几个参数本来就有自己的输入端口，
   * 组合控件只是把它们的值录入合并成一块；画布上那块占满空间，端口反而看不见，
   * 连线也无从落手。需要组合录入时按「展开组合录入」切回去（偏好按工作流记住）。
   *  `collapseGrouped={false}` 保留组合控件（宽版表单 / CreatePanel 的既有观感）。 */
  const collapsible = compact && keys.size > 0 && collapseGrouped !== false;
  if (collapsible) {
    return (
      <CollapsedGroupRows
        keys={keys}
        io={io}
        values={values}
        allPins={allPins}
        onChange={onChange}
        disabled={disabled}
        visibilityMode={visibilityMode}
        onVisibilityChange={onVisibilityChange}
        onRequiredChange={onRequiredChange}
      />
    );
  }

  return (
    <>
      {!compact && (
        <div className="mt-1 flex items-center gap-2 border-t border-white/10 pt-2.5">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: "#FF9C5B" }} />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-(--color-ink-muted)">
            组合参数
          </span>
          <span className="rounded-full bg-white/10 px-1.5 py-px font-mono text-[10px] text-gray-400">
            {count}
          </span>
          <div className="flex-1 border-t border-dashed border-white/8" />
        </div>
      )}
      <div className="space-y-3">
        {dimension && (
          <DimensionControl
            group={dimension}
            values={values}
            set={set}
            setMany={setMany}
            disabled={disabled}
            workflowId={workflowId}
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

/** 未接落点时的组合参数：按**普通参数行**逐行渲染（一端口一行、各有端点）。 */
function CollapsedGroupRows({
  keys,
  io,
  values,
  allPins,
  onChange,
  disabled,
  visibilityMode,
  onVisibilityChange,
  onRequiredChange,
  onExpand,
}: {
  keys: ReadonlySet<string>;
  io?: WorkflowIOMap | null;
  values: Record<string, unknown>;
  allPins?: readonly EnrichedWidget[];
  onChange: (next: Record<string, unknown>) => void;
  disabled?: boolean;
  visibilityMode?: string | null;
  onVisibilityChange?: (ioKey: string, visible: boolean) => void;
  onRequiredChange?: (ioKey: string, required: boolean) => void;
  onExpand?: () => void;
}) {
  /* 折叠态要按**普通参数行**渲染：控件类型由 `controlForEntry` 现推（与表单同
   *  一份），否则宽度/高度会退化成文本框。 */
  const rows: EnrichedWidget[] = [...keys]
    .map((ioKey) => {
      const raw = io?.[ioKey];
      return raw ? { ...raw, ioKey, control: controlForEntry(raw) } : null;
    })
    .filter((row): row is EnrichedWidget => !!row);
  if (rows.length === 0) return null;
  return (
    <div className="space-y-0" data-testid="grouped-collapsed-rows">
      {onExpand && (
        <div className="flex items-center justify-end px-[14px] pt-1">
          <button
            type="button"
            onClick={onExpand}
            className="nodrag nopan rounded border border-white/10 px-1.5 py-px text-[10px] text-(--color-ink-faint) transition-colors hover:bg-white/6 hover:text-(--color-ink-soft)"
            title="展开为比例 + 像素等预设录入方式"
          >
            展开组合录入
          </button>
        </div>
      )}
      {rows.map((row) => (
        <WidgetInputRow
          key={row.ioKey}
          entry={row}
          allPins={allPins ?? rows}
          value={values[row.ioKey]}
          compact
          disabled={!!disabled}
          uploading={false}
          seedMode={undefined}
          onValueChange={(next: unknown) => onChange({ ...values, [row.ioKey]: next })}
          onPickFile={() => undefined}
          onRequiredChange={
            onRequiredChange
              ? (required: boolean) => onRequiredChange(row.ioKey, required)
              : undefined
          }
          visible={
            visibilityMode ? (row.modes?.[visibilityMode]?.visible ?? true) : undefined
          }
          onVisibilityChange={
            onVisibilityChange && visibilityMode
              ? (visible: boolean) => onVisibilityChange(row.ioKey, visible)
              : undefined
          }
          dimmed={
            !!visibilityMode && row.modes?.[visibilityMode]?.visible === false
          }
          withHandle
          /* handle id = ioKey（与卡片端点同名）；落点锚点也是这一行自己。 */
          handleId={row.ioKey}
          wirePins={row.ioKey}
        />
      ))}
    </div>
  );
}

export { GroupedControls };
