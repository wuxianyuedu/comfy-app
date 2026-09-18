"use client";
/* Video group field renderer — extracted from GroupedControls.tsx.
 * Renders one friendly field per detected sub-widget (length / aspect /
 * quality), switching between preset dropdowns and native controls. */
import { NumberField } from "~/components/ui/number-field";
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

  // COMBO with resolved candidates → always a select (both paradigms).
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

  // Preset paradigm → friendly dropdowns writing representative values.
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
      // numeric aspect → ratio presets writing the float ratio
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

  // Split paradigm → native control.
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
        onChange={(event) => set(entry.ioKey, event.target.value)}
      />
    </Field>
  );
}

export { VideoField };
