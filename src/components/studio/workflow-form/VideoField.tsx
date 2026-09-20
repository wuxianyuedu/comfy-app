"use client";
/* 视频组字段渲染器 —— 从 GroupedControls.tsx 抽出。
 * 为每个探测到的子 widget（时长 / 比例 /
 * 画质）渲染一个友好字段，在预设下拉与原生控件之间切换。 */
import { NumberField } from "~/components/ui/number-field";
import { textHandler } from "~/lib/form-props";
import { SelectMenu } from "~/components/ui/select-menu";
import {
  numericBounds,
  DIM_RATIO_PRESETS,
  type EnrichedWidget,
} from "../workflow-io";
import { Field } from "./StyleSwitcher";
import {
  VIDEO_DURATION_PRESETS,
  VIDEO_QUALITY_PRESETS,
  roleLabel,
  type VideoRole,
} from "./grouped-controls-presets";

function VideoField({
  role,
  entry,
  preset,
  values,
  set,
  disabled,
}: {
  role: VideoRole;
  entry: EnrichedWidget;
  preset: boolean;
  values: Record<string, unknown>;
  set: (ioKey: string, v: unknown) => void;
  disabled?: boolean;
}) {
  const current = values[entry.ioKey];
  const label = roleLabel(role);

  // COMBO 已解析出候选项 → 一律用下拉（两种范式都是）。
  if (
    entry.control === "select" &&
    Array.isArray(entry.options) &&
    entry.options.length > 0
  ) {
    const opts = entry.options;
    const val =
      typeof current === "string" && opts.includes(current)
        ? current
        : opts[0]!;
    return (
      <Field label={label}>
        <SelectMenu
          value={val}
          options={opts}
          disabled={disabled}
          onChange={(value) => set(entry.ioKey, value)}
        />
      </Field>
    );
  }

  // 预设范式 → 写代表性值的友好下拉。
  if (preset) {
    if (role === "length") {
      const presets = VIDEO_DURATION_PRESETS;
      const cur = Number(current ?? entry.defaultValue ?? presets[0]!.value);
      const val =
        presets.find((preset) => preset.value === cur)?.label ??
        presets[0]!.label;
      return (
        <Field label={label}>
          <SelectMenu
            value={val}
            options={presets.map((preset) => preset.label)}
            disabled={disabled}
            onChange={(value) => {
              const preset = presets.find((item) => item.label === value);
              if (preset) set(entry.ioKey, preset.value);
            }}
          />
        </Field>
      );
    }
    if (role === "quality") {
      const presets = VIDEO_QUALITY_PRESETS;
      const cur = Number(current ?? entry.defaultValue ?? presets[0]!.value);
      const val =
        presets.find((preset) => preset.value === cur)?.label ??
        presets[0]!.label;
      return (
        <Field label={label}>
          <SelectMenu
            value={val}
            options={presets.map((preset) => preset.label)}
            disabled={disabled}
            onChange={(value) => {
              const preset = presets.find((item) => item.label === value);
              if (preset) set(entry.ioKey, preset.value);
            }}
          />
        </Field>
      );
    }
    if (role === "aspect") {
      // 数值比例 → 写浮点比值的形式预设
      const presets = DIM_RATIO_PRESETS;
      const cur = Number(current ?? entry.defaultValue ?? presets[0]!.ratio);
      const val =
        presets.find((preset) => Math.abs(preset.ratio - cur) < 0.05)?.label ??
        presets[0]!.label;
      return (
        <Field label={label}>
          <SelectMenu
            value={val}
            options={presets.map((preset) => preset.label)}
            disabled={disabled}
            onChange={(value) => {
              const preset = presets.find((item) => item.label === value);
              if (preset) set(entry.ioKey, preset.ratio);
            }}
          />
        </Field>
      );
    }
  }

  // 分开填写范式 → 原生控件。
  if (entry.control === "int" || entry.control === "float") {
    const bounds = numericBounds(entry);
    const value = Number(current ?? entry.defaultValue ?? bounds.min);
    return (
      <Field label={label}>
        <NumberField
          value={value}
          min={bounds.min}
          max={bounds.max}
          step={bounds.step}
          decimalPlaces={bounds.decimalPlaces}
          disabled={disabled}
          onChange={(nextValue) => set(entry.ioKey, nextValue)}
        />
      </Field>
    );
  }
  const rawValue = current ?? entry.defaultValue ?? "";
  const str = typeof rawValue === "string" ? rawValue : "";
  return (
    <Field label={label}>
      <input
        value={str}
        disabled={disabled}
        className="nodrag nopan bg-canvas-deep text-ink-soft focus:ring-primary/40 w-full rounded-md px-2.5 py-2 text-[11px] outline-none focus:ring-1"
        onChange={textHandler((value) => set(entry.ioKey, value))}
      />
    </Field>
  );
}

export { VideoField };
