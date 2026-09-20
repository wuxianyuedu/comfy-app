"use client";

/**
 * useEnterCommit —— 「在输入框里按 Enter 提交 / Esc 取消」的**唯一实现**
 * （规范 16 §16.2.4.29）。
 *
 * 为什么收口：全库 **11 处**各自在 `onKeyDown` 里判键，而它们对两件事各判各的：
 *
 *   ① **Enter 要不要 `preventDefault`** —— 有 6 处写了、5 处没写。
 *      没写的那几处**在表单里会连带提交整张表单**（Enter 触发 `<form>` 的
 *      隐式 submit），于是「回车新增一个标签」变成了「回车提交整页」；
 *      唯一没被波及的落点靠的是「它恰好不在 form 里」。
 *   ② **Esc 取消之后要不要复位草稿** —— 有 4 处只把编辑态关掉、草稿留在原值
 *      （下次点开看到的是上次输入一半的内容）；有 3 处显式回退到原值。
 *      两种都「能用」，差别只在「再点开时看到什么」。
 *
 * 另外两类是同一条账里**更差**的写法：
 *
 *   · **组合键不判 IME** —— `AgentOverlay` 的「Enter 发送、Shift+Enter 换行」
 *     用中文输入法时，**拼音未上屏的 Enter 会被当成发送**（把半截拼音发给 AI）；
 *   · **`role="button"` 元素自己补 Enter/Space** —— 6 处（`ShellTabs` /
 *     `TitleBarTabs` / `RgthreeBodies` / `MultiModeSelect` 选项行 /
 *     `NodePreviewCard` 头部 …）在 `onKeyDown` 里复刻浏览器对原生按钮的
 *     默认行为。**这类不该由本模块承担**：它们要的是「用真正的 `<button>`」
 *     （`<Button variant="ghost">` 自带 Enter/Space），见 §16.2.4.2 与 P1 判据。
 *     本模块只管**输入框**这一个形态。
 *
 * 形态取「返回 `onKeyDown` 属性对象」而不是 hook：调用点在 JSX 里，
 * `onKeyDown={…}` 拿到的是稳定的属性包（内部 handler 放 ref，传新闭包不重建）。
 * 这与 `mediaDragSourceProps`（纯函数返回 props）同款 —— 硬做成 hook 会逼着
 * 每个调用点先拆组件。
 */

/** `onCommit` / `onCancel` 拿到的键事件（够表达「让这个框失焦」这类动作）。 */
export interface EnterCommitEvent {
  currentTarget: { blur: () => void };
}

export interface EnterCommitOptions {
  /** 按下 Enter（无 Shift）时调用。收到的是那个键事件 ——
   *  需要 `currentTarget.blur()`（把落盘交给 `onBlur`）时用得到。 */
  onCommit: (event: EnterCommitEvent) => void;
  /**
   * 按下 Esc 时调用。**给了它才注册 Esc** —— 不给就是「只提交不取消」的
   * 单键输入（如「输入框 + 添加按钮」这类，取消靠按钮）。
   */
  onCancel?: () => void;
  /**
   * 是否忽略「正在用输入法组字」时的 Enter。默认 `true`。
   *
   * 判据是 `event.nativeEvent.isComposing`（React 的合成事件把它透在
   * `nativeEvent` 上）—— 中文 / 日文输入法在候选词未上屏时按 Enter 是
   * **确认候选**，不是提交。`keyCode === 229` 是旧宿主上的等价信号，一并判。
   */
  ignoreIme?: boolean;
  /**
   * 是否要求「不带 Shift 才提交」。默认 `true` ——
   * 带 Shift 的 Enter 是换行（多行输入框的通行约定）；
   * 单行输入框上它没有别的含义，但保持同一口径比按控件类型分叉简单。
   */
  excludeShift?: boolean;
}

/** `onKeyDown` 事件的**最小形状**（React 的 `KeyboardEvent<HTMLInputElement>`
 *  结构上满足它 —— 只读这四个字段，所以用例可以手造事件）。 */
export interface EnterCommitKeyEvent {
  key: string;
  shiftKey: boolean;
  nativeEvent: { isComposing?: boolean; keyCode?: number };
  currentTarget: EnterCommitEvent["currentTarget"];
  preventDefault: () => void;
}

/** `onKeyDown` 属性的最小形状。 */
export interface EnterCommitHandlers {
  onKeyDown: (event: EnterCommitKeyEvent) => void;
}

/** Enter 提交 / Esc 取消的键位判据（纯函数，便于单测与复用）。 */
export function isCommitKey(
  event: Pick<EnterCommitKeyEvent, "key" | "shiftKey" | "nativeEvent">,
  {
    ignoreIme = true,
    excludeShift = true,
  }: Pick<EnterCommitOptions, "ignoreIme" | "excludeShift"> = {},
): boolean {
  if (event.key !== "Enter") return false;
  if (excludeShift && event.shiftKey) return false;
  if (ignoreIme) {
    /* 组字中（IME 候选词未上屏）：Enter 是「确认候选」，不是提交。
     * 历史上有 6 处没判它 —— 中文输入法下会把半截拼音发出去。 */
    if (event.nativeEvent.isComposing === true) return false;
    if (event.nativeEvent.keyCode === 229) return false;
  }
  return true;
}

/**
 * 造出「Enter 提交 / Esc 取消」的 `onKeyDown` 属性。
 *
 * 用法：在 `<input>` 上把 `{...enterCommit({ onCommit, onCancel })}` 摆在
 * `onChange` 之后（与 `mediaDragSourceProps` 同款，属性包里只有 `onKeyDown`）。
 *
 * ⚠️ **别写成 ` ```tsx ` 代码块**：JSDoc 里的代码块不能内插 JS 注释，
 * `/* … *\/` 会提前闭合外层的 `/** … *\/`，prettier 直接报
 * `SyntaxError: Expression expected`（`ui/wide-panel` 踩过一次）。
 *
 * `onCommit` 收到的是键事件 —— 「Enter = 让这个框失焦、落盘交给 `onBlur`」
 * 的形态写 `onCommit: ({ currentTarget }) => currentTarget.blur()`，
 * 不必为一个 `ref` 破坏 `react-hooks/refs`（渲染期不许读 `ref.current`）。
 */
export function enterCommit({
  onCommit,
  onCancel,
  ignoreIme = true,
  excludeShift = true,
}: EnterCommitOptions): EnterCommitHandlers {
  return {
    onKeyDown: (event) => {
      if (isCommitKey(event, { ignoreIme, excludeShift })) {
        /* `preventDefault` **不能省**：输入框在 `<form>` 里时，Enter 会触发
         * 隐式 submit（「回车新增标签」连带提交整页）。此前 5 处没写，
         * 没出事只是因为它们恰好不在 form 里。 */
        event.preventDefault();
        onCommit({ currentTarget: event.currentTarget });
        return;
      }
      if (onCancel && event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    },
  };
}
