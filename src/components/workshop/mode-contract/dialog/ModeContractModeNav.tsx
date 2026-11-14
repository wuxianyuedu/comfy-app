"use client";

// ── 「模式契约」的模式选择导航：**一棵竖向的树**（规范 17 §17.2 第③层）。父行 = 输出类别（弱一档、可折叠），子行 = 模式（`aria-checked` 标当前）；
// 缩进与引导线由 `~/components/ui/tree-rows` 给全（§16.2.4.39，P36 硬闸）。
// 为什么树（ISSUE #1870）：22 枚模式平铺成 chip 占三四行还折行；折叠三层各归各的出口 —— `useExpansionSet`（状态）/
// `Disclosure`（交互 + a11y，§16.2.4.13/.17/.39）/ `TreeChildren`（缩进 + 引导线）。默认全部展开；展开集合是本组件自己的交互状态。

import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { Disclosure } from "~/components/ui/disclosure";
import { useExpansionSet } from "~/components/ui/expansion-set";
import { TreeChildren } from "~/components/ui/tree-rows";

import { contractModeTree } from "../mode-contract-config";

export function ModeContractModeNav({
  activeMode,
  storedCustomized,
  unsavedMode = null,
  onSelect,
}: {
  /** 当前选中的模式码（null = 未选）。 */
  activeMode: string | null;
  /** 选一个模式。 */
  onSelect: (mode: string) => void;
  /** 注册表里已被用户改过的模式（标「已改」）。 */
  storedCustomized: (mode: string) => boolean;
  /** 有未保存草稿的模式码（null = 没有；ISSUE #3762：左栏标「未保存」）。 */
  unsavedMode?: string | null;
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
    <div aria-label="选择要配置的模式" className="mb-3" role="radiogroup">
      {groups.map((group) => {
        const open = categoryExpansion.isExpanded(group.category);
        return (
          <Disclosure
            className="hover:text-ink mb-3 gap-1 px-2 text-sm font-semibold"
            key={group.category}
            marker="caret"
            onOpenChange={() => {
              categoryExpansion.toggle(group.category);
            }}
            /* 受控：展开态就是**哪些类别折着**这份集合（§16.2.4.17）。
               交给基元的那部分只有「父行怎么折」——`aria-expanded` /
               `aria-controls` / 键盘 / `hidden="until-found"` 都在它里头。 */
            open={open}
            /* 折起来时那一摞走 `TreeChildren`（缩进档 + 引导线一处给全，
               §16.2.4.39）；`data-category` 是给用例锚「哪一类」的记号。 */
            panelClassName="mb-3"
            trigger={
              <span className="text-ink min-w-0 flex-1 truncate" data-category={group.category}>
                {group.label}
              </span>
            }
          >
            <TreeChildren className="flex flex-col gap-0.5" depth={1}>
              {group.modes.map((t) => {
                const active = activeMode === t.code;
                const customized = storedCustomized(t.code);
                const unsaved = unsavedMode === t.code;
                return (
                  <Button
                    aria-checked={active}
                    className={cn(
                      "h-auto w-full justify-start gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium",
                      active
                        ? "bg-primary-soft text-primary-strong hover:bg-primary-soft hover:text-primary-strong"
                        : "text-ink-muted hover:text-ink",
                    )}
                    /* `data-mode` 是给用例锚「这一行是哪条模式」的记号（按可访问名
                       找会随文案变，code 才是身份）。 */
                    data-mode={t.code}
                    key={t.code}
                    onClick={() => {
                      onSelect(t.code);
                    }}
                    role="radio"
                    variant="ghost"
                  >
                    <span className="min-w-0 flex-1 truncate text-left">{t.label}</span>
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
                    {/* 未保存（ISSUE #3762）：草稿相对生效值有改动、还没落盘。
                        与「已改」（相对项目默认）是两件事，各自表达。 */}
                    {unsaved && (
                      <span className="text-warning-strong text-2xs shrink-0">未保存</span>
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
