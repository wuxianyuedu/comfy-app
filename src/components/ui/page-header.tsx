import type { ReactNode } from "react";

import { HeaderHelp } from "~/components/ui/header-help";
import { Hint } from "~/components/ui/hint";
import { cn } from "~/lib/utils";

/** PageHeader —— 屏级页头（全库唯一实现，规范 16 §16.2.4.73）。三件事一处说清，因为此前在 11 个屏上各拼一遍、还越拼越不一致：
 * ① 每屏唯一的 `h1` 走 `.u-title-page` 字阶档（规范 03 §3.10；原先由 P83 在提交阶段守着，收口顺带抹平 `font-title` 那处漂移）；② 一行副说明走已定档的 `.text-sm text-ink-muted`（§3.10 末尾「新增一个屏时」写死这两个类）；③ 右侧动作组不被压扁 —— 动作组 `shrink-0`、可截断标题 `min-w-0`（§3.8.1 三条硬规则：宽度不够时该换行或收标题，不该把按钮挤成两行小字）。
 * `description` 不是「关于本屏叫什么」的补充，而是「本屏的时间口径 / 数据来源 / 能做什么」—— 答案在别处拿不到的那句话。写「管理你的模型」「这里可以查看历史记录」这类同义反复等于把标题又写长一遍，此时传 `undefined`：不传就不渲染那一行。ISSUE #1423 的极端形态是侧栏「队列」→ 页签「队列」→ 页头「队列与运行」，一屏两个名字、标题区吃掉大片纵向空间。「标题该叫哪个名字」的判据不在本件，在 `NavItems.tsx` 注册表（侧栏项 / 页签 / 顶栏标题 / `viewTabLabel()` 同出处），分叉没有可发生的地方。
 * 页签已经在说屏名时（ISSUE #1693）`title` 是可选的、不传：只渲染右侧动作组那一行，屏名不出现第二遍；判据是「读者需不需要再读一次屏名」—— 页签名一直在视野里（页签条常驻）就不需要，工作区型屏没有页签条、顶栏也不一定显示屏名时仍要由 `h1` 给出。`description` 同理收成可按需折叠的一行：用 `help` 挂成悬浮「说明」按钮后标题区不占那一行，`description` / `help` 二选一（常驻 vs 偶尔需要），不要同时传。
 * 什么时候不要用：整条工具条形态的页头（`WorkshopHeader` / `FilmStudioTopBar` / `WorkflowLibraryHeader` / `WorkflowEditorTopbar` —— 标题与工具栏同处一横杆、四周带边框内距，塞进 `justify-between` 反而要逐个覆写）；工作区型屏（`WorkspaceFrame` 一族自管内部滚动、页头形态由各自顶栏承担，本件与 `DocumentFrame` 调用面重合但不做强绑定，三处传 `as` 的落点 `<h1>` / `<h2>` / `<p>` 就为此留的）；「页头就是标题」（`ProjectHomePage` / `ProjectOutputs` 用项目名当标题，标题是数据不是屏名，但字阶档与副说明仍该走这里）。 */

