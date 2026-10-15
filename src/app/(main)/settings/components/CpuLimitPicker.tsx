"use client";

/**
 * 「出图进程 CPU 档位」的单选（规范 17 §17.2 第③层，纯展示）。
 *
 * ISSUE #1959：用户诉求是「限制 cpu 占用」。出图是可长跑的后台负载，占满机器时
 * 用户在同一个窗口里干活（编辑器 / 浏览器 / 画布拖拽）都在抢同一批核。
 *
 * 三档的措辞与语义只从 `~/lib/comfyui/cpu-limit` 读（`CPU_LIMIT_LABELS`）——
 * 这里只负责排版与把选择交回 controller。档位的人话名在设置页与 ComfyUI 页的
 * 运行日志里各出现一次，各写一遍就会漂成「让路」/「低优先级」两种说法指一件事
 * （§12.14）。
 *
 * 为什么要有那一行「怎么实现」的说明：这三档在系统层面动的是**优先级 / 亲和性**，
 * 而不是一个「80%」的数字。不说清的话，用户看到「不限制」的进程在任务管理器里
 * 仍是 100% 占用时会以为设置坏了 —— 那时机器确实没人在抢（见 cpu-limit 的
 * 文件头：让路档只在有竞争者时才让路）。
 */

import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { FieldLabel } from "~/components/ui/field";
import { Label } from "~/components/ui/label";
import { isDesktopShell } from "~/lib/shell/desktop-shell-client";
import {
  CPU_LIMIT_LABELS,
  CPU_LIMIT_MODES,
  THROTTLE_CPU_RATIO,
  type CpuLimitMode,
} from "~/lib/comfyui/cpu-limit";
import type { ReadySettingsPageController } from "../hooks/use-settings-page";

/** 每一档要说的第二句话（第一句是人话名，取自 `CPU_LIMIT_LABELS`）。 */
const CPU_LIMIT_HINTS: Record<CpuLimitMode, string> = {
  off: "出图占满能用的核（默认在浏览器里启动时）",
  yield: "只在有人抢时才让路，机器闲着时照样全速",
  throttle: `最多用 ${THROTTLE_CPU_RATIO * 100}% 的核，出图本身会变慢`,
};

export function CpuLimitPicker({ c }: { c: ReadySettingsPageController }) {
  /* 缺值（老设置文件里没有这个键）时按桌面壳 / 浏览器分叉的默认档渲染：
   * 判据在 `cpu-limit` 的 `resolveCpuLimitMode`，这里不重判一次 ——
   * 两处判就会漂成「界面上是让路、实际按不限制跑」。 */
  const value: CpuLimitMode =
    c.drafts.settings.comfyuiCpuLimit ?? (isDesktopShell() ? "yield" : "off");

  return (
    <div className="mb-3">
      <FieldLabel className="mb-1.5 block text-sm">出图 CPU 占用</FieldLabel>
      <RadioGroup
        aria-label="出图 CPU 占用档位"
        value={value}
        onValueChange={(v) =>
          c.patchSettings({ comfyuiCpuLimit: v as CpuLimitMode })
        }
        className="flex flex-col gap-1.5"
      >
        {CPU_LIMIT_MODES.map((mode) => {
          /* `RadioGroupItem` 与标签的关联走 **`htmlFor` + `id`**（不是把
           * 标签包在外面，见 `ui/radio-group` 的 story 与 P78 判据）：裸
           * `<label>` 在 Base UI 这一族上点标签不聚焦控件、读屏器也把它读成
           * 孤立文本。id 用档位名派生，组内唯一且稳定。 */
          const id = `cpu-limit-${mode}`;
          return (
            <div key={mode} className="flex items-start gap-2">
              <RadioGroupItem value={mode} id={id} className="mt-0.5" />
              <div className="flex flex-col">
                <Label htmlFor={id} className="text-ink text-sm font-normal">
                  {CPU_LIMIT_LABELS[mode]}
                </Label>
                <span className="text-muted-foreground text-xs">
                  {CPU_LIMIT_HINTS[mode]}
                </span>
              </div>
            </div>
          );
        })}
      </RadioGroup>
      <p className="text-muted-foreground mt-1.5 text-xs">
        档位在
        <span className="text-ink">下次启动 ComfyUI 时</span>
        生效——对已经跑着的那个进程改不了（要立刻生效就先停再启一次）。
      </p>
    </div>
  );
}
