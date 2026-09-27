"use client";

/* 尺寸表配置弹窗（规范 §17.2 第③层：只渲染 + 上抛）。
 *
 * 展示并允许修改「比例 × 分辨率档 → 宽高」这张表 —— 1k / 2k / 4k 在图片
 * （AI 出图）与视频（显示器 / 视频行业标准）两个场景下不是同一组值，
 * 因此按场景分页签，改动即时落到 `useSizePresetTable`（已挂载的尺寸控件同步换值）。
 *
 * 这里不做任何换算：表就是唯一事实，换算在 `lib/size-presets.ts`。 */

import { useCallback, useState } from "react";

import { Button } from "~/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { NumberField } from "~/components/ui/number-field";
import {
  RESOLUTION_TIERS,
  SIZE_RATIO_PRESETS,
  SIZE_SCENE_LABELS,
  type ResolutionTier,
  type SizeDims,
  type SizeScene,
} from "~/lib/media/size-presets";
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

  const handleChange = useCallback(
    (ratioLabel: string, tier: ResolutionTier, size: SizeDims) => {
      setDims(scene, ratioLabel, tier, size);
    },
    [scene, setDims],
  );

  const modified = isModified(scene);

  return (
    /* 浮层走 `ui/dialog`（规范 16 §16.2.3 P2）：此前这里自搓遮罩 + 手写 Esc，
       与 `ui/dialog` 是同一个能力的第二份实现（Esc / 点遮罩关闭、焦点归还
       只在基元那边有）。尺寸表弹窗要的是「大一点的居中卡片」，这属于形态，
       经 `popupClassName` 覆盖即可。 */
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        aria-label={`${title}配置`}
        className="max-w-3xl"
        popupClassName="flex max-h-[85vh] w-full max-w-3xl flex-col gap-0 overflow-hidden rounded-xl p-0"
      >
        <DialogHeader className="border-border-strong flex-row items-center gap-3 border-b px-4 py-3">
          <DialogTitle className="text-ink-bright text-sm font-semibold">
            {title}配置
          </DialogTitle>
          <div className="border-border-strong bg-canvas-deep flex items-center gap-1 rounded-lg border p-0.5">
            <ToggleGroup
              multiple={false}
              value={[scene]}
              onValueChange={(vals) => {
                const next = vals[0];
                if (next === "image" || next === "video") setScene(next);
              }}
              aria-label="尺寸档位场景"
              className="gap-1"
            >
              {SCENES.map((item) => (
                <ToggleGroupItem
                  key={item}
                  value={item}
                  className="h-auto rounded-md px-2.5 py-1 text-[11px]"
                >
                  {SIZE_SCENE_LABELS[item]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <span className="text-ink-muted text-[11px]">
            1k / 2k / 4k 在该场景下的宽高（图片与视频两套口径）
          </span>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <table className="w-full border-separate border-spacing-y-1 text-[11px]">
            <thead>
              <tr className="text-ink-muted text-left">
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
                  <td className="text-ink-bright pr-2">{preset.label}</td>
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

        <div className="border-border-strong flex items-center gap-3 border-t px-4 py-3">
          <Button
            variant="outline"
            onClick={() => resetScene(scene)}
            disabled={!modified}
            className="h-auto px-2.5 py-1 text-[11px]"
          >
            恢复默认（{SIZE_SCENE_LABELS[scene]}）
          </Button>
          <span className="text-ink-faint text-[10px]">
            改动即时生效并记住；选择「百万像素」时宽高由倍数对齐，不查这张表。
          </span>
          <Button
            variant="primary-solid"
            onClick={onClose}
            className="ml-auto h-auto px-3 py-1 text-[11px]"
          >
            完成
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
