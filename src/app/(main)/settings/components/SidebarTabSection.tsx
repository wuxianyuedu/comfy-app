"use client";

/**
 * 工作区界面的页签行为分区（ISSUE #3623 / #3798）：每个界面点开后是**独立标签页**
 * （常驻，切走不关）还是**共享标签页**（切走即关），按项配置、落在 JSON 里。
 *
 * 清单取 `configurableTabViews()`（首页除外的**全部全局视图**），不只侧栏那几项：
 * 设置与 UI 控件总览虽然入口在顶栏菜单 / 命令面板，切走关不关同样是用户该能配的
 * 事 —— 否则那两屏永远由代码写死，「设置里配了、界面却不认」就是两处各说各话。
 *
 * 两种保存方式与「模式契约」同一套口径：
 *   · 「保存」 —— 落本机（`data/`），开发版与正式包都能用；
 *   · 「保存为项目默认（跟代码走）」 —— 落项目默认那份入库 JSON，只有开发检出可用。
 *
 * 纯展示：只消费 `useSidebarTabSection` 那个控制器（逻辑层），自身不碰 tRPC。
 */

import { Button } from "~/components/ui/button";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { SettingsCard, SETTINGS_ROW_CLASS } from "~/components/ui/settings-card";
import { configurableTabViews } from "~/components/studio/NavItems";
import {
  SIDEBAR_TAB_MODE_LABEL,
  sidebarTabModeOf,
  type SidebarTabMode,
} from "~/lib/shell/sidebar-tab-behavior";

import { useSidebarTabSection } from "../hooks/use-sidebar-tab-section";

/** 两档行为各自意味着什么（每行只说一遍，不逐项复述）。 */
const MODE_HINT: Record<SidebarTabMode, string> = {
  independent: "点开后占一个页签，切到别处它仍留着（切回来接着用）。",
  shared: "点开后切到别处它就关掉，不在页签条上留位置。",
};

/** 配置面里没有这一项时的兜底：项目默认为每个全局视图都写了档位，缺项按「常驻」处理。 */
const FALLBACK_MODE: SidebarTabMode = "independent";

export function SidebarTabSection() {
  const c = useSidebarTabSection();
  const items = configurableTabViews();

  return (
    <SettingsCard>
      <p className="text-muted-foreground mb-4 text-xs leading-relaxed">
        每个界面点开后是
        <strong className="text-ink/80">独立标签页</strong>
        （切走仍留着）还是
        <strong className="text-ink/80">共享标签页</strong>
        （切走即关，不在页签条上留位置），按项配置 —— 侧栏里的各项，以及从顶栏菜单、
        命令面板打开的「设置」「UI 控件总览」都在这份清单里。改动即时生效 —— 已经在开的
        页签按新规则在下次切换时生效。
      </p>
      <ul className="flex flex-col gap-1">
        {items.map((item) => {
          const mode = c.draft
            ? (sidebarTabModeOf(item.id, c.draft) ?? FALLBACK_MODE)
            : FALLBACK_MODE;
          return (
            <li
              className={`${SETTINGS_ROW_CLASS} flex items-start justify-between gap-4`}
              key={item.id}
            >
              <div className="min-w-0">
                <div className="text-ink/90 text-sm font-medium">{item.label}</div>
                <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                  {MODE_HINT[mode]}
                </p>
              </div>
              <ModeChoice
                label={item.label}
                onChange={(next) => {
                  c.setMode(item.id, next);
                }}
                value={mode}
              />
            </li>
          );
        })}
      </ul>

      {c.status && (
        <p className="bg-success/10 text-success-strong mt-3 rounded-lg px-3 py-2 text-xs">
          {c.status}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          disabled={c.saving || c.draft === null}
          onClick={() => {
            void c.save();
          }}
          variant="primary-solid"
        >
          {c.saving ? "保存中…" : "保存"}
        </Button>
        {c.customized && (
          <Button
            disabled={c.resetBusy}
            onClick={() => {
              void c.resetToDefault();
            }}
            variant="outline"
          >
            {c.resetBusy ? "还原中…" : "还原默认"}
          </Button>
        )}
        {/* 只在开发检出出现：正式包没有源码可写，「项目默认」无从谈起。 */}
        {c.projectDefaultEditable && (
          <Button
            disabled={c.savingProjectDefaults || c.draft === null}
            onClick={() => {
              void c.saveAsProjectDefaults();
            }}
            variant="outline"
          >
            {c.savingProjectDefaults ? "写入中…" : "保存为项目默认（跟代码走）"}
          </Button>
        )}
      </div>
    </SettingsCard>
  );
}

/** 两档行为的单选（药丸形态：方向键契约由 `RadioGroup` 基元下发）。 */
function ModeChoice({
  label,
  value,
  onChange,
}: {
  label: string;
  onChange: (mode: SidebarTabMode) => void;
  value: SidebarTabMode;
}) {
  return (
    <RadioGroup
      aria-label={`${label}的页签行为`}
      /* `w-auto` 是必须的：基元自带 `w-full`，而这一行左边是文字、右边是两颗药丸 ——
         不把它收成内容宽，整行会被药丸占满、左侧文字被压成一字宽的竖列（实测截图）。 */
      className="flex w-auto shrink-0 gap-1"
      onValueChange={(raw) => {
        /* 基元的 `onValueChange` 出参是 `any`：先落 `unknown`，再按字面量收窄。 */
        const v: unknown = raw;
        if (v === "independent" || v === "shared") {
          onChange(v);
        }
      }}
      value={value}
    >
      {(["independent", "shared"] as const).map((mode) => (
        <RadioGroupItem
          key={mode}
          nativeButton
          render={
            <Button
              className="data-checked:border-primary data-checked:bg-primary-soft data-checked:text-primary data-checked:hover:border-primary data-checked:hover:bg-primary-soft data-checked:hover:text-primary data-unchecked:border-border data-unchecked:bg-surface-row data-unchecked:text-muted-foreground data-unchecked:hover:border-border-strong data-unchecked:hover:text-ink aspect-auto! size-auto! rounded-lg border px-3 py-1.5 text-xs **:data-[slot=radio-group-indicator]:hidden"
              size="sm"
              variant="ghost"
            />
          }
          value={mode}
        >
          {SIDEBAR_TAB_MODE_LABEL[mode]}
        </RadioGroupItem>
      ))}
    </RadioGroup>
  );
}
