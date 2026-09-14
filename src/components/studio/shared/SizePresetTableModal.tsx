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
        "z-[10060] flex items-center justify-center bg-canvas-deep p-4 backdrop-blur-sm dark:bg-black/70",
      )}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${title}配置`}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border-strong bg-panel shadow-2xl shadow-black/12 dark:shadow-black/60"
      >
        <header className="flex items-center gap-3 border-b border-border-strong px-4 py-3">
          <h2 className="text-sm font-semibold text-ink-bright">
            {title}配置
          </h2>
          <div className="flex items-center gap-1 rounded-lg border border-border-strong bg-canvas-deep p-0.5">
            {SCENES.map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={scene === item}
                onClick={() => setScene(item)}
                className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${
                  scene === item
                    ? "bg-primary/20 text-ink-bright ring-1 ring-primary/50"
                    : "text-ink-muted hover:bg-subtle hover:text-ink-bright"
                }`}
              >
                {SIZE_SCENE_LABELS[item]}
              </button>
            ))}
          </div>
          <span className="text-[11px] text-ink-muted">
            1k / 2k / 4k 在该场景下的宽高（图片与视频两套口径）
          </span>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="ml-auto rounded-md p-1 text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink-bright"
          >
            <X size={14} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <table className="w-full border-separate border-spacing-y-1 text-[11px]">
            <thead>
              <tr className="text-left text-ink-muted">
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
                  <td className="pr-2 text-ink-bright">{preset.label}</td>
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
                          <span className="text-ink-faint">×</span>
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

        <footer className="flex items-center gap-3 border-t border-border-strong px-4 py-3">
          <button
            type="button"
            onClick={() => resetScene(scene)}
            disabled={!modified}
            className="rounded-md border border-border-strong px-2.5 py-1 text-[11px] text-ink-muted transition-colors hover:bg-subtle hover:text-ink-bright disabled:cursor-not-allowed disabled:opacity-40"
          >
            恢复默认（{SIZE_SCENE_LABELS[scene]}）
          </button>
          <span className="text-[10px] text-ink-faint">
            改动即时生效并记住；选择「百万像素」时宽高由倍数对齐，不查这张表。
          </span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-md border border-primary/40 bg-primary/15 px-3 py-1 text-[11px] text-ink-bright transition-colors hover:bg-primary/25"
          >
            完成
          </button>
        </footer>
      </div>
    </div>
  );
}
