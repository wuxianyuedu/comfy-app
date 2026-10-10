import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

/**
 * PageHeader —— 屏级页头（**全库唯一实现**，规范 16 §16.2.4.73）。
 *
 * 三件事一处说清，因为它们此前在 11 个屏上各拼一遍、还越拼越不一致：
 *
 *   1. **每屏唯一的 `h1` 走 `.u-title-page` 字阶档**（规范 03 §3.10）。这一条
 *      原本就由 P83 在提交阶段守着，所以此前各屏的 `h1` 是齐的（差异只在有没有
 *      `font-title`）—— 收口顺带把那一处漂移抹平。
 *   2. **一行副说明走已定档的那一句**（`.text-sm text-ink-muted`，规范 03 §3.10
 *      末尾「新增一个屏时」那一段写死了这两个类）。此前同样是每处各写一遍。
 *   3. **右侧动作组不被压扁**：`shrink-0` 在动作组上、可截断的标题带 `min-w-0`
 *      （规范 03 §3.8.1 的三条硬规则 —— 宽度不够时该换行或收标题，不该把按钮
 *      挤成两行小字）。
 *
 * ## 副标题与「第二套名字」是两件事，别混
 *
 * 收口这一层时踩到过一个真实的形态（ISSUE #1423 的原始反馈）：`队列` 侧栏项 →
 * 页签写「队列」→ 页头 `h1` 写「队列与运行」→ 副标题再解释一遍怎么轮转。同一件事在
 * 一屏里出现两个名字，标题区吃掉大片纵向空间，读者却什么都没多知道。
 *
 * 所以 `description` **不是「关于本屏叫什么」的补充说明**，而是「本屏的时间口径 /
 * 数据来源 / 能做什么」——即**答案在别处拿不到的那句话**。写「管理你的模型」
 * 「这里可以查看历史记录」这类同义反复等于把标题又写长了一遍，此时**传 `undefined`**：
 * 不传就不渲染那一行，标题区立刻矮下来。
 *
 * 「标题该叫哪个名字」的判据不在这里，在 `NavItems.tsx` 那份注册表 —— 侧栏项、
 * 页签、顶栏标题都从它反查，页头文案也只是它的一个消费者（`viewTabLabel()` 同一个
 * 出处）。这样「队列 / 队列与运行」这类分叉就没有可发生的地方。
 *
 * ## 什么时候**不要**用它
 *
 * - **整条工具条形态的页头**（`WorkshopHeader` / `FilmStudioTopBar` /
 *   `WorkflowLibraryHeader` / `WorkflowEditorTopbar`）：那几处的标题与工具栏同处
 *   一条横杆、四周带边框与内距，塞进这里的 `justify-between` 反而要逐个覆写。
 * - **工作区型屏**（`WorkspaceFrame` 那一族）：它们自己管内部滚动，页头形态由各自的
 *   顶栏承担。本组件与 `DocumentFrame` 的调用面重合，但**不做强绑定**（要保持独立
 *   可测）—— 三处传 `as` 的落点（`<h1>` / `<h2>` / `<p>`）就是为此留的。
 * - **页头就是标题**（`ProjectHomePage` / `ProjectOutputs` 用项目名当标题）：那种屏的
 *   「标题」是数据不是屏名，但字阶档与副说明这两件仍然该走这里。
 */

export interface PageHeaderProps {
  /** 屏级标题 —— 走 `.u-title-page`。每屏恰好一个。 */
  title: ReactNode;
  /**
   * 一行副说明：写「答案在别处拿不到的那句话」（时间口径 / 数据来源 / 能做什么）。
   * **同义反复的话不要写** —— 不传就不渲染这一行。
   */
  description?: ReactNode;
  /** 右侧动作组（按钮 / 筛选）。整组不收缩。 */
  actions?: ReactNode;
  /**
   * 标题的标签名。默认 `h1`（屏级）。
   * 传 `h2` / `p` 用于「标题行嵌在更大结构里」或「标题本身是数据」的落点 ——
   * 那时用 `h1` 会与它所在屏的屏级 `h1` 撞成两个（一屏一 `h1` 是读屏跳转的前提）。
   */
  as?: "h1" | "h2" | "p";
  /**
   * 标题行下面再挂一层（如一行进度条、一枚徽标）。它落在副说明之下、动作区之上。
   * 只有真需要「页头里还有一行结构」时才传 —— 普通的补充信息归 `description`。
   */
  extra?: ReactNode;
  /**
   * 标题的补充文本（lucide / 副标题 / 数据名），渲染在标题右侧、同一基线。
   * 用于 `FilmStudioTopBar` 那类「项目名 + · 视图名」的组合。
   */
  titleSuffix?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  actions,
  as: Heading = "h1",
  extra,
  titleSuffix,
  className,
}: PageHeaderProps) {
  return (
    <header
      data-component="page-header"
      className={cn(
        "flex flex-wrap items-center justify-between gap-3",
        className,
      )}
    >
      {/* `min-w-0` 是给长标题留的截断位（规范 03 §3.8.1 的兜底顺序：先收标题、
          再换行，不压右侧按钮组）。 */}
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <Heading className="font-title u-title-page min-w-0 truncate">
            {title}
          </Heading>
          {titleSuffix ? (
            <span className="text-ink-fainter shrink-0 text-xs">
              {titleSuffix}
            </span>
          ) : null}
        </div>
        {description ? (
          <p className="text-ink-muted mt-1 text-sm">{description}</p>
        ) : null}
        {extra}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}
