/**
 * keyboard —— 「键盘上那个键叫什么」的**唯一出口**（规范 16 §16.2.4.57）。
 *
 * 为什么收口：`event.key` 的字面量在全库有 **三套写法**，而它们**都对也都不对**：
 *
 *  - `" "`（空格）—— 与 `event.key` 逐字相等，但 UI 上这个键显示成
 *    `Space`，读代码的人要在脑子里做一次映射，且**没人能一眼确认它对不对**；
 *  - `"Tab"` / `"Enter"` / `"Escape"` —— W3C 的 DOM 键盘事件规范键名，
 *    也是本仓库的既定口径（`useHotkey` / `enterCommit` 早就这么写）；
 *  - 手写比较还漏了**大小写**这一课（§16.2.4.29 踩实过）：无修饰单键的
 *    `event.key` 是**带 Shift 的大写字符**（`Shift+Space` 给 `" "`、
 *    `Shift+a` 给 `"A"`）—— 直接拿调用处手写的字符串去比，等于碰运气。
 *
 * 本模块只做一件事：**给出可比对的键名**。它不监听事件、不记录修饰键组合
 * （那是 `~/components/ui/use-hotkey` 的事），也不判 IME（那是
 * `~/components/ui/use-enter-commit` 的事）—— 只把那件事里「这个键叫什么」
 * 的一半拿出来，让两个落点共用同一个判据。
 */

/** 本仓库用到的具名键（`event.key` 的 W3C 口径字面量）。 */
export const KEY = {
  Enter: "Enter",
  Escape: "Escape",
  Tab: "Tab",
  Space: "Space",
  ArrowUp: "ArrowUp",
  ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
} as const;

/** 具名键的字面量类型。 */
export type KeyName = (typeof KEY)[keyof typeof KEY];

/**
 * 把「一个键的名字」归一成**只用于比较**的形态。
 *
 * 规则（三条，都可单测）：
 *  1. **空格归一**：`"Space"` 与 `" "` 是同一个键的两种叫法 → `"space"`；
 *  2. **小写归一**：`"Enter"` / `"ENTER"` / 带 Shift 的 `"A"` → 小写 ——
 *     这是唯一能同时容纳「具名键」与「单字符键」的判据；
 *  3. **单字符保留原形**（只做小写）：`" "` 这类字符不 `trim()`
 *     （`trim()` 会把它变成空串，再与「空 key」撞在一起）。
 *
 * ⚠️ **只用于比较，不要拿它去显示** —— 展示给用户的键名走 `KEY` 的具名值。
 */
export function normalizeKeyName(key: string): string {
  /* 单字符（含空格本身）走字符分支：`trim()` 在这里是错的。 */
  if (key.length === 1) return key === " " ? "space" : key.toLowerCase();
  const trimmed = key.trim();
  if (trimmed === "") return "space";
  return trimmed.toLowerCase();
}

/** `event.key` 是不是这几个键之一（比较用归一形态，见 `normalizeKeyName`）。 */
export function isKeyIn(key: string, keys: readonly string[]): boolean {
  const normalized = normalizeKeyName(key);
  for (const candidate of keys) {
    if (normalizeKeyName(candidate) === normalized) return true;
  }
  return false;
}
