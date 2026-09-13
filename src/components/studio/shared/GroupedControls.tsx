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
  typeDisplay,
  type DimensionGroup,
  type EnrichedWidget,
  type VideoGroup,
  type WorkflowIOMap,
} from "./workflow-io";
import { controlTypeFallback } from "./DynamicWorkflowForm/dynamic-workflow-form-config";
import { WidgetInputRow } from "./DynamicWorkflowForm/sections/WidgetInputRow";
import { WIRE_PINS_ATTR, wirePinsValue } from "~/lib/workflow-io-types";
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
  /* 画布 / 库内（`compact`）默认把组合控件**收窄成展示卡 + 逐行列表**：
   *
   *   ① 组合卡本身仍然画出来（这几个端口属于同一格录入，这件事得看得见），但按
   *      内容收窄、不占满整行；卡内分项**只显示「名称 + 类型」**，不放可编辑的值 ——
   *      值由下面的逐行参数各自录入，同一件事不在两处各放一份；
   *   ② 组合卡覆盖到的每个端口在下面**各占一行**，各有可连的输入端点，映射线因此
   *      落得到具体那一行（组合卡本身也保留落点锚点，见 CollapsedGroupRows）。
   *
   * `collapseGrouped={false}` 保留组合控件的完整录入能力（宽版表单 / CreatePanel
   * 的既有观感：作者在那里要的是整块录入，不是逐行清单）。 */
  const collapsed = compact && keys.size > 0 && collapseGrouped !== false;
  if (collapsed) {
    return (
      <CollapsedGroupRows
        dimension={dimension}
        video={video}
        count={count}
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

/** 收窄后的组合参数卡 + 逐行参数列表（画布 / 库内的默认形态）。
 *
 *  卡与列表各说一件事：
 *   · 卡说「这几个口由同一格录入」—— 一行一个分项，只报名称与类型；
 *   · 列表说「每个口各自的落点与端点」—— 一端口一行，各有可连的输入端点。
 *
 *  值只出现一次（在逐行参数上）：卡里再放一份可编辑控件，同一件事就有两处入口，
 *  而那块控件也正是「占满空间、端口看不见」的成因。
 *
 *  卡与每一行都带落点锚点（`WIRE_PINS_ATTR` / 行自己的 `WIRE_ROW_ATTR`）：
 *  卡覆盖的那几格同样允许落线（宽/高这类口在这一格上一起给值），而命中判定取最小
 *  矩形，所以精确拖到某一行时永远优先落在那一行。 */
function CollapsedGroupRows({
  dimension,
  video,
  count,
  keys,
  io,
  values,
  allPins,
  onChange,
  disabled,
  visibilityMode,
  onVisibilityChange,
  onRequiredChange,
}: {
  dimension: DimensionGroup | null;
  video: VideoGroup | null;
  count: number;
  keys: ReadonlySet<string>;
  io?: WorkflowIOMap | null;
  values: Record<string, unknown>;
  allPins?: readonly EnrichedWidget[];
  onChange: (next: Record<string, unknown>) => void;
  disabled?: boolean;
  visibilityMode?: string | null;
  onVisibilityChange?: (ioKey: string, visible: boolean) => void;
  onRequiredChange?: (ioKey: string, required: boolean) => void;
}) {
  /* 卡片里的分项：按声明顺序，名称取作者名/槽位名，类型取 pin 自身声明。 */
  const items = [
    ...groupEntries(dimension),
    ...groupEntries(video),
  ].filter((entry) => keys.has(entry.ioKey));

  /* 逐行参数：按 `keys` 顺序（声明顺序）渲染成普通参数行 —— 控件类型由
   *  `controlForEntry` 现推（与表单同一份），否则宽度/高度会退化成文本框。 */
  const rows: EnrichedWidget[] = [...keys]
    .map((ioKey) => {
      const raw = io?.[ioKey];
      return raw ? { ...raw, ioKey, control: controlForEntry(raw) } : null;
    })
    .filter((row): row is EnrichedWidget => !!row);

  return (
    <div className="space-y-0" data-testid="grouped-collapsed-rows">
      {items.length > 0 && (
        <div className="px-[14px] pt-1 pb-0.5">
          {/* 收窄的组合卡：`w-fit` + 上限，不再占满整行；三行只报名称 + 类型。 */}
          <div
            className="w-fit max-w-full rounded-lg border border-(--color-accent)/30 bg-(--color-accent)/4 px-2 py-1"
            data-testid="grouped-card"
            {...{
              [WIRE_PINS_ATTR]: wirePinsValue(items.map((item) => item.ioKey)),
            }}
          >
            <div className="flex items-center gap-1.5">
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: "#FF9C5B" }}
              />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-(--color-accent)">
                组合参数
              </span>
              <span className="rounded-full bg-white/10 px-1.5 py-px font-mono text-[9px] text-(--color-ink-muted)">
                {count}
              </span>
            </div>
            <ul className="mt-0.5 flex flex-col">
              {items.map((item) => (
                <li
                  key={item.ioKey}
                  className="flex items-center gap-1.5 text-[10.5px] leading-[16px] text-(--color-ink-soft)"
                  data-grouped-item={item.ioKey}
                >
                  <span aria-hidden className="text-(--color-ink-fainter)">
                    ·
                  </span>
                  <span className="min-w-0 truncate" title={item.name}>
                    {item.label ?? item.name}
                  </span>
                  <span
                    className="shrink-0 rounded px-1 font-mono text-[9px] leading-[14px]"
                    style={{
                      background: "var(--color-border-strong)",
                      color: "var(--color-ink-muted)",
                    }}
                  >
                    {typeDisplay(item.type, controlTypeFallback(item.control))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
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
