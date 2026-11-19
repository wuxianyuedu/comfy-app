"use client";

/**
 * useEnterCommit —— 「在输入框里按 Enter 提交 / Esc 取消」的唯一实现（规范 16 §16.2.4.29）。
 * 收口前 11 处各判键：6 处写了 Enter preventDefault、5 处没写 → 表单隐式 submit；Esc 后 4 处不复位草稿。另两类更差：不判 IME（拼音未上屏被当发送）、`role="button"` 自己补 Enter/Space（应改用真按钮，§16.2.4.2）。
 * 形态取「返回 onKeyDown 属性包」而非 hook（同 mediaDragSourceProps），内部 handler 放 ref，传新闭包不重建。
 */

/** `onCommit` / `onCancel` 拿到的键事件（够表达「让这个框失焦」这类动作）。 */
export type EnterCommitEvent = {
  currentTarget: { blur: () => void };
};

export type EnterCommitOptions = {
  /**
   * 是否要求「不带 Shift 才提交」。默认 `true` ——
   * 带 Shift 的 Enter 是换行（多行输入框的通行约定）；
   * 单行输入框上它没有别的含义，但保持同一口径比按控件类型分叉简单。
   */
  excludeShift?: boolean;
  /**
   * 是否忽略「正在用输入法组字」时的 Enter。默认 `true`。
   * 判据是 `event.nativeEvent.isComposing`（合成事件透在 nativeEvent 上）；`keyCode === 229` 是旧宿主的等价信号，一并判。
   */
  ignoreIme?: boolean;
  /**
   * 按下 Esc 时调用。**给了它才注册 Esc** —— 不给就是「只提交不取消」的
   * 单键输入（如「输入框 + 添加按钮」这类，取消靠按钮）。
   */
  onCancel?: () => void;
  /** 按下 Enter（无 Shift）时调用。收到的是那个键事件 ——
   *  需要 `currentTarget.blur()`（把落盘交给 `onBlur`）时用得到。 */
  onCommit: (event: EnterCommitEvent) => void;
};

/** `onKeyDown` 事件的**最小形状**（React 的 `KeyboardEvent<HTMLInputElement>`
 *  结构上满足它 —— 只读这四个字段，所以用例可以手造事件）。 */
export type EnterCommitKeyEvent = {
  currentTarget: EnterCommitEvent["currentTarget"];
  key: string;
  nativeEvent: { isComposing?: boolean; keyCode?: number };
  preventDefault: () => void;
  shiftKey: boolean;
};

/** `onKeyDown` 属性的最小形状。 */
export type EnterCommitHandlers = {
  onKeyDown: (event: EnterCommitKeyEvent) => void;
};

/** Enter 提交 / Esc 取消的键位判据（纯函数，便于单测与复用）。 */
export function isCommitKey(
  event: Pick<EnterCommitKeyEvent, "key" | "shiftKey" | "nativeEvent">,
  {
    ignoreIme = true,
    excludeShift = true,
  }: Pick<EnterCommitOptions, "ignoreIme" | "excludeShift"> = {},
): boolean {
  if (event.key !== "Enter") {
    return false;
  }
  if (excludeShift && event.shiftKey) {
    return false;
  }
  if (ignoreIme) {
    /* 组字中（IME 候选词未上屏）：Enter 是「确认候选」，不是提交。
     * 历史上有 6 处没判它 —— 中文输入法下会把半截拼音发出去。 */
    if (event.nativeEvent.isComposing === true) {
      return false;
    }
    if (event.nativeEvent.keyCode === 229) {
      return false;
    }
  }
  return true;
}

/**
 * 造出「Enter 提交 / Esc 取消」的 `onKeyDown` 属性包（与 `mediaDragSourceProps` 同款，属性包里只有 `onKeyDown`）。
 * 用法：`{...enterCommit({ onCommit, onCancel })}` 摆在 `onChange` 之后。⚠️ 别写成 JSDoc 里的 ` ```tsx ` 代码块：内插 `/* … *\/` 会提前闭合外层注释（`ui/wide-panel` 踩过）。
 * `onCommit` 收到键事件：「Enter = 失焦、落盘交给 onBlur」写 `({ currentTarget }) => currentTarget.blur()`，不必为 `ref` 破坏 `react-hooks/refs`。
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
