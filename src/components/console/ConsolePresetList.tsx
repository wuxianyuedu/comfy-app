"use client";

// 控制台预设命令列表（视图第③层，纯展示）。
//
// 「点一下把命令**填进输入框**」而不是「点一下直接跑」是本组件唯一的交互决定：
// 预设里有 `pnpm db:push` 这种会真的改库的命令，而界面必须让用户在按下回车前
// 看清它到底要跑什么、也留出「加两个参数」的余地。这同时让「预设」与「自由行」
// 是**同一条链路**（都是用户在输入框里按下回车）——两条链路迟早就分叉
// （一条记历史、一条不记，或者一条能停止、一条不能）。
//
// ## 悬停提示放什么：左边一列只有 240px，两行文字都必须能被读全
//
// 侧栏窄（`lg:w-60` = 240px），条目上的**展示名与说明小字都带 `truncate`** ——
// 这是必要的（不截断就会被长说明顶成三层行高、把整列撑成一条流水账），代价是
// 「`pnpm check:all` 到底是跑哪个脚本」这类信息在界面上根本读不到。
// 所以浮层要把**两行都补全**，而不是只回显命令：
//   · 说明小字（`desc`）是「这条命令做什么、什么时候用」—— 截断掉的正是它；
//   · 命令（`command`）是「点下去会填进什么」—— 界面上本来就没显示过它。
// 只回显命令等于把用户最想知道的那句（说明）留在截断里，悬停也看不到。
//
// 浮层内容按 `TooltipContent` 的既有形态给（`max-w-xs` + `wrap-break-word`）：
// 说明小字在这一档里会正常折行、读全；`max-w-xs` 是浮层自己的上限，不受侧栏
// 240px 影响（这正是它存在的意义）。
//
// ## 每一组可折叠（默认**全部折起**）
//
// 七组、三十多条命令排下来是一列竖着的长清单，而真正在用的往往是其中一组：
// 找 `db:push` 要先把「质量门禁」那十条滚过去。所以分组头改成折叠开关。
//
// 默认全折起是**有意的**：这一列的全部内容（每组几条、各叫什么）不需要同时看见，
// 展开哪一组是用户当下的意图。反面口径是「默认全展开、让用户自己收起」—— 那等于
// 什么都没省，还把「找一条命令」变成「先滚一遍」。
//
// 折叠开关走 `ui/disclosure`（唯一出口），状态走 `ui/expansion-set`（唯一出口）——
// 两者都是既成的基元，这个组件只负责把它们接起来。

import { ChevronRight } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Disclosure } from "~/components/ui/disclosure";
import { useExpansionSet } from "~/components/ui/expansion-set";
import { Hint } from "~/components/ui/hint";
import {
  CONSOLE_PRESETS,
  type ConsolePreset,
} from "~/lib/console/console-catalog";

export interface ConsolePresetListProps {
  onFill: (command: string) => void;
  /** 有命令在跑时禁用（避免用户以为点了就会插队执行）。 */
  disabled: boolean;
}

/**
 * 一条预设的悬停提示：展示名 + 说明小字 + 会填进输入框的命令。
 *
 * 三段都带，是因为它们在界面上各自缺一块：展示名可能截断、说明小字必然截断、
 * 命令则从来没露过面。三句都不长，浮层 `max-w-xs` 折行放得下。
 */
function presetHint(preset: ConsolePreset) {
  return (
    <span className="flex flex-col gap-1 text-left">
      <span className="font-medium">{preset.label}</span>
      <span className="opacity-80">{preset.desc}</span>
      <span className="font-mono opacity-80">{preset.command}</span>
    </span>
  );
}

export function ConsolePresetList({
  onFill,
  disabled,
}: ConsolePresetListProps) {
  /* 展开集合走唯一出口：键是分组 id，缺键 = 未表态 = 折起
   * （`useExpansionSet` 的既定语义，正是这里要的默认值）。 */
  const groups = useExpansionSet();

  return (
    <div
      data-testid="console-preset-list"
      className="custom-scrollbar flex h-full min-h-0 flex-col gap-1 overflow-y-auto p-3"
    >
      {CONSOLE_PRESETS.map((group) => {
        const open = groups.isExpanded(group.id);
        return (
          <Disclosure
            key={group.id}
            open={open}
            onOpenChange={() => groups.toggle(group.id)}
            marker="chevron"
            /* 整排的排布在 Root 上（`rootClassName`）：触发开关与右侧那个条数
             * 是 Root 的**并列**子元素，Root 不写 `flex` 它们就各自独占一行
             * （规范 16 §16.2.4.13 的迁移口径，与 `NodesTab` 的分组头同款）。
             * `className` 的宽档要与它配对（`w-auto flex-1`）—— 基元默认
             * `w-full` 会把条数挤到下一行。
             *
             * **`flex-wrap` 与 `basis-full` 是一对，缺了它就砸**（ISSUE #1902）：
             * 面板的 `basis-full` 在**会换行**的行里等于「独占下一行」，
             * 而不会换行的行里它等于「横着占满这一行」—— 于是它把 240px 的
             * 侧栏几乎全吃掉，组名与分组说明只剩几十像素，中文按字竖排成一条
             * 一条的（实测这里 7 组、每组头高 145~315px，整列滚动高度 1463px
             * 对 698px 视口）。这是「面板要换行、行却不会换」的一处搭配错误，
             * 不是样式细节：`basis-full` 的语义**依赖**同一容器上有 `flex-wrap`。
             * 基元自己的用例（`ui/disclosure.test.tsx` 那条「面板不随内容收缩」）
             * 用的正是 `flex flex-wrap` + `basis-full` 这对写法。 */
            rootClassName="flex flex-wrap items-center gap-2"
            className="hover:text-ink w-auto flex-1 py-1"
            panelClassName="basis-full flex flex-col gap-0.5 pt-0.5"
            trigger={
              <span
                className="min-w-0 flex-1"
                data-testid={`console-preset-group-${group.id}`}
              >
                <span className="text-ink block text-xs font-semibold">
                  {group.label}
                </span>
                {/* 分组说明是**两句以里的常驻文案**（`leading-snug` 折行显示），
                    不截断、也不挂悬停 —— 它已经在屏上读全了。折起时它跟着组名
                    一起留在头上：说明是「这一组是干什么的」的唯一线索。 */}
                <span className="text-ink-fainter text-2xs block leading-snug">
                  {group.hint}
                </span>
              </span>
            }
            trailing={
              <span className="text-ink-fainter text-3xs shrink-0 tabular-nums">
                {group.items.length}
              </span>
            }
          >
            {group.items.map((item) => (
              <Hint key={item.id} label={presetHint(item)} side="right">
                <Button
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => onFill(item.command)}
                  data-testid={`console-preset-${item.id}`}
                  className="group text-ink-muted hover:bg-subtle hover:text-ink-strong h-auto w-full justify-start gap-1.5 rounded-md px-2 py-1.5 text-left text-xs font-normal"
                >
                  <ChevronRight
                    data-icon="inline-start"
                    size={12}
                    className="text-ink-fainter shrink-0"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{item.label}</span>
                    <span className="text-ink-fainter text-3xs block truncate">
                      {item.desc}
                    </span>
                  </span>
                </Button>
              </Hint>
            ))}
          </Disclosure>
        );
      })}
    </div>
  );
}
