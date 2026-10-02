/**
 * 全屏视图层（full-screen layer）的样式判据。
 *
 * 为什么独立成模块：一件「全屏视图该铺到哪儿」的样式是「删掉 JSX 还能跑的
 * 判据」，按规范 17 §17.2 归第①层（配置 / 纯派生），可脱离 React 单测；
 * 视图层只消费返回值。
 *
 * 背景（ISSUE #310 回归）：页签搬到窗口标题行后，应用内的「全屏视图」
 * （设置、工作流编辑器、脚本编辑器、消息中心…）仍按 `fixed inset-0` 铺满
 * 整个视口，把标题行里的页签整条盖住——用户打开这些视图后**再也看不到、
 * 也切不回其它页签**，只能先关掉当前视图。
 *
 * 约束：标题行是应用级 chrome，任何视图都不应该盖掉它。全屏视图的
 * 「全屏」应理解为「铺满标题行下方的内容区」，而不是「铺满整个窗口」。
 * 因此统一用 `top-title-bar right-0 bottom-0 left-0` 让出标题行，
 * 而不是 `inset-0`。
 */

import { clamp } from "~/lib/clamp";
import { zClass } from "~/lib/shell/overlay-z";

/**
 * 标题行（页签栏）高度对应的 CSS 变量名；定义在 `globals.css` 的 `@theme`。
 *
 * 为什么带 `--spacing-` 前缀：tailwind v4 按命名空间决定能生成哪些工具类，
 * 自定义名（如 `--title-bar-height`）不会生成任何间距类；只有
 * `--spacing-<name>` 才会产出 `top-<name>` / `h-<name>` / `p-<name>`。
 */
export const TITLE_BAR_HEIGHT_VAR = "--spacing-title-bar";

/** 标题行（页签栏）高度的工具类名：`top-title-bar` = `top: var(--spacing-title-bar)`。 */
export const TITLE_BAR_TOP_CLASS = "top-title-bar";

/** 标题行高度工具类：`h-title-bar`，TitleBarTabs 用（浏览器形态无应用内页签栏）。 */
export const TITLE_BAR_HEIGHT_CLASS = "h-title-bar";

/**
 * 标题行作为**应用级 chrome** 的层级 class（`relative z-chrome`）。
 *
 * 为什么让位之外还必须给层级（ISSUE #310 第三次回归）：几何让位只管「不被盖住、
 * 不被压暗」，**不管可点**。第三方浮层不受本仓库的让位规则约束 —— base-ui 的
 * Dialog 在 modal 打开时往 body 注入 `InternalBackdrop`
 * （`position: fixed; inset: 0; z-index: auto; pointer-events: auto` 的
 * `div[data-base-ui-inert]`），它铺满整个视口（含标题行），于是设置页「启动日志」
 * 全屏后页签与右上角窗口按钮**整排点不动**。标题行是流内元素（`z-index: auto`），
 * 后出现在 DOM 里的定位元素必然在命中测试里压过它。
 *
 * 修法：抬到刻度表的最高档 `chrome`（规范 16 §16.2.5，严格高于 `toast`）。
 * `relative` 不能省 —— `z-index` 对 `position: static` 的元素不生效（flex item
 * 是特例，但依赖「父容器恰好是 flex」会让层级在布局重构后静默失效）。
 */
export const TITLE_BAR_CHROME_CLASS = `relative ${zClass("chrome")}`;

/** 标题行的高度值（`2.25rem` = 36px），供测试与派生计算引用。 */
export const TITLE_BAR_HEIGHT_REM = "2.25rem";

/**
 * 全屏视图层的定位 class：让出标题行，铺满其下方的内容区。
 *
 * 用四边定位而不是 `inset-x-0 top-title-bar`：后者依赖 `bottom` 默认 `auto`
 * 而靠内容高度撑开，全屏视图恰恰要「被拉伸到内容区高度」，必须显式 `bottom-0`。
 */
export const FULL_SCREEN_LAYER_CLASS = `fixed ${TITLE_BAR_TOP_CLASS} right-0 bottom-0 left-0`;

/**
 * 底部状态栏（`BrowserStatusBar`）的让位 class：`bottom-6` = 状态栏的 24px（`h-6`）。
 *
 * 与标题行同理，状态栏也是「固定悬浮在窗口边上」的应用级 chrome（`fixed
 * bottom-0 h-6 z-toast`，z-toast = 1000 高于全屏视图的 z-100）：铺到 `bottom-0`
 * 的浮层最后 24px 会被它压住 —— 启动日志全屏视图的实测反馈是「日志最下方
 * 几行被状态栏盖住，看不到最后的内容」。
 */
