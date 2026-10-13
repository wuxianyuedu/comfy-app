"use client";

// ── 「模式契约」的模式选择导航：**一棵竖向的树**（规范 17 §17.2 第③层）──────
// 父行 = 输出类别（图像 / 视频 / 音频，弱一档、不可点），子行 = 模式（可点、
// 当前模式标 `aria-current`）。缩进与引导线由 `~/components/ui/tree-rows` 一次
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
// 本组件不持有契约状态：值从 props 来、动作往上抛（与编辑器其余部分同一条分层）。

import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
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
  return (
    /* 一排模式里只有一个能选中 —— 单选语义（`role="radiogroup"` / `radio`），
       与「模型适配」的模型清单同一条契约。 */
    <div role="radiogroup" aria-label="选择要配置的模式" className="mb-3">
      {contractModeTree().map((group) => (
        <div key={group.category} className="mb-3 last:mb-0">
          <p aria-hidden className="text-ink-fainter px-2 text-xs font-medium">
            {group.label}
          </p>
          {/* 子行集合走 `TreeChildren`：缩进档 + 引导线一处给全（§16.2.4.39）。 */}
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
        </div>
      ))}
    </div>
  );
}
