/**
 * 居中模态卡片的**宽度档**（规范 17 §17.2 第①层：常量 + 纯派生，无 React、无 DOM）：档位带 `w-*` 而不是 `max-w-*`。
 * 原因（ISSUE #720）：`DialogContent` 自带 `max-w-[calc(100%-2rem)]`，与调用处的 `max-w-[96vw]` 同族，谁赢由 Tailwind 输出顺序决定 —— Chromium 1430×900 实测加宽态宽度**一个字都没变**；宽度族与上限族不同族，直接给结论，`max-w-*` 只在视口更窄时兜底。
 * 加宽档取 `calc(100vw-16px)`：语义是**贴视线两边的「看全」档**，只让出 8px 让卡片不贴边（旧的 `96vw` 在 1500px 级窗口下还行，窗口一大就被摊薄）。
 */

/** 居中卡片的宽度档：默认档由调用处按内容密度给，加宽档统一。 */
export type ModalWidth = {
  /** 默认档（弹窗刚打开时）。 */
  base: string;
  /** 加宽档（标题栏的「加宽」按钮）。 */
  wide: string;
};

/** 加宽档对每个调用处都一样：贴满内容区，只留 8px。 */
export const MODAL_WIDE_WIDTH = "w-[calc(100vw-16px)]";

/** 按默认档拼出宽度档。调用处只决定「默认多宽」——内容密度由它决定
 *  （应用日志四列、执行日志三列，天然不同），加宽档是同一件事。 */
export function modalWidth(base: string): ModalWidth {
  return { base, wide: MODAL_WIDE_WIDTH };
}