export const STATUS_BAR_CLEARANCE_CLASS = "bottom-6";

/**
 * 铺满标题行下方内容区、底边让出状态栏的全屏层定位。
 *
 * 与 `FULL_SCREEN_LAYER_CLASS` 的分工：后者铺到 `bottom-0`，供「整块内容区
 * 都是它」且不与状态栏争底边的视图；`ui/fullscreen-dialog` 这类盖在主页面
 * 之上、而状态栏恒在主页面底部的浮层用本常量，避免最后 24px 被压住。
 * 仍是四边显式锚定：依赖内容撑高会让「铺满」退化成「随内容长」。
 */
export const FULL_SCREEN_LAYER_ABOVE_STATUS_BAR_CLASS = `fixed ${TITLE_BAR_TOP_CLASS} right-0 ${STATUS_BAR_CLEARANCE_CLASS} left-0`;

/**
 * 拼出全屏视图层的完整 class 串（定位 + z-index + 视图自身布局）。
 *
 * @param zClass  z-index 工具类，取自浮层刻度表（规范 16 §16.2.5）：
 *                 全屏视图走 `${zClass("modal")}`，调试类视图可再用 `Z.base`
 * @param extra   该视图自身的布局 class（`flex flex-col` / `bg-bg` 等）
 */
export function fullScreenLayerClass(zClass: string, extra = ""): string {
  const parts = [FULL_SCREEN_LAYER_CLASS, zClass.trim(), extra.trim()];
  return parts.filter(Boolean).join(" ");
}

/* ── 标题行让位（title-bar clearance）────────────────────────────────
 * 与「全屏视图」的区别：全屏视图铺满**整块内容区**，必须让位；
 * 而「模态弹窗 / dismiss 遮罩 / 抽屉」只是浮在内容区之上的一层，
 * 只要顶部不让掉标题行，就既不挡页签、也不挡右上角的窗口按钮。
 *
 * 与全屏视图同源的失效模式：这两类浮层此前都写作 `fixed inset-0`
 * ，于是打开后页签与窗口按钮整条被盖住（ISSUE #310 的同一处回归，
 * 第一次只改了全屏视图，弹窗类漏改）。本模块把「顶部必须让位」变成
 * 可被门禁拦下来的机器判据，避免再靠人肉逐个文件翻。
 */

/** 需要让出标题行的浮层形态。 */
export type OverlayKind = "full" | "modal";

/** 各形态对应的定位工具类：全屏铺满内容区，模态浮在其上仍需让位顶部。 */
export const OVERLAY_POSITION_CLASS: Record<OverlayKind, string> = {
  full: FULL_SCREEN_LAYER_CLASS,
  modal: `fixed ${TITLE_BAR_TOP_CLASS} inset-x-0 bottom-0`,
};

/**
 * 拼出浮层的定位 class 串（位置 + 形态自身的布局 class）。
 *
 * @param kind  浮层形态（`full` 全屏视图 / `modal` 模态弹窗、抽屉、遮罩）
 * @param extra 该浮层自身的布局 class（`flex items-center` / `bg-black/60`）
 */
export function overlayClass(kind: OverlayKind, extra = ""): string {
  const parts = [OVERLAY_POSITION_CLASS[kind], extra.trim()];
  return parts.filter(Boolean).join(" ");
}

/** 让位前的写法：铺满整个视口，必然盖掉标题行里的页签与窗口按钮。 */
export const TITLE_BAR_BLOCKING_CLASS = "fixed inset-0";

/**
 * 顶层浮层的判定：`fixed inset-0` 开头的 class 串。
 *
 * 「顶层」= 只有定位（`fixed`）与铺满（`inset-0`）两类声明、其后接的仍是
 * class 单词（z-index / flex / 颜色…），不含 `absolute` / `relative` 等
 * 局部定位，也不含 `size-*` / `w-*` 这类「另给尺寸」的写法。
 *
 * 为什么要把「固定元素 = 顶层浮层」划在 `src/components/**`、`src/app/**`：
 * 底层 app shell 的 fixed 元素（如状态栏 `bottom-0`）不在选择器内；
 * 非 fixed 的 `inset-0` 只铺自己的定位祖先，不受标题行约束。
 *
 * @param className 组件上的完整 class 串（模板串请传拼好的结果）
 */
