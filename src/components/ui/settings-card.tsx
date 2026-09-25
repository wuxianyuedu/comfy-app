"use client";

import { cn } from "~/lib/utils";
import {
  Card as ShadcnCard,
  CardContent,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";

/**
 * SettingsCard —— 设置页各段落使用的「有标题的卡片」的唯一出口。
 *
 * **为什么单独立一件、不用裸 shadcn `<Card>`**：设置页 11 段落都需要同一件
 * 事——「一段带标题的独立内容块」——如果每处都手写 `<Card><CardHeader>
 * <CardTitle>…</CardTitle></CardHeader><CardContent>…</CardContent></Card>`
 * 会重复 11 遍；如果沿用此前 `app/(main)/settings/components/SettingsPrimitives.tsx`
 * 里的自绘 `<section>` + `<h2>`（且带两处 `dark:` 手写覆盖），又等于把 shadcn
 * `ui/card.tsx` 装了不用。本件是这两条之间的中间形态：**内部走官方
 * `Card` 组合、对外只暴露 `{title, children, className}` 三个 prop**——
 * 一处收口，视图调用点保持 `<SettingsCard title="…">…</SettingsCard>`。
 *
 * **与 `ui/card.tsx` 的关系**：本件是**薄封装**（`§12.18 复用优先 ·
 * 缺的差异用参数或薄封装补`），不是**平行实现**——底色 / 圆角 / 边框 /
 * padding / 深浅两态全部来自 shadcn `Card` 与 `--color-card` / `--color-border`
 * 语义 token；本件只补两件事：
 *   · 一个**必填的字符串标题**（`Card` 本体没有 title prop，标题走
 *     `CardHeader + CardTitle`，本件把这一层结构固定下来）；
 *   · 一处**外观微调**（`rounded-2xl` + `shadow-sm shadow-black/5` +
 *     `backdrop-blur`），保留设置页现有视觉密度。这三条都是**中性 tailwind
 *     utility、不含颜色**，不会与 shadcn 主题色冲突；此前的 `dark:bg-…/60`
 *     与 `dark:shadow-none dark:shadow-black/2` 是「手写 dark: 覆盖语义
 *     token」——违反 shadcn `styling.md` 原则 4，随本批删除（token 自身
 *     已含浅/深两态，透明度差由 backdrop-blur 吸收）。
 */
export function SettingsCard({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <ShadcnCard
      className={cn(
        "border-border-subtle bg-surface-1 text-ink rounded-2xl border shadow-sm shadow-black/5 backdrop-blur",
        className,
      )}
    >
      <CardHeader>
        <CardTitle className="text-ink text-base font-semibold">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </ShadcnCard>
  );
}
