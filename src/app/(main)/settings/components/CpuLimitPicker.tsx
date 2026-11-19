"use client";

/**
 * 「出图进程 CPU 档位」单选（规范 17 §17.2 第③层，纯展示；ISSUE #1959）。
 * 档位措辞只从 `~/lib/comfyui/cpu-limit` 的 `CPU_LIMIT_LABELS` 读（§12.14，两处各写一遍会漂）；
 * 三档动的是优先级 / 亲和性而非占用百分比，「不限制」在任务管理器里仍可 100%，必须向用户说清。
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
        className="flex flex-col gap-1.5"
        onValueChange={(raw) => {
          /* 基元的 `onValueChange` 出参是 `any`：先落 `unknown`，再按 `CPU_LIMIT_MODES` 收窄。 */
          const next: unknown = raw;
          const mode = CPU_LIMIT_MODES.find((candidate) => candidate === next);
          if (mode !== undefined) {
            void c.commitPrefs({ comfyuiCpuLimit: mode });
          }
        }}
        value={value}
      >
        {CPU_LIMIT_MODES.map((mode) => {
          /* `RadioGroupItem` 与标签的关联走 **`htmlFor` + `id`**（不是把
           * 标签包在外面，见 `ui/radio-group` 的 story 与 P78 判据）：裸
           * `<label>` 在 Base UI 这一族上点标签不聚焦控件、读屏器也把它读成
           * 孤立文本。id 用档位名派生，组内唯一且稳定。 */
          const id = `cpu-limit-${mode}`;
          return (
            <div className="flex items-start gap-2" key={mode}>
              <RadioGroupItem className="mt-0.5" id={id} value={mode} />
              <div className="flex flex-col">
                <Label className="text-ink text-sm font-normal" htmlFor={id}>
                  {CPU_LIMIT_LABELS[mode]}
                </Label>
                <span className="text-muted-foreground text-xs">{CPU_LIMIT_HINTS[mode]}</span>
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
