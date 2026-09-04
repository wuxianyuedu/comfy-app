"use client";
/* Video group control — extracted from GroupedControls.tsx.
 * Switches between split native fields and a unified 时长 + 画质 + 比例
 * preset popover; the chosen paradigm persists per-workflow. */
import { useState } from "react";
import {
  DIM_RATIO_PRESETS,
  type EnrichedWidget,
  type VideoGroup,
} from "./workflow-io";
import {
  MultiSegmentPopover,
  RatioIcon,
  type SegmentSection,
} from "./MultiSegmentPopover";
import {
  StyleSwitcher,
  loadGroupStyle,
  saveGroupStyle,
  type GroupStyle,
} from "./StyleSwitcher";
import {
  VIDEO_DURATION_PRESETS,
  VIDEO_QUALITY_PRESETS,
  videoDurationLabel,
  videoQualityLabel,
  videoAspectLabel,
  shortRatioLabel,
  type VideoRole,
} from "./grouped-controls-presets";
import { VideoField } from "./VideoField";

function VideoControl({
  group,
  values,
  set,
  workflowId,
  disabled,
}: {
  group: VideoGroup;
  values: Record<string, unknown>;
  set: (ioKey: string, v: unknown) => void;
  workflowId?: string;
  disabled?: boolean;
}) {
  const [style, setStyle] = useState<GroupStyle>(() => loadGroupStyle(workflowId, group.groupId));
  const onStyle = (newStyle: GroupStyle) => {
    setStyle(newStyle);
    saveGroupStyle(workflowId, group.groupId, newStyle);
  };

  const entries: { role: VideoRole; entry: EnrichedWidget }[] = [];
  if (group.length) entries.push({ role: "length", entry: group.length });
  if (group.aspect) entries.push({ role: "aspect", entry: group.aspect });
  if (group.quality) entries.push({ role: "quality", entry: group.quality });

  if (style === "split") {
    return (
      <div className="space-y-2">
        <StyleSwitcher
          style={style}
          onChange={onStyle}
          options={[
            { value: "split", label: "分别填写" },
            { value: "preset", label: "时长 + 画质 + 比例" },
          ]}
        />
        <div className="grid grid-cols-1 gap-2">
          {entries.map(({ role, entry }) => (
            <VideoField
              key={entry.ioKey}
              role={role}
              entry={entry}
              preset={false}
              values={values}
              set={set}
              disabled={disabled}
            />
          ))}
        </div>
      </div>
    );
  }

  // Preset paradigm → one unified multi-section popover (参考图风格).
  const sections: SegmentSection<string>[] = entries.map(({ role, entry }) => {
    const cur = values[entry.ioKey];
    if (role === "length") {
      const presets = VIDEO_DURATION_PRESETS;
      const value = Number(cur ?? entry.defaultValue ?? presets[0]!.value);
      return {
        label: "时长",
        value: videoDurationLabel(value),
        options: presets.map((preset) => ({ value: preset.label, label: preset.label })),
        onChange: (lbl: string) => {
          const preset = presets.find((item) => item.label === lbl);
          if (preset) set(entry.ioKey, preset.value);
        },
      };
    }
    if (role === "quality") {
      const presets = VIDEO_QUALITY_PRESETS;
      const value = Number(cur ?? entry.defaultValue ?? presets[0]!.value);
      return {
        label: "画质",
        value: videoQualityLabel(value),
        options: presets.map((preset) => ({ value: preset.label, label: preset.label })),
        onChange: (lbl: string) => {
          const preset = presets.find((item) => item.label === lbl);
          if (preset) set(entry.ioKey, preset.value);
        },
      };
    }
    /* role === "aspect" — a COMBO aspect uses its own options, otherwise a
     *  friendly ratio preset writing the float ratio back into the widget. */
    if (entry.control === "select" && Array.isArray(entry.options) && entry.options.length > 0) {
      const opts = entry.options;
      const val = typeof cur === "string" && opts.includes(cur) ? cur : opts[0]!;
      return {
        label: "比例",
        value: val,
        options: opts.map((option) => ({ value: option, label: option })),
        onChange: (option: string) => set(entry.ioKey, option),
      };
    }
    const presets = DIM_RATIO_PRESETS;
    const value = Number(cur ?? entry.defaultValue ?? presets[0]!.ratio);
    return {
      label: "比例",
      value: videoAspectLabel(value),
      options: presets.map((preset) => ({
        value: preset.label,
        label: shortRatioLabel(preset.label),
        render: <RatioIcon ratio={preset.ratio} />,
      })),
      onChange: (lbl: string) => {
        const preset = presets.find((item) => item.label === lbl);
        if (preset) set(entry.ioKey, preset.ratio);
      },
    };
  });

  const summary = sections.map((section) => section.value).join(" · ");

  return (
    <div className="space-y-2">
      <StyleSwitcher
        style={style}
        onChange={onStyle}
        options={[
          { value: "split", label: "分别填写" },
          { value: "preset", label: "时长 + 画质 + 比例" },
        ]}
      />
      <MultiSegmentPopover triggerContent={summary} ariaLabel="选择时长、画质与比例" sections={sections} />
    </div>
  );
}

export { VideoControl };
