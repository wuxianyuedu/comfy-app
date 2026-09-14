"use client";

/* 尺寸表配置弹窗（规范 §17.2 第③层：只渲染 + 上抛）。
 *
 * 展示并允许修改「比例 × 分辨率档 → 宽高」这张表 —— 1k / 2k / 4k 在图片
 * （AI 出图）与视频（显示器 / 视频行业标准）两个场景下不是同一组值，
 * 因此按场景分页签，改动即时落到 `useSizePresetTable`（已挂载的尺寸控件同步换值）。
 *
 * 这里不做任何换算：表就是唯一事实，换算在 `lib/size-presets.ts`。 */

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";

import { NumberField } from "~/components/studio/ui/NumberField";
import { overlayClass } from "~/lib/full-screen-layer";
import {
  RESOLUTION_TIERS,
  SIZE_RATIO_PRESETS,
  SIZE_SCENE_LABELS,
  type ResolutionTier,
  type SizeDims,
  type SizeScene,
} from "~/lib/size-presets";
import { useSizePresetTable } from "./hooks/use-size-preset-table";

const SCENES: SizeScene[] = ["image", "video"];

/** 表里允许的宽高范围：比常规参数的 [64, 4096] 宽 —— 超宽 4k 档要到 5120。 */
const TABLE_MIN = 64;
const TABLE_MAX = 8192;

export function SizePresetTableModal({
  scene: initialScene = "image",
  title = "尺寸表",
  onClose,
}: {
  /** 打开时选中的场景页签（当前控件正用的场景）。 */
  scene?: SizeScene;
  title?: string;
  onClose: () => void;
}) {
  const { table, setDims, resetScene, isModified } = useSizePresetTable();
  const [scene, setScene] = useState<SizeScene>(initialScene);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const handleChange = useCallback(
    (ratioLabel: string, tier: ResolutionTier, size: SizeDims) => {
      setDims(scene, ratioLabel, tier, size);
    },
    [scene, setDims],
  );

  const modified = isModified(scene);

  return (
    <div
      className={overlayClass(
        "modal",
        "z-[10060] flex items-center justify-center bg-black/70 p-4",
      )}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${title}配置`}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-white/10 bg-[#14141C] shadow-2xl shadow-black/60"
      >
        <header className="flex items-center gap-3 border-b border-white/8 px-4 py-3">
          <h2 className="text-sm font-semibold text-(--color-ink-bright)">
            {title}配置
          </h2>
          <div className="flex items-center gap-1 rounded-lg border border-white/8 bg-black/20 p-0.5">
            {SCENES.map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={scene === item}
                onClick={() => setScene(item)}
                className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${
                  scene === item
                    ? "bg-(--color-primary)/20 text-(--color-ink-bright) ring-1 ring-(--color-primary)/50"
                    : "text-(--color-ink-muted) hover:bg-white/6 hover:text-(--color-ink-bright)"
                }`}
              >
                {SIZE_SCENE_LABELS[item]}
              </button>
            ))}
          </div>
          <span className="text-[11px] text-(--color-ink-muted)">
            1k / 2k / 4k 在该场景下的宽高（图片与视频两套口径）
          </span>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="ml-auto rounded-md p-1 text-(--color-ink-muted) transition-colors hover:bg-white/8 hover:text-(--color-ink-bright)"
          >
            <X size={14} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <table className="w-full border-separate border-spacing-y-1 text-[11px]">
            <thead>
              <tr className="text-left text-(--color-ink-muted)">
                <th className="w-[92px] font-medium">比例</th>
                {RESOLUTION_TIERS.map((tier) => (
                  <th key={tier} className="font-medium">
                    {tier.toUpperCase()}（宽 × 高）
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SIZE_RATIO_PRESETS.map((preset) => (
                <tr key={preset.label} className="align-middle">
                  <td className="pr-2 text-(--color-ink-bright)">{preset.label}</td>
                  {RESOLUTION_TIERS.map((tier) => {
                    const dims = table[scene]?.[preset.label]?.[tier] ?? {
                      width: 1024,
                      height: 1024,
                    };
                    return (
                      <td key={tier} className="pr-2">
                        <div className="flex items-center gap-1">
                          <NumberField
                            className="w-[96px]"
                            value={dims.width}
                            min={TABLE_MIN}
                            max={TABLE_MAX}
                            step={8}
                            onChange={(width) =>
                              handleChange(preset.label, tier, {
                                width,
                                height: dims.height,
                              })
                            }
                          />
                          <span className="text-(--color-ink-faint)">×</span>
                          <NumberField
                            className="w-[96px]"
                            value={dims.height}
                            min={TABLE_MIN}
                            max={TABLE_MAX}
                            step={8}
                            onChange={(height) =>
                              handleChange(preset.label, tier, {
                                width: dims.width,
                                height,
                              })
                            }
                          />
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <footer className="flex items-center gap-3 border-t border-white/8 px-4 py-3">
          <button
            type="button"
            onClick={() => resetScene(scene)}
            disabled={!modified}
            className="rounded-md border border-white/12 px-2.5 py-1 text-[11px] text-(--color-ink-muted) transition-colors hover:bg-white/6 hover:text-(--color-ink-bright) disabled:cursor-not-allowed disabled:opacity-40"
          >
            恢复默认（{SIZE_SCENE_LABELS[scene]}）
          </button>
          <span className="text-[10px] text-(--color-ink-faint)">
            改动即时生效并记住；选择「百万像素」时宽高由倍数对齐，不查这张表。
          </span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-md border border-(--color-primary)/40 bg-(--color-primary)/15 px-3 py-1 text-[11px] text-(--color-ink-bright) transition-colors hover:bg-(--color-primary)/25"
          >
            完成
          </button>
        </footer>
      </div>
    </div>
  );
}
