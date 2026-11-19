/**
 * 取当前选区（`window.getSelection()`）。
 * 抽成函数是为了「取不到就说没有」：jsdom 无 `getSelection`，返回 null 时
 * `selectionInsideLogs` 给 false，贴底行为与既有测试一致。
 */
export function currentSelection() {
  if (typeof window === "undefined") {
    return null;
  }
  if (typeof window.getSelection !== "function") {
    return null;
  }
  return window.getSelection();
}
