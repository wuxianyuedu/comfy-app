"use client";

// 「服务状态行」的样式判据与按钮原语（服务 = 本机常驻后端：ComfyUI / Drizzle
// Studio / Ollama）。纯样式与结构，不含业务。
//
// 为什么单独成模块：这几条状态行同构 —— 都是「左侧状态文字 + 右侧一排按钮」，
// 且**跨屏**（设置页三段 + 侧栏「ComfyUI」页那段）。窄窗口下这排按钮的文字会
// 换行、按钮因此长高、圆角消失，一行里几个按钮高低不齐（ISSUE #423 截图里
// 的「打开查看」「在浏览器打开」正是折成两行的形态）。
//
// 变形不是某一个按钮的问题，而是三件事叠在一起：flex 默认可收缩
// （`flex-shrink: 1`）+ 按钮文字可换行（`white-space: normal`）+ 左侧状态
// 文字不设下限。可用宽度一紧张，flex 就从每个按钮身上按比例抠宽度，抠到
// 文字改行去适应 —— 这正是规范 §3.8.1「一排控件不许被压扁」禁止的形态。
//
// 退化的顺序（宽度不足时按此顺序让位，绝不压扁控件）：
//   ① 左侧状态文字截断（它本来就是可变长的描述，有省略号语义）
//   ② 整排按钮换到第二行（根容器 `flex-wrap`）
//   —— 按钮自身只收内边距，不折行、不被压缩。
//
// 判据集中在这里，视图只消费返回值；测试直接断言字符串，不需要渲染。
//
// 住在 `ui/` 而不是设置页目录：ISSUE #1900 把 ComfyUI 那段搬到侧栏单独一页之后，
// 它就同时被设置页与那一页消费 —— 留在任一侧都会让另一侧反向依赖某个屏的目录。

import { Button } from "~/components/ui/button";

/**
 * 状态行根容器：`flex-wrap` 是最后的兜底——窗口窄到按钮排不下时，把按钮
 * 整排换到第二行，而不是把按钮压成竖排断字。`items-center` 让两行内容各自
 * 在行内垂直居中，而不是被拉伸成等高。
 */
export const STATUS_ROW_CLASS = "flex flex-wrap items-center gap-x-3 gap-y-2";

/**
 * 状态行左侧的状态文字：可被压缩，但压缩的是**这块**、不是按钮。
 *
 * `min-w-0` 是必要的：没有它，flex 项的最小宽度按 min-content 算，长文案
 * （如 `ComfyUI 运行中（http://127.0.0.1:8188）·配置路径的实例`）会把整行
 * 顶宽、按钮组永远等不到换行。`flex-1 basis-40` 给它一个「贴着实测宽度」
 * 的基准宽度，够宽时仍能完整读完，窄了才截断。
 */
export const STATUS_TEXT_CLASS = "min-w-0 flex-1 basis-40 truncate text-sm";

/** 按钮组：整体不许被压扁（内层按钮各自也带 `shrink-0`）。 */
export const STATUS_ACTIONS_CLASS =
  "flex shrink-0 flex-wrap items-center gap-2";

/**
 * 按钮**任何状态下都必须带上**的类：不许换行、不许被 flex 压扁。
 *
 *   - `whitespace-nowrap`：文字是一整块。缺了它，`在浏览器打开` 会被拆成
 *     「在浏览器打 / 开」两行，按钮高度随之翻倍——ISSUE #423 报的正是这个。
 *   - `shrink-0`：按钮是可点目标，不该被压缩。要挤，挤左侧那截可截断的状态
 *     文字。缺了它，同一排按钮还会被抠出不同宽度、高低不齐。
 *   - `leading-none`：图标（lucide）的行框比中文字号高，默认行高会把按钮顶高。
 */
export const STATUS_BUTTON_BASE = "shrink-0 whitespace-nowrap leading-none";

/**
 * 拼一个状态行按钮的完整 class 串。
 *
 * @param extra 该按钮自己的补充类（如 `ml-auto`、配色覆盖）
 */
export function statusButtonClass(extra = ""): string {
  return [
    STATUS_BUTTON_BASE,
    "rounded-lg px-4 py-2 text-sm font-semibold transition-colors",
    extra,
  ]
    .filter(Boolean)
    .map((part) => part.trim())
    .join(" ");
}

/**
 * 状态行动作按钮（**不是**「状态行主按钮」）—— `ui/button` 的基元 + 本页的
 * 排布契约（ISSUE #672 P1）。
 *
 * 这里此前是第二个 `<button>` 实现（自拼尺寸类 + 自拼配色）。现在底子是
 * `ui/button`：配色由 `variant` 决定，本模块只负责把状态行的**排布契约**
 *（`statusButtonClass`：不许换行 / 不许被 flex 压扁 / 行框归位，见 ISSUE #423）
 * 叠上去。
 *
 * 三条覆盖类与工作流编辑器顶栏同一口径（规范 §16.2.4.2 第 3、4 条）：
 *   · `h-auto px-4 py-2` —— 高度与横向内边距归还给调用处（基元 `h-8 px-2.5`）；
 *   · `font-semibold`     —— 状态行动作的权重比基元默认高一档；
 *   · `rounded-lg`        —— 与状态行外框同一档圆角。
 * `cn()` 走 tailwind-merge，同一属性后面的类赢，因此覆盖串必须排在最后。
 *
 * ## 缺省档从 `primary-solid` 改成 `primary`（软底）
 *
 * 这几条状态行（ComfyUI / Drizzle Studio / Ollama）**各有三个动作**：打开 /
 * 启动 / 关闭。缺省实心时三个都是同一颗品牌紫实心按钮，一屏里没有主次：
 * 用户看不出「该点哪个」，而在「未运行」时那两个本就点不动的（打开 / 关闭）也
 * 长着可点的样子 —— 实心档置灰只是 50% 不透明度，仍是饱和紫，读起来像「可点但
 * 是浅一点」，而不是「现在不能点」。
 *
 * 改成软底之后三件事一起成立：① 真正的动作（启动 / 关闭）仍由调用处显式传
 * `primary-solid` 提为实心，一屏里只剩一颗实心；② 不构成动作的那些（打开 /
 * 在浏览器打开）走软底或 `outline`，层级立刻分得开；③ 置灰的软底按钮是「淡底淡
 * 字」，与可点状态一眼可分。**缺省值必须是「不需要强调的那一档」** —— 缺省
 * 实心会让每个新加的动作都自动变成主按钮，而「哪个是主要动作」是调用处的判断。
 */
export function StatusButton({
  onClick,
  disabled,
  children,
  className,
  variant = "primary",
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
}) {
  return (
    <Button
      variant={variant}
      onClick={onClick}
      disabled={disabled}
      className={statusButtonClass(
        `h-auto rounded-lg px-4 py-2 font-semibold ${className ?? ""}`,
      )}
    >
      {children}
    </Button>
  );
}