export function blocksTitleBar(className: string): boolean {
  const normalized = className.replace(/\s+/g, " ").trim();
  if (!normalized.startsWith(TITLE_BAR_BLOCKING_CLASS)) return false;
  const rest = normalized.slice(TITLE_BAR_BLOCKING_CLASS.length);
  return rest === "" || rest.startsWith(" ");
}

/* ── 锚定浮层的视口边界（anchored overlay boundary）──────────────────
 * 与前两类的区别，把三种浮层的**让位方式**摆在一起看：
 *
 *   · 全屏视图（`full`）：铺满内容区 → 用 `top-title-bar` **几何让位**；
 *   · 模态弹窗（`modal`）：浮在内容区之上 → 同样用 `top-title-bar` 让位；
 *   · **锚定浮层（气泡 / 下拉 / 气泡卡）**：位置由**锚点**决定，写不出固定的
 *     `top-*`。它的让位只能表达成「参与定位计算的那块可用区域不要把标题行算进来」。
 *
 * 前两类漏了会被 `check-title-bar-clearance.cjs` 拦下（它数 `fixed inset-0`），
 * 锚定浮层**不在它的射程里** —— 这正是气泡被标题行吃掉半截的成因：
 *
 *   Base UI 的 `flip` 只对**视口**判溢出。TopBar 那排按钮落在 y≈46，气泡往上
 *   摆（`side="top"`）时顶部落在 y≈14，**视口内绰绰有余**，于是它不翻转；
 *   而标题行占 0~36、层级 `z-chrome`(2000) 比气泡的 `z-popup`(100) 高一个数量级，
 *   于是气泡上半截被标题行**盖掉**（不是被裁 —— 是画在了它下面）。实测 TopBar
 *   上四个入口（全局搜索 / 深浅色 / 系统消息 / 应用菜单）**无一幸免**。
 *
 * 修法不是抬气泡的层级：标题行是应用级 chrome，气泡盖过它等于盖住页签与窗口
 * 按钮的可点区域（§16.2.5 判据 4）。正确做法是把「可用区域」告诉定位引擎 ——
 * 它据此翻转，气泡改从下方展开，既不越界也不与 chrome 争层级。 */

/** 视口矩形（`getBoundingClientRect` 的坐标系，原点在视口左上角）。 */
export interface ViewportRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 算出锚定浮层可用的**碰撞边界** —— 有标题行时把顶上那条让出去，否则就是整个视口。
 *
 * 返回的是 Floating UI 的 `collisionBoundary` 收的形状（`{x, y, width, height}`，
 * 视口坐标系）。传 `null` 表示「还不知道视口多大」（首帧 / SSR）—— 调用处据此
 * **不传**这一档，退回基元默认的 `clipping-ancestors`，而不是拿一个假矩形去摆位
 * （`~/components/ui/use-viewport-size` 首帧为 `null` 是同一个口径）。
 *
 * @param viewport     当前视口尺寸
 * @param titleBarPx   标题行高度；**非壳态传 0**（浏览器 / dev 没有应用内标题行，
 *                     见 `ShellTabs` 的 `shouldUseTitleBarTabs`）
 */
export function anchoredOverlayBoundary(
  viewport: { width: number; height: number } | null,
  titleBarPx: number,
): ViewportRect | null {
  if (!viewport || viewport.width <= 0 || viewport.height <= 0) return null;
  /* 让位量不得超出视口本身：极端窄高（比标题行还矮的窗口）下宁可退化成整视口，
   * 也不要给出负高度 —— 负高度的边界会让定位引擎算出一串无意义的偏移。 */
  const top = clamp(titleBarPx, 0, viewport.height);
  return { x: 0, y: top, width: viewport.width, height: viewport.height - top };
}

/**
 * 标题行的高度（px）。
 *
 * 读的是 **`TITLE_BAR_HEIGHT_REM`**（`2.25rem`）而不是再写一个字面量：它就是
 * `globals.css` 里 `--spacing-title-bar` 的那档值，两处漂移由
 * `full-screen-layer.test.ts` 反向核对。
 *
 * @param remPx 根字号（默认 16 —— 布局档位都按 16 设计，见 `~/lib/layout-budget`
 *              的 `REM_PX`）；由调用处注入而不在这里读 `getComputedStyle`：
 *              本模块是纯派生，不碰 DOM 才测得动。
 */
export function titleBarHeightPx(remPx = 16): number {
  return Number.parseFloat(TITLE_BAR_HEIGHT_REM) * remPx;
}
