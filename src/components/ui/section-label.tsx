import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

/** SectionLabel —— 段级小标题（全库唯一实现，规范 03 §3.10 的三档对照）。
 * 它是「区块小标题 + 同行 hint」这一行的唯一出处：层级由字重与留白承担、不靠字号堆，所以标题走 `text-sm`(14px) `font-semibold`，右侧 hint 是它的补充口径、走 `text-xs`(12px)。
 * 为什么要收这一件：「模式契约」与「模型适配」两屏各抄了一份同样的实现（`mb-2 flex flex-wrap items-baseline gap-x-2` + `h4.text-ink.text-sm.font-semibold` + `span.text-muted-foreground.text-xs`），同一个角色在两屏里各是一个形状 —— 改一处不会跟手。抽成这一件之后，`tests/design-md-contract-sync.test.ts` 的 `FAMILIES` 拿这串标记守「只许有一个出处」。
 * hint 是「记号」之外的哪一档：hint 写的是整句中文说明（这一区在配什么），落 12px。若写的是机器 id / 计数这类记号，那属于更低的一档（`text-2xs` 11px / `text-3xs` 10px，见规范 03 §3.10 的三档对照），不要塞进这个 `hint` —— 它是「说明」不是「记号」，两者混档正是这一批要治的漂移。 */
export type SectionLabelProps = {
  children: ReactNode;
  className?: string;
  /** 标题右侧的补充口径（整句中文说明，落 12px）。不传就不渲染。 */
  hint?: ReactNode;
};

export function SectionLabel({ children, hint, className }: SectionLabelProps) {
  return (
    <div
      className={cn("mb-2 flex flex-wrap items-baseline gap-x-2", className)}
      data-slot="section-label"
    >
      <h4 className="text-ink text-sm font-semibold">{children}</h4>
      {Boolean(hint) && <span className="text-muted-foreground text-xs">{hint}</span>}
    </div>
  );
}
