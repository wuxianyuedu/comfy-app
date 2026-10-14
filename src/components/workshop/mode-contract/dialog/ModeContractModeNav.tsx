"use client";

// ── 「模式契约」的模式选择导航：**一棵竖向的树**（规范 17 §17.2 第③层）──────
// 父行 = 输出类别（图像 / 视频 / 音频，弱一档、**可折叠**），子行 = 模式（可点、
// 当前模式标 `aria-checked`）。缩进与引导线由 `~/components/ui/tree-rows` 一次
// 给全（§16.2.4.39，P36 硬闸），本文件不手写 `ml-* / border-l-*`。
//
// ## 为什么是树，而不是一排平铺的 chip
//
// 改版前这一屏把所有模式按类别**平铺成三排 chip**（实测 22 枚、占三四行、还随
// 窗口宽度反复折行）—— 用户的原话是「模式契约设计成树形页签，现在散放一堆占
// 空间」。平铺的形态上限就在这里：类别只能靠一行小字暗示，且宽度不够时整排往下
// 掉，纵向空间被这一块吃掉（正是 ISSUE #1694 在设置页分区导航上遇到过的同一个
// 问题，结论同样是收成竖向的树）。
//
// 收成树之后：类别是父行、模式是挂在它下面的子行，层级由**缩进 + 引导线**表达；
// 纵向溢出交给导航自己的滚动条（`settings` 那棵树的同一形态），正文不再被它推着走。
//
// ## 为什么父行是**折叠开关**（ISSUE #1870 第二刀）
//
// 第一刀把平铺 chip 收成树之后，用户的下一条反馈是「每一类需要可折叠」——树里
// 最长的那个类别（图像，11 条模式）仍会把另外两类挤出可视区，而那两类才是要找
// 东西时真正想先看见的。
//
// 折叠三层各归各的出口，本文件不自己实现任何一层（规范 16 §16.2.4.13 / .17 / .39）：
//
//   · **哪些类别折着** → `useExpansionSet`（状态，键 = 类别）；
//   · **父行怎么折** → `Disclosure`（交互 + a11y：`aria-expanded` / `aria-controls` /
//     键盘 / `hidden="until-found"`）；
//   · **折起来的那一摞怎么画** → `TreeChildren`（缩进档 + 引导线）。
//
// 三个默认值都是判据的一部分，不是随手写的：**初始全部展开**（收起只是「先看别的
// 类别」的临时动作，默认折着等于把当前模式藏起来）、`aria-label` 保持
// 「选择要配置的模式」不变（折叠改的是类别那一层，这一块的**职责**没变 ——
// 它仍是「选一条模式」，顺带折叠告的是可访问名的锚点）、父行不 `aria-hidden`
// （未折叠前它只是分组头、不进可访问树；一旦可点，它的 `aria-expanded` 就是
// 这一层唯一的语义载体，再标隐藏会把折叠态从可访问树里抹掉）。
//
// 本组件不持有契约状态：值从 props 来、动作往上抛（与编辑器其余部分同一条分层）。
// 展开集合是**本组件自己的**交互状态（与「选了哪条模式」不同，后者是契约状态），
// 所以它留在这一层，不上抛。

import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { Disclosure } from "~/components/ui/disclosure";
import { useExpansionSet } from "~/components/ui/expansion-set";
import { TreeChildren } from "~/components/ui/tree-rows";

import { contractModeTree } from "../mode-contract-config";

export function ModeContractModeNav({
  activeMode,
  storedCustomized,
  onSelect,
}: {
  /** 当前选中的模式码（null = 未选）。 */
  activeMode: string | null;
  /** 注册表里已被用户改过的模式（标「已改」）。 */
  storedCustomized: (mode: string) => boolean;
  /** 选一个模式。 */
  onSelect: (mode: string) => void;
}) {
  /* 类别 → 是否展开。**初始全部展开**（把每个类别先表一次态），收起是「先看别的
     类别」的临时动作，默认折着等于把当前模式藏起来。 */
  const groups = contractModeTree();
  const categoryExpansion = useExpansionSet(
    Object.fromEntries(groups.map((g) => [g.category, true])),
  );

  return (
    /* 一排模式里只有一个能选中 —— 单选语义（`role="radiogroup"` / `radio`），
       与「模型适配」的模型清单同一条契约。折叠与否不改变这一块的职责，
       所以 `aria-label` 仍是「选择要配置的模式」。 */
    <div role="radiogroup" aria-label="选择要配置的模式" className="mb-3">
      {groups.map((group) => {
        const open = categoryExpansion.isExpanded(group.category);
        return (
          <Disclosure
            key={group.category}
            /* 受控：展开态就是**哪些类别折着**这份集合（§16.2.4.17）。
               交给基元的那部分只有「父行怎么折」——`aria-expanded` /
               `aria-controls` / 键盘 / `hidden="until-found"` 都在它里头。 */
            open={open}
            onOpenChange={() => categoryExpansion.toggle(group.category)}
            marker="caret"
            className="hover:text-ink mb-3 gap-1 px-2 text-xs font-medium"
            /* 折起来时那一摞走 `TreeChildren`（缩进档 + 引导线一处给全，
               §16.2.4.39）；`data-category` 是给用例锚「哪一类」的记号。 */
            panelClassName="mb-3"
            trigger={
              <span
                data-category={group.category}
                className="text-ink-fainter min-w-0 flex-1 truncate"
              >
                {group.label}
              </span>
            }
          >
            <TreeChildren depth={1} className="flex flex-col gap-0.5">
              {group.modes.map((t) => {
                const active = activeMode === t.code;
                const customized = storedCustomized(t.code);
                return (
                  <Button
                    key={t.code}
                    variant="ghost"
                    /* `data-mode` 是给用例锚「这一行是哪条模式」的记号（按可访问名
                       找会随文案变，code 才是身份）。 */
                    data-mode={t.code}
                    role="radio"
                    aria-checked={active}
                    onClick={() => onSelect(t.code)}
                    className={cn(
                      "h-auto w-full justify-start gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium",
                      active
                        ? "bg-primary-soft text-primary-strong hover:bg-primary-soft hover:text-primary-strong"
                        : "text-ink-muted hover:text-ink",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate text-left">
                      {t.label}
                    </span>
                    {customized && (
                      <span
                        className={cn(
                          "text-2xs shrink-0",
                          active ? "text-primary/70" : "text-ink-fainter",
                        )}
                      >
                        已改
                      </span>
                    )}
                  </Button>
                );
              })}
            </TreeChildren>
          </Disclosure>
        );
      })}
    </div>
  );
}