export type PageHeaderProps = {
  /** 右侧动作组（按钮 / 筛选）。整组不收缩。 */
  actions?: ReactNode;
  /**
   * 标题的标签名。默认 `h1`（屏级）。
   * 传 `h2` / `p` 用于「标题行嵌在更大结构里」或「标题本身是数据」的落点 ——
   * 那时用 `h1` 会与它所在屏的屏级 `h1` 撞成两个（一屏一 `h1` 是读屏跳转的前提）。
   */
  as?: "h1" | "h2" | "p";
  className?: string;
  /** 一行副说明：写「答案在别处拿不到的那句话」（时间口径 / 数据来源 / 能做什么）；同义反复的话不要写 —— 不传就不渲染这一行。与 `help` 二选一：这句每次看屏都要读才放这里，偶尔才需要读的用 `help`。 */
  description?: ReactNode;
  /**
   * 标题行下面再挂一层（如一行进度条、一枚徽标）。它落在副说明之下、动作区之上。
   * 只有真需要「页头里还有一行结构」时才传 —— 普通的补充信息归 `description`。
   */
  extra?: ReactNode;
  /** 把同一句话挂成一枚悬浮「说明」按钮（不占标题区那一行）。
   * 用于「读者偶尔才想知道」的解释 —— 常驻显示会白占一行、还挤压下方内容（ISSUE #1693 原话：「说明的直接显示也去掉，也占空间，可用弄个说明按钮，悬浮显示详细说明」）。走 `ui/header-help` 的全库唯一出口，不用原生 `title=`。
   * 传了 `description` 时以 `description` 为准（常驻优先），二者取一即可。
   * ⚠️ 挂在 `AppShell` 里的屏（workspace 各视图）不在这里传：那句说明由 `TopBar` 在视图标题右侧承载（`viewHelp()` 注册表，全库唯一出处）—— 屏内页头再放一颗就是同一句解释在一屏里出现两遍。只有没有顶栏的落点（如 `/models` 独立路由页）才走这个 prop。 */
  help?: ReactNode;
  /** 省略 `title` 时仍要写进 DOM（`sr-only`）的屏名。
   * 给「页签在视线里、标题看不见」的屏用：名字仍要能被读屏与 `h1` 判据找到，只是不占视觉空间。页签名的唯一出处仍是 `pageHeaderTitle(view)` —— 调用点照传同一个出口，别在这里另写一份字面量。 */
  srTitle?: ReactNode;
  /** 屏级可见标题 —— 走 `.u-title-page`。每屏至多一个。
   * 页签（或顶栏）已经在说屏名时不传：那一次出现是重复的（ISSUE #1693）。不传时这一行不再占位，只留右侧的动作组 / 说明按钮。
   * ⚠️ 不传不等于这一屏没有 `h1`：屏名会以 `sr-only` 保留在 DOM 里（读屏按标题跳转的前提，规范 06）。真要彻底没有标题的场景不存在 —— 每一屏都该有一个可跳转的名字。 */
  title?: ReactNode;
  /**
   * 标题的补充文本（lucide / 副标题 / 数据名），渲染在标题右侧、同一基线。
   * 用于 `FilmStudioTopBar` 那类「项目名 + · 视图名」的组合。
   */
  titleSuffix?: ReactNode;
};

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
  const hasDescription = Boolean(description);
  const helpText = hasDescription ? undefined : help;
  const hasTitleSuffix = Boolean(titleSuffix);
  /* 省略可见标题时，屏名退到 `sr-only` —— 视觉上不再占那一行，但读屏仍能按标题
     跳转、`h1` 也还在（ISSUE #1693 要的是「别占空间」，不是「没有标题」）。 */
  const hiddenTitle = title === undefined ? srTitle : undefined;
  /* 左侧那一列整块缺席：可见标题与它的补充件都没有，此时页头收成一行（只留
     动作组）—— 页签已经在说屏名的那批屏就是这一档。
     ⚠️ `helpText` **不算**这一列的成员：没有可见标题时它并到右侧动作组去
     （孤零零贴在最左边会与页签、动作组各隔一大片空白），算进来就会渲染出一个
     只有一颗图标按钮、其余全空的壳。 */
  const hasTitleBlock = title !== undefined || titleSuffix !== undefined || extra !== undefined;

  return (
    <header
      className={cn("flex flex-wrap items-center justify-between gap-3", className)}
      data-component="page-header"
    >
      {hiddenTitle === undefined ? null : <Heading className="sr-only">{hiddenTitle}</Heading>}
      {hasTitleBlock ? (
        /* `min-w-0` 是给长标题留的截断位（规范 03 §3.8.1 的兜底顺序：先收标题、
           再换行，不压右侧按钮组）。 */
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            {title === undefined ? null : (
              <Hint label={title}>
                <Heading className="font-title u-title-page min-w-0 truncate">{title}</Heading>
              </Hint>
            )}
            {hasTitleSuffix ? (
              <span className="text-ink-fainter shrink-0 text-xs">{titleSuffix}</span>
            ) : null}
            {/* 有可见标题时说明钮跟在标题右侧（读者在「这一屏叫什么」的地方
                顺路看见「还有一句解释」）。没有标题时它并进右侧动作组 —— 见下，
                否则它会孤零零贴在页头最左边、与页签和动作组都隔着一大片空白。 */}
            {title !== undefined && helpText !== undefined ? <HeaderHelp text={helpText} /> : null}
          </div>
          {hasDescription ? <p className="text-ink-muted mt-1 text-sm">{description}</p> : null}
          {extra}
        </div>
      ) : null}
      {actions !== undefined || (helpText !== undefined && title === undefined) ? (
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {helpText !== undefined && title === undefined ? <HeaderHelp text={helpText} /> : null}
          {actions}
        </div>
      ) : null}
    </header>
  );
}
