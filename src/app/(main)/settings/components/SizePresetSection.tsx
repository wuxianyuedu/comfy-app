"use client";

/**
 * 「尺寸配置表」分区（ISSUE #3788）：图片 / 视频两场景的「比例 × 分辨率」宽高表。
 *
 * 数据的**唯一持有者**在服务端（项目默认 + 本机覆盖 `data/size-presets.json`，
 * 读取侧逐格合并）；本件只渲染与改格，改完即存（乐观更新，失败回退并念出原因）。
 * 存放位置两态都用徽标标在标题行：本机应用数据（data/size-presets.json）与
 * 项目代码库（src/lib/media/size-presets.ts 的默认表）。
 */

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { DataLocationBadge } from "~/components/data-location/DataLocationBadge";
import { Input } from "~/components/ui/input";
import { SettingsCard } from "~/components/ui/settings-card";
import { RESOLUTION_TIERS, SIZE_RATIO_PRESETS, type SizeScene } from "~/lib/media/size-presets";

import { useSizePresetSection } from "../hooks/use-size-preset-section";

/** 两个场景的展示口径（顺序即渲染顺序）。 */
const SCENES: Array<{ hint: string; label: string; scene: SizeScene }> = [
  {
    hint: "AI 出图口径：1k 长边按 1024 走",
    label: "图片",
    scene: "image",
  },
  {
    hint: "显示器 / 视频行业标准：1K = 1280×720、2K = 2560×1440",
    label: "视频",
    scene: "video",
  },
];

export function SizePresetSection() {
  const c = useSizePresetSection();
  return (
    <SettingsCard
      title="尺寸配置表"
      titleExtra={
        <span className="flex items-center gap-1.5">
          <DataLocationBadge id="size-presets-local" />
          <DataLocationBadge id="size-presets-project" />
        </span>
      }
    >
      <p className="text-muted-foreground mb-3 text-xs leading-relaxed">
        生成时「比例 × 分辨率」的宽高都查这张表：每个比例一行，1k / 2k / 4k
        各给一组宽高。改一格即存本机应用数据（data/size-presets.json）；项目默认跟代码走。
      </p>
      {c.status === null ? null : (
        <div className="border-warning/30 bg-warning/10 text-warning-strong mb-3 rounded-lg border px-3 py-2 text-xs">
          {c.status}
        </div>
      )}
      {SCENES.map(({ scene, label, hint }) => (
        <div className="mt-4" key={scene}>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-ink text-sm font-semibold">{label}</span>
            <span className="text-muted-foreground text-xs">{hint}</span>
            {c.isModified(scene) ? <Badge tone="warning">已改</Badge> : null}
            <Button
              aria-label={`恢复默认 ${label} 尺寸表`}
              className="ml-auto"
              onClick={() => {
                c.resetScene(scene);
              }}
              size="xs"
              variant="outline"
            >
              恢复默认
            </Button>
          </div>
          <table className="border-border-subtle w-full border text-xs">
            <thead>
              <tr className="bg-surface-row text-left">
                <th className="border-border-subtle border-r px-2 py-1.5 font-medium">比例</th>
                {RESOLUTION_TIERS.map((tier) => (
                  <th
                    className="border-border-subtle border-r px-2 py-1.5 text-center font-medium last:border-r-0"
                    key={tier}
                  >
                    {tier.toUpperCase()}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SIZE_RATIO_PRESETS.map((preset) => (
                <tr key={preset.label}>
                  <td className="border-border-subtle border-t border-r px-2 py-1.5">
                    {preset.label}
                  </td>
                  {RESOLUTION_TIERS.map((tier) => {
                    const dims = c.table[scene][preset.label]?.[tier];
                    return (
                      <td
                        className="border-border-subtle border-t border-r px-2 py-1.5 text-center last:border-r-0"
                        key={tier}
                      >
                        {dims === undefined ? null : (
                          <span className="flex items-center justify-center gap-1">
                            <Input
                              aria-label={`${label} ${preset.label} ${tier.toUpperCase()} 宽`}
                              className="h-7 w-16 px-1.5 text-center text-xs"
                              inputMode="numeric"
                              onChange={(e) => {
                                const width = Number(e.target.value);
                                if (Number.isFinite(width) && width > 0) {
                                  c.setDims(scene, preset.label, tier, {
                                    height: dims.height,
                                    width,
                                  });
                                }
                              }}
                              value={dims.width}
                            />
                            <span className="text-muted-foreground">×</span>
                            <Input
                              aria-label={`${label} ${preset.label} ${tier.toUpperCase()} 高`}
                              className="h-7 w-16 px-1.5 text-center text-xs"
                              inputMode="numeric"
                              onChange={(e) => {
                                const height = Number(e.target.value);
                                if (Number.isFinite(height) && height > 0) {
                                  c.setDims(scene, preset.label, tier, {
                                    height,
                                    width: dims.width,
                                  });
                                }
                              }}
                              value={dims.height}
                            />
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </SettingsCard>
  );
}
