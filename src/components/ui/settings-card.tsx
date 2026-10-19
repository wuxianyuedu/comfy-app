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
 * `Card` 组合、对外只暴露 `{title, description, children, className}`**——
 * 一处收口，视图调用点保持 `<SettingsCard title="…">…</SettingsCard>`。
 *
 * **与 `ui/card.tsx` 的关系**：本件是**薄封装**（`§12.18 复用优先 ·
 * 缺的差异用参数或薄封装补`），不是**平行实现**——底色 / 圆角 / 边框 /
 * padding / 深浅两态全部来自 shadcn `Card` 与 `--color-card` / `--color-border`
 * 语义 token；本件只补三件事：
 *   · 一个**必填的字符串标题**（`Card` 本体没有 title prop，标题走
 *     `CardHeader + CardTitle`，本件把这一层结构固定下来）；
 *   · 一处**外观微调**（`rounded-2xl` + `shadow-sm shadow-black/5`），保留
 *     设置页现有视觉密度。这两条都是**中性 tailwind utility、不含颜色**，
 *     不会与 shadcn 主题色冲突；此前的 `dark:bg-…/60` 与
 *     `dark:shadow-none dark:shadow-black/2` 是「手写 dark: 覆盖语义
 *     token」——违反 shadcn `styling.md` 原则 4，随本批删除（token 自身
 *     已含浅/深两态）。
 *   · **`backdrop-blur` 本来也在这三条里，已随 ISSUE #2031 撤掉**：模糊要
 *     「下面是活的、会动的东西」才有意义，设置页卡片坐在不透明的页面底上，
 *     它 **0 像素效果**，却把该卡与祖先链上的每一份内容都拖进一个
 *     backdrop-filter 图层（合成与绘制成本是真的）。扁平规范据此不让容器类
 *     表面带模糊，见规范 03 §3.13。
 *
 * ## 标题行现在收在同一支上（`title` 之下的那一行由本件给）
 *
 * 设置页此前每个分区卡片都把标题写成 `text-base`（16px）而正文是 `text-sm`
 * （14px）—— 相差 2px，于是「标题」看上去只是「稍大一点的正文」，一屏里读不出
 * 层级。标题改走 `text-sm` + `font-semibold`（`.u-title` 那一档，规范 03 §3.10
 * 「卡片/区块标题」），层级改由**字重 + 标题下的分隔线**承担：卡片标题不再是
 * 「更大的字」，而是「一段的起点」。
 *
 * `description` 是**可选的**一行副说明，落在标题之下、正文之上（对齐
 * `ui/page-header` 的口径：只写「答案在别处拿不到的那句话」，与标题同义反复
 * 就不传 —— 不传就不渲染那一行，卡片立刻矮下来）。
 */
export function SettingsCard({
  title,
  description,
  children,
  className,
}: {
  title: string;
  /** 可选副说明：写「答案在别处拿不到的那句话」，同义反复就不传。 */
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <ShadcnCard
      className={cn(
        "border-border-subtle bg-surface-1 text-ink rounded-2xl border py-0 shadow-sm shadow-black/5",
        className,
      )}
    >
      {/* 标题行自带下边距与分隔线：把「这一段从哪开始」画出来，而不是靠字号
          差距（16px vs 14px 的差距在同一屏里读不出来）。 */}
      <CardHeader className="border-border-subtle border-b py-3">
        <CardTitle className="u-title">{title}</CardTitle>
        {description ? (
          <p className="text-ink-muted text-xs">{description}</p>
        ) : null}
      </CardHeader>
      <CardContent className="py-4">{children}</CardContent>
    </ShadcnCard>
  );
}
