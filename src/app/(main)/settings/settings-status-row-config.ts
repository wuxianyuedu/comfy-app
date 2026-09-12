// 设置页「服务状态行」的样式判据（规范 17 §17.2 第①层：常量 + 纯派生，无 React）。
//
// 为什么单独成模块：设置页有三条同构的状态行（ComfyUI / Drizzle Studio /
// Ollama），都是「左侧状态文字 + 右侧一排按钮」。窄窗口下这排按钮的文字会
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
