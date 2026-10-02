/**
 * 壳层宽度的这笔账（左轨什么时候该自动收成图标）—— 全库唯一出处。
 *
 * 为什么是一笔账而不是一个魔法数字：设计拍的是「窗口窄到装不下『导航 + 工坊三列 +
 * 内容区最低可看宽』时，先把宽度让给内容区」。这个阈值 = 各列实际宽度之和 + 内容
 * 区下限，任何一条列宽改了，阈值就得跟着改；写死 `1280` 而不留算式，等于把下一次
 * 改版的红留给别人。所以：
 *   · 数值在这里由**各列宽度算出来**，不散落字面量；
 *   · 与真实源码的一致性由 `layout-budget.test.ts` 的漂移断言钉住（它去读
 *     `ui/sidebar.tsx` / `globals.css` / `WorkshopPipeline.tsx` 里的真值反算一遍，
 *     对不上直接红）。
 *
 * 口径来源：高保真原型的壳层让位设计（交接文档 §3 末段）。原型那台的账是
 * 240/177/321/16 ⇒ 1174px；**仓库的列宽不同，所以阈值也不同** —— 照抄原型数字
 * 会得到一个与仓库布局不符的断点。
 */

/** rem → px 的基准（Tailwind 默认根字号）。
 *
 * 导出而不是留私有：标题行高度（`--spacing-title-bar`，同为 rem 档）也要按
 * 同一根字号换算，两处各写一个 16 会随根字号调整悄悄漂开。 */
export const REM_PX = 16;

/** 展开态导航宽（与 `ui/sidebar.tsx` 的 `--sidebar-width` 同源）。 */
export const NAV_WIDTH_EXPANDED_PX = 16 * REM_PX;
/** 收起态导航宽（图标轨，与 `--sidebar-width-icon` 同源）。 */
export const NAV_WIDTH_COLLAPSED_PX = 3 * REM_PX;

/** 工坊阶段轨道列宽（`globals.css` 的 `--spacing-stage-rail: 13rem`）。 */
export const STAGE_RAIL_WIDTH_PX = 13 * REM_PX;
/** 工坊本镜检查器列宽（`WorkshopPipeline.tsx` 的网格模板里那列 308px）。 */
export const INSPECTOR_WIDTH_PX = 308;
/** 工坊内容区左右内边距（`p-6` 两侧）。 */
export const WORKSHOP_PAGE_PADDING_PX = 24 * 2;
/** 工坊三列之间的列间距（`gap-5` × 2 道）。 */
export const WORKSHOP_COLUMN_GAP_PX = 20 * 2;
/**
 * 取景器（中间列）的最低可看宽度 —— 再窄就不是「看得清」而是「挤成一列」。
 * 这一条是设计下限，不是从某个 CSS 值反推的，所以它只在这里出现一次。
 */
export const WORKSPACE_MIN_PX = 420;

/**
 * 展开态下，最窄能完整摆下「导航 + 工坊三列 + 内容区下限」的窗口宽度。
 * 窄于此值 → 左轨自动收成图标（收起态的账在下面，用来核对收起确实换出了空间）。
 */
export const NAV_EXPANDED_MIN_PX =
  NAV_WIDTH_EXPANDED_PX +
  WORKSHOP_PAGE_PADDING_PX +
  STAGE_RAIL_WIDTH_PX +
  WORKSHOP_COLUMN_GAP_PX +
  INSPECTOR_WIDTH_PX +
  WORKSPACE_MIN_PX;

/** 自动收起生效的窗口宽度上限（`< NAV_EXPANDED_MIN_PX`，即 ≤ 此值）。 */
export const NAV_AUTO_COLLAPSE_MAX_PX = NAV_EXPANDED_MIN_PX - 1;

/**
 * 媒体查询串。判据只写这一处：组件里再出现 `max-width: …px` 字面量就是第二份事实
 * （硬规则 20 的同类口径）。
 */
export const NAV_AUTO_COLLAPSE_QUERY = `(max-width: ${NAV_AUTO_COLLAPSE_MAX_PX}px)`;

/** 收起确实换出了多少宽度 —— 漂移断言用它反证这笔账的方向没写反。 */
export const NAV_COLLAPSE_SAVED_PX =
  NAV_WIDTH_EXPANDED_PX - NAV_WIDTH_COLLAPSED_PX;

/**
 * 收起态与内容区下限能不能同时成立（收起后中间列仍 ≥ 下限）。
 *
 * 为什么把它写成断言而不是「显然成立」：如果哪天有人把内容区下限调到比可分配宽度
 * 还大，自动收起就变成「收了也没用」的无意义抖动，而屏面只表现为一直拥挤。
 */
export const NAV_COLLAPSE_LEAVES_VIEWPORT_PX =
  NAV_AUTO_COLLAPSE_MAX_PX -
  NAV_WIDTH_COLLAPSED_PX -
  WORKSHOP_PAGE_PADDING_PX -
  STAGE_RAIL_WIDTH_PX -
  WORKSHOP_COLUMN_GAP_PX -
  INSPECTOR_WIDTH_PX;

/**
 * 一次显式表态：用户点开关那一刻的目标状态，以及**当时的跨越次数**。
 * 跨越次数不等，就说明这条表态是「上一档窗宽」留下的，已经过期。
 */
export type RailChoice = { open: boolean; atCrossing: number };

/**
 * 谁说了算，三档优先：
 *   1. **本次会话在当前这一档窗宽下表过态**（点过开关）→ 听用户的；
 *   2. 否则窄窗 → 纪律接管，收起；
 *   3. 否则 → 用户存下来的偏好（cookie 读出的 `defaultOpen`）。
 *
 * 为什么用「跨越次数」而不是「表态时是否窄窗」来判断过期：后者挡不住来回拖窗口 ——
 * 用户在窄窗点开后放大、再缩回来，两次的「窄窗」标记相同，那次豁免就会永久否决纪律。
 * 而窗口每跨越一次阈值，次数就变一次，语义正好是「再次跨越 → 纪律重新接管」。
 * 这让生效态是**纯推导**的，不需要在 effect 里清标记（本仓库 lint 判据
 * `react-hooks/set-state-in-effect` 不容那种写法）。
 *
 * `preferredOpen` 是跨会话存下来的那一档：它相当于「宽窗档的一次表态」，所以只在
 * 宽窗生效 —— 拿记忆去否决当次的窄窗让位，等于让偏好挡住布局纪律。
 */
export function resolveRailCollapsed(input: {
  narrow: boolean;
  crossings: number;
  choice: RailChoice | null;
  preferredOpen?: boolean;
}): boolean {
  const { narrow, crossings, choice, preferredOpen = true } = input;
  if (choice !== null && choice.atCrossing === crossings) {
    return !choice.open;
  }
  if (narrow) return true;
  return !preferredOpen;
}
