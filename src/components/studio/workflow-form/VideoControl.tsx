"use client";
/* 视频组控件 —— 从 GroupedControls.tsx 抽出。
 * 在分开的原生字段与统一的「时长 + 画质 + 比例」
 * 预设浮层之间切换；所选范式按工作流持久化。 */
import { useState } from "react";
import {
  DEFAULT_DIM_RATIO_PRESET,
  DIM_RATIO_PRESETS,
  type EnrichedWidget,
  type VideoGroup,
} from "../workflow-io";
import {
  MultiSegmentPopover,
  RatioIcon,
  type SegmentSection,
} from "~/components/ui/segment-popover";
import { StyleSwitcher, loadGroupStyle, saveGroupStyle, type GroupStyle } from "./StyleSwitcher";
import {
  DEFAULT_VIDEO_DURATION_PRESET,
  DEFAULT_VIDEO_QUALITY_PRESET,
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
  narrow,
}: {
  disabled?: boolean;
  group: VideoGroup;
  /** 画布 / 库内的紧凑版式：控件按内容收窄（`w-fit`），不再占满整行。
   * 与宽版表单的区别**只是宽度**：录入能力、下拉、落点锚点全部一致。 */
  narrow?: boolean;
  set: (ioKey: string, v: unknown) => void;
  values: Record<string, unknown>;
  workflowId?: string;
}) {
  const [style, setStyle] = useState<GroupStyle>(() => loadGroupStyle(workflowId, group.groupId));
  const onStyle = (newStyle: GroupStyle) => {
    setStyle(newStyle);
    saveGroupStyle(workflowId, group.groupId, newStyle);
  };

  const entries: Array<{ entry: EnrichedWidget; role: VideoRole }> = [];
  if (group.length) {
    entries.push({ role: "length", entry: group.length });
  }
  if (group.aspect) {
    entries.push({ role: "aspect", entry: group.aspect });
  }
  if (group.quality) {
    entries.push({ role: "quality", entry: group.quality });
  }

  if (style === "split") {
    return (
      <div
        className={narrow === true ? "flex w-fit max-w-full flex-col gap-2" : "flex flex-col gap-2"}
      >
        <StyleSwitcher
          narrow={narrow}
          onChange={onStyle}
          options={[
            { value: "split", label: "分别填写" },
            { value: "preset", label: "时长 + 画质 + 比例" },
          ]}
          style={style}
        />
        <div className="grid grid-cols-1 gap-2">
          {entries.map(({ role, entry }) => (
            <VideoField
              disabled={disabled}
              entry={entry}
              key={entry.ioKey}
              preset={false}
              role={role}
              set={set}
              values={values}
            />
          ))}
        </div>
      </div>
    );
  }

  // Preset paradigm → one unified multi-section popover (参考图风格).
  const sections: Array<SegmentSection> = entries.map(({ role, entry }) => {
    const cur = values[entry.ioKey];
    if (role === "length") {
      const presets = VIDEO_DURATION_PRESETS;
      const value = Number(cur ?? entry.defaultValue ?? DEFAULT_VIDEO_DURATION_PRESET.value);
      return {
        label: "时长",
        value: videoDurationLabel(value),
        options: presets.map((preset) => ({
          value: preset.label,
          label: preset.label,
        })),
        onChange: (lbl: string) => {
          const preset = presets.find((item) => item.label === lbl);
          if (preset) {
            set(entry.ioKey, preset.value);
          }
        },
      };
    }
    if (role === "quality") {
      const presets = VIDEO_QUALITY_PRESETS;
      const value = Number(cur ?? entry.defaultValue ?? DEFAULT_VIDEO_QUALITY_PRESET.value);
      return {
        label: "画质",
        value: videoQualityLabel(value),
        options: presets.map((preset) => ({
          value: preset.label,
          label: preset.label,
        })),
        onChange: (lbl: string) => {
          const preset = presets.find((item) => item.label === lbl);
          if (preset) {
            set(entry.ioKey, preset.value);
          }
        },
      };
    }
    /* role ==="aspect" —— COMBO 比例用自己的选项，否则用
     * 友好比例预设把浮点比值写回 widget。 */
    if (entry.control === "select" && Array.isArray(entry.options) && entry.options.length > 0) {
      const opts = entry.options;
      const val = typeof cur === "string" && opts.includes(cur) ? cur : (opts.at(0) ?? "");
      return {
        label: "比例",
        value: val,
        options: opts.map((option) => ({ value: option, label: option })),
        onChange: (option: string) => {
          set(entry.ioKey, option);
        },
      };
    }
    const presets = DIM_RATIO_PRESETS;
    const value = Number(cur ?? entry.defaultValue ?? DEFAULT_DIM_RATIO_PRESET.ratio);
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
        if (preset) {
          set(entry.ioKey, preset.ratio);
        }
      },
    };
  });

  const summary = sections.map((section) => section.value).join(" ·");

  return (
    <div
      className={narrow === true ? "flex w-fit max-w-full flex-col gap-2" : "flex flex-col gap-2"}
    >
      <StyleSwitcher
        narrow={narrow}
        onChange={onStyle}
        options={[
          { value: "split", label: "分别填写" },
          { value: "preset", label: "时长 + 画质 + 比例" },
        ]}
        style={style}
      />
      <div className={narrow === true ? "w-42 max-w-full" : undefined}>
        <MultiSegmentPopover
          ariaLabel="选择时长、画质与比例"
          sections={sections}
          triggerContent={summary}
        />
      </div>
    </div>
  );
}

export { VideoControl };
