/**
 * 取当前选区（浏览器里是 `window.getSelection()`）。
 *
 * 抽成函数是为了让贴底 effect 能「取不到就说没有」：jsdom 没有
 * `getSelection`，返回 null 后 `selectionInsideLogs` 会给出 false，
 * 贴底行为与既有测试一致，不会因为多了一道判据而整体失效。
 */
export function currentSelection() {
  if (typeof window === "undefined") return null;
  if (typeof window.getSelection !== "function") return null;
  return window.getSelection();
}
