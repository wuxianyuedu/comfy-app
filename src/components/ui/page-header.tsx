import type { ReactNode } from "react";
import { CircleHelp } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Hint } from "~/components/ui/hint";
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
 * ## 页签已经在说屏名时，`h1` 那一行是重复的（ISSUE #1693）
 *
 * 「一屏一名」收掉的是**两个不同的名字**，没收掉**同一个名字出现两次**：页签写着
 * 「队列」、屏内 `h1` 也写着「队列」，读者什么都没多知道，标题区却实打实吃掉了
 * 一整行（`.u-title-page` 是 1.5rem 档）+ 一行副说明。
 *
 * 所以 `title` 是**可选**的：这一屏的屏名已经由页签（或顶栏）给出时，**不传** ——
 * 此时页头只渲染右侧动作组那一行，屏名不再出现第二遍。判据是「读者需不需要再读
 * 一次屏名」：页签名一直在视野里（页签条常驻）就不需要；工作区型屏自己没有页签条、
 * 顶栏也不一定显示屏名时，那一次仍然要由 `h1` 给出。
 *
 * `description` 同理收成可按需折叠的一行：它写的那句（时间口径 / 数据来源）**不是
 * 每次看屏都要读**，用 `help` 把它挂成一枚悬浮「说明」按钮后，标题区不占那一行，
 * 想知道的人悬停即得。`description` / `help` 二选一：前者常在（信息本来就该一直
 * 可见），后者收起（偶尔才需要），**不要同时传**（同一句话在一屏里说两遍正是本条
 * 要治的病）。
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
  /**
   * 屏级可见标题 —— 走 `.u-title-page`。**每屏至多一个**。
   *
   * 页签（或顶栏）已经在说屏名时**不传**：那一次出现是重复的（ISSUE #1693）。
   * 不传时这一行不再占位，只留右侧的动作组 / 说明按钮。
   *
   * ⚠️ 不传**不等于这一屏没有 `h1`**：屏名会以 `sr-only` 保留在 DOM 里
   * （读屏按标题跳转的前提，规范 06）。真要彻底没有标题的场景不存在 ——
   * 每一屏都该有一个可跳转的名字。
   */
  title?: ReactNode;
  /**
   * 省略 `title` 时仍要写进 DOM（`sr-only`）的屏名。
   *
   * 给「页签在视线里、标题看不见」的屏用：名字仍要能被读屏与 `h1` 判据
   * 找到，只是不占视觉空间。页签名的唯一出处仍是 `pageHeaderTitle(view)`
   * —— 调用点照传同一个出口，别在这里另写一份字面量。
   */
  srTitle?: ReactNode;
  /**
   * 一行副说明：写「答案在别处拿不到的那句话」（时间口径 / 数据来源 / 能做什么）。
   * **同义反复的话不要写** —— 不传就不渲染这一行。
   *
   * 与 `help` 二选一：这句话**每次看屏都要读**才放这里；偶尔才需要读的用 `help`。
   */
  description?: ReactNode;
  /**
   * 把同一句话挂成一枚悬浮「说明」按钮（不占标题区那一行）。
   *
   * 用于「读者偶尔才想知道」的解释 —— 常驻显示会白占一行、还挤压下方内容
   * （ISSUE #1693 的原话是「说明的直接显示也去掉，也占空间，可用弄个说明按钮，
   * 悬浮显示详细说明」）。走 `ui/hint` 的全库唯一出口，不用原生 `title=`。
   *
   * 传了 `description` 时以 `description` 为准（常驻优先），二者取一即可。
   */
  help?: ReactNode;
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
  help,
  actions,
  as: Heading = "h1",
  srTitle,
  extra,
  titleSuffix,
  className,
}: PageHeaderProps) {
  /* `description` 常驻优先：两者传同一个值时不该在屏上出现两遍（正文那条口径）。 */
  const helpText = description ? undefined : help;
  /* 省略可见标题时，屏名退到 `sr-only` —— 视觉上不再占那一行，但读屏仍能按标题
     跳转、`h1` 也还在（ISSUE #1693 要的是「别占空间」，不是「没有标题」）。 */
  const hiddenTitle = title === undefined ? srTitle : undefined;
  /* 左侧那一列整块缺席：可见标题与它的补充件都没有，此时页头收成一行（只留
     动作组）—— 页签已经在说屏名的那批屏就是这一档。
     ⚠️ `helpText` **不算**这一列的成员：没有可见标题时它并到右侧动作组去
     （孤零零贴在最左边会与页签、动作组各隔一大片空白），算进来就会渲染出一个
     只有一颗图标按钮、其余全空的壳。 */
  const hasTitleBlock =
    title !== undefined ||
    titleSuffix !== undefined ||
    extra !== undefined ||
    (title !== undefined && helpText !== undefined);

  return (
    <header
      data-component="page-header"
      className={cn(
        "flex flex-wrap items-center justify-between gap-3",
        className,
      )}
    >
      {hiddenTitle !== undefined ? (
        <Heading className="sr-only">{hiddenTitle}</Heading>
      ) : null}
      {hasTitleBlock ? (
        /* `min-w-0` 是给长标题留的截断位（规范 03 §3.8.1 的兜底顺序：先收标题、
           再换行，不压右侧按钮组）。 */
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            {title !== undefined ? (
              <Heading className="font-title u-title-page min-w-0 truncate">
                {title}
              </Heading>
            ) : null}
            {titleSuffix ? (
              <span className="text-ink-fainter shrink-0 text-xs">
                {titleSuffix}
              </span>
            ) : null}
            {/* 有可见标题时说明钮跟在标题右侧（读者在「这一屏叫什么」的地方
                顺路看见「还有一句解释」）。没有标题时它并进右侧动作组 —— 见下，
                否则它会孤零零贴在页头最左边、与页签和动作组都隔着一大片空白。 */}
            {title !== undefined && helpText !== undefined ? (
              <HeaderHelp text={helpText} />
            ) : null}
          </div>
          {description ? (
            <p className="text-ink-muted mt-1 text-sm">{description}</p>
          ) : null}
          {extra}
        </div>
      ) : null}
      {actions !== undefined ||
      (helpText !== undefined && title === undefined) ? (
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {helpText !== undefined && title === undefined ? (
            <HeaderHelp text={helpText} />
          ) : null}
          {actions}
        </div>
      ) : null}
    </header>
  );
}

/**
 * 悬浮「说明」按钮 —— 把页头那句解释收起来，只在悬停 / 聚焦时展开。
 *
 * 图标按钮本身没有可见文字，所以它自带一个短名 `aria-label="说明"` —— 不把整句
 * 提示当可访问名（读屏念一长句不理想）。这一档**刻意不开** `Hint` 的
 * `accessibleName`：那个开关会把 `label` 写成子元素的 `aria-label`，正好把这里
 * 更精确的短名顶掉。
 */
function HeaderHelp({ text }: { text: ReactNode }) {
  return (
    <Hint side="bottom" label={text}>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="说明"
        className="text-ink-fainter hover:text-ink-bright shrink-0 rounded-full"
      >
        <CircleHelp aria-hidden className="size-5" />
      </Button>
    </Hint>
  );
}
