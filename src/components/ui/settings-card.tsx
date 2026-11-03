"use client";

import { cn } from "~/lib/utils";
import { Card as ShadcnCard, CardContent, CardHeader, CardTitle } from "~/components/ui/card";

/** SettingsCard —— 设置页各段落使用的「有标题的卡片」的唯一出口。
 * 为什么单独立一件、不用裸 shadcn `<Card>`：设置页 11 段落都需要同一件事 ——「一段带标题的独立内容块」—— 每处手写 `<Card><CardHeader><CardTitle>…` 会重复 11 遍；沿用此前 `SettingsPrimitives.tsx` 的自绘 `<section>` + `<h2>`（且带两处 `dark:` 手写覆盖）又等于把装好的 `ui/card.tsx` 放着不用。本件是两者的中间形态：内部走官方 `Card` 组合、对外只暴露 `{title, description, children, className}`，一处收口，视图调用点保持 `<SettingsCard title="…">…</SettingsCard>`。
 * 与 `ui/card.tsx` 的关系：本件是薄封装（§12.18 复用优先 · 缺的差异用参数或薄封装补），不是平行实现 —— 底色 / 圆角 / 边框 / padding / 深浅两态全部来自 shadcn `Card` 与 `--color-card` / `--color-border` 语义 token；本件只补三件事：一个必填的字符串标题（`Card` 本体没有 title prop，标题走 `CardHeader + CardTitle`，本件把这一层结构固定下来）；一处外观微调（`rounded-2xl` + `shadow-sm shadow-black/5`）保留设置页现有视觉密度（两条都是中性 utility、不含颜色，不与主题色冲突；此前的 `dark:bg-…/60` 与 `dark:shadow-none dark:shadow-black/2` 是「手写 dark: 覆盖语义 token」—— 违反 shadcn `styling.md` 原则 4，随本批删除，token 自身已含浅/深两态）；`backdrop-blur` 本来也在这三条里、已随 ISSUE #2031 撤掉（模糊要「下面是活的、会动的东西」才有意义，设置页卡片坐在不透明的页面底上、0 像素效果，却把该卡与祖先链上的每一份内容都拖进一个 backdrop-filter 图层，扁平规范据此不让容器类表面带模糊，见规范 03 §3.13）。
 * 标题行现在收在同一支上（`title` 之下的那一行由本件给）：此前每个分区卡片都把标题写成 `text-base`(16px) 而正文是 `text-sm`(14px) —— 相差 2px，「标题」看上去只是「稍大一点的正文」，一屏里读不出层级。标题改走 `text-sm` + `font-semibold`（`.u-title` 那一档，规范 03 §3.10「卡片/区块标题」），层级改由字重 + 标题下的分隔线承担：卡片标题不再是「更大的字」，而是「一段的起点」。
 * `description` 是可选的一行副说明，落在标题之下、正文之上（对齐 `ui/page-header` 的口径：只写「答案在别处拿不到的那句话」，与标题同义反复就不传 —— 不传就不渲染那一行，卡片立刻矮下来）。 */
export function SettingsCard({
  title,
  description,
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
  /** 可选副说明：写「答案在别处拿不到的那句话」，同义反复就不传。 */
  description?: React.ReactNode;
  title: string;
}) {
  const hasDescription = Boolean(description);
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
        {hasDescription ? <p className="text-ink-muted text-xs">{description}</p> : null}
      </CardHeader>
      <CardContent className="py-4">{children}</CardContent>
    </ShadcnCard>
  );
}
