"use client";
/* Grouped parameter controls — entry point (T12 split).
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
 * VideoField.tsx / grouped-controls-presets.ts (T12).
 * ───────────────────────────────────────────────────────────────────────── */
import type { DimensionGroup, VideoGroup } from "./workflow-io";
import { DimensionControl } from "./DimensionControl";
import { VideoControl } from "./VideoControl";

export function GroupedControls({
  dimension,
  video,
  values,
  onChange,
  workflowId,
  compact,
  disabled,
}: {
  dimension: DimensionGroup | null;
  video: VideoGroup | null;
  values: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  workflowId?: string;
  compact?: boolean;
  disabled?: boolean;
}) {
  if (!dimension && !video) return null;
  const count = (dimension ? 1 : 0) + (video ? 1 : 0);

  const set = (ioKey: string, v: unknown) => onChange({ ...values, [ioKey]: v });
  const setMany = (patch: Record<string, unknown>) => onChange({ ...values, ...patch });

  return (
    <>
      {!compact && (
        <div className="mt-1 flex items-center gap-2 border-t border-white/[0.1] pt-2.5">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: "#FF9C5B" }} />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
            组合参数
          </span>
          <span className="rounded-full bg-white/[0.1] px-1.5 py-px font-mono text-[10px] text-gray-400">
            {count}
          </span>
          <div className="flex-1 border-t border-dashed border-white/[0.08]" />
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
