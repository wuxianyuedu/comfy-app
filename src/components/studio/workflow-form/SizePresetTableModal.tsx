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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { NumberField } from "~/components/ui/number-field";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { OVERLAY_MAX_HEIGHT } from "~/components/ui/overlay-max-height";
import {
  RESOLUTION_TIERS,
  SIZE_RATIO_PRESETS,
  SIZE_SCENE_LABELS,
  type ResolutionTier,
  type SizeDims,
  type SizeScene,
} from "~/lib/media/size-presets";
import { useSizePresetTable } from "./hooks/use-size-preset-table";

const SCENES: Array<SizeScene> = ["image", "video"];

/** 表里允许的宽高范围：比常规参数的 [64, 4096] 宽 —— 超宽 4k 档要到 5120。 */
const TABLE_MIN = 64;
const TABLE_MAX = 8192;

export function SizePresetTableModal({
  onClose,
  scene: initialScene = "image",
  title = "尺寸表",
}: {
  onClose: () => void;
  /** 打开时选中的场景页签（当前控件正用的场景）。 */
  scene?: SizeScene;
  title?: string;
}) {
  const { isModified, resetScene, setDims, table } = useSizePresetTable();
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
    <Dialog onOpenChange={(next) => !next && onClose()} open>
      <DialogContent
        aria-label={`${title}配置`}
        className="max-w-3xl"
        popupClassName={`flex ${OVERLAY_MAX_HEIGHT} w-full max-w-3xl flex-col gap-0 overflow-hidden rounded-xl p-0`}
      >
        <DialogHeader className="border-border-strong flex-row items-center gap-3 border-b px-4 py-3">
          <DialogTitle className="text-ink-bright text-sm font-semibold">{title}配置</DialogTitle>
          <div className="border-border-strong bg-canvas-deep flex items-center gap-1 rounded-lg border p-0.5">
            <ToggleGroup
              aria-label="尺寸档位场景"
              className="gap-1"
              multiple={false}
              onValueChange={(vals) => {
                const next = vals[0];
                if (next === "image" || next === "video") {
                  setScene(next);
                }
              }}
              value={[scene]}
            >
              {SCENES.map((item) => (
                <ToggleGroupItem
                  className="text-2xs h-auto rounded-md px-2.5 py-1"
                  key={item}
                  value={item}
                >
                  {SIZE_SCENE_LABELS[item]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <span className="text-ink-muted text-2xs">
            1k / 2k / 4k 在该场景下的宽高（图片与视频两套口径）
          </span>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <Table className="text-2xs border-separate border-spacing-y-1">
            <TableHeader>
              <TableRow className="text-ink-muted border-0 text-left hover:bg-transparent">
                <TableHead className="w-23 font-medium">比例</TableHead>
                {RESOLUTION_TIERS.map((tier) => (
                  <TableHead className="font-medium" key={tier}>
                    {tier.toUpperCase()}（宽 × 高）
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {SIZE_RATIO_PRESETS.map((preset) => (
                <TableRow className="align-middle" key={preset.label}>
                  <TableCell className="text-ink-bright pr-2">{preset.label}</TableCell>
                  {RESOLUTION_TIERS.map((tier) => {
                    const dims = table[scene]?.[preset.label]?.[tier] ?? {
                      height: 1024,
                      width: 1024,
                    };
                    return (
                      <TableCell className="pr-2" key={tier}>
                        <div className="flex items-center gap-1">
                          <NumberField
                            className="w-24"
                            max={TABLE_MAX}
                            min={TABLE_MIN}
                            onChange={(width) =>
                              handleChange(preset.label, tier, {
                                height: dims.height,
                                width,
                              })
                            }
                            step={8}
                            value={dims.width}
                          />
                          <span className="text-ink-faint">×</span>
                          <NumberField
                            className="w-24"
                            max={TABLE_MAX}
                            min={TABLE_MIN}
                            onChange={(height) =>
                              handleChange(preset.label, tier, {
                                height,
                                width: dims.width,
                              })
                            }
                            step={8}
                            value={dims.height}
                          />
                        </div>
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="border-border-strong flex items-center gap-3 border-t px-4 py-3">
          <Button
            className="text-2xs h-auto px-2.5 py-1"
            disabled={!modified}
            onClick={() => resetScene(scene)}
            variant="outline"
          >
            恢复默认（{SIZE_SCENE_LABELS[scene]}）
          </Button>
          <span className="text-ink-faint text-3xs">
            改动即时生效并记住；选择「百万像素」时宽高由倍数对齐，不查这张表。
          </span>
          <Button
            className="text-2xs ml-auto h-auto px-3 py-1"
            onClick={onClose}
            variant="primary-solid"
          >
            完成
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
