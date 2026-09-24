// @vitest-environment jsdom
/**
 * `SheetContent` 必须套一层 `SheetPrimitive.Portal`（`sheet.tsx` 曾经漏掉）：
 * Base UI 的 `Dialog.Popup` 不像 Radix 那样允许省略 Portal —— 缺了会直接抛
 * `Base UI: <Dialog.Portal> is missing.`，把整棵组件树打崩（面板连同右上角
 * 关闭按钮一起消失）。且只在**打开面板**时炸：关闭时 Portal 不渲染子节点。
 * 这里把抽屉打开渲染一遍，确认内容与关闭按钮都正常出现、不再抛错。
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "./sheet";

beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {
        void 0;
      },
      removeListener() {
        void 0;
      },
      addEventListener() {
        void 0;
      },
      removeEventListener() {
        void 0;
      },
      dispatchEvent() {
        return false;
      },
    });
  }
});

afterEach(cleanup);

describe("SheetContent 必须有 Dialog.Portal 祖先", () => {
  it("打开抽屉时渲染内容与关闭按钮，不抛 'Dialog.Portal is missing' 错", () => {
    render(
      <Sheet open onOpenChange={vi.fn()}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>画布设置</SheetTitle>
          </SheetHeader>
          面板内容
        </SheetContent>
      </Sheet>,
    );

    // 关键判据：Base UI Dialog 各部件能在 Portal 祖先下正常渲染（不抛 Portal 缺失错）。
    expect(screen.getByText("画布设置")).toBeInTheDocument();
    expect(screen.getByText("面板内容")).toBeInTheDocument();
    // 内置关闭按钮随之出现 —— 「面板可见但右上角关闭按钮消失」的回归即在此。
    expect(screen.getByText("Close")).toBeInTheDocument();
  });
});
