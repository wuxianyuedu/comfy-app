/** ToastProvider 的 context value 引用稳定性（#5224 A4）：四个便捷方法各自
 *  useCallback，value 不在每次 provider 重渲时换引用 —— 否则每个 toast 消费者
 *  都被连带重渲。钉的是引用身份，不是 toast 的展示文案。 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/components/ui/icon", () => ({ Icon: () => null }));

import { ToastProvider, useToast } from "./ToastProvider";

afterEach(cleanup);

const seen: Array<ReturnType<typeof useToast>> = [];
let bump: () => void = vi.fn();

function Consumer() {
  seen.push(useToast());
  return <span data-testid="consumer">ok</span>;
}

function Wrapper() {
  const [, setTick] = useState(0);
  bump = () => {
    setTick((t) => t + 1);
  };
  return (
    <ToastProvider>
      <Consumer />
    </ToastProvider>
  );
}

describe("ToastProvider", () => {
  it("provider 重渲不改变 context value 与四个便捷方法的引用", () => {
    seen.length = 0;
    const { rerender } = render(<Wrapper />);
    act(() => {
      bump();
    });
    rerender(<Wrapper />);
    expect(screen.getByTestId("consumer")).toBeTruthy();
    expect(seen.length).toBeGreaterThanOrEqual(2);

    const first = seen[0]!;
    for (const value of seen.slice(1)) {
      expect(value).toBe(first);
      expect(value.success).toBe(first.success);
      expect(value.error).toBe(first.error);
      expect(value.info).toBe(first.info);
      expect(value.loading).toBe(first.loading);
      expect(value.toast).toBe(first.toast);
      expect(value.update).toBe(first.update);
      expect(value.dismiss).toBe(first.dismiss);
    }
  });
});
