// @vitest-environment jsdom
/**
 * `CommandDialog` 必须套一层 `Command`（`command.tsx` 曾经漏掉）：`CommandInput`
 * / `CommandList` / `CommandItem` / `CommandGroup` / `CommandEmpty` 全从 `Command`
 * 的 context 取 store（cmdk 的 `useCmdk` 直接 `store.subscribe`），没有 `<Command>`
 * 祖先就 `Cannot read properties of undefined (reading 'subscribe')` —— 且只在
 * **打开面板**时炸（关闭时 base-ui `Dialog.Portal` 不渲染子节点）。这里把面板打开
 * 渲染一遍，确认不再抛错。
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./command";

beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    // jsdom 没有 ResizeObserver；cmdk 的列表高度观察 effect 需要它。
    class ResizeObserverStub {
      observe() {
        void 0;
      }
      unobserve() {
        void 0;
      }
      disconnect() {
        void 0;
      }
    }
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
      ResizeObserverStub;
  }
  // jsdom 没有 Element.prototype.scrollIntoView；cmdk 选中项会调用它。
  if (typeof Element.prototype.scrollIntoView !== "function") {
    Element.prototype.scrollIntoView = () => {
      void 0;
    };
  }
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

describe("CommandDialog 必须有 <Command> 祖先", () => {
  it("打开面板时渲染 cmdk 各部件不抛 'subscribe' 错", () => {
    render(
      <CommandDialog open onOpenChange={vi.fn()}>
        <CommandInput placeholder="搜索…" />
        <CommandList>
          <CommandEmpty>无结果</CommandEmpty>
          <CommandGroup heading="动作">
            <CommandItem onSelect={vi.fn()}>新建</CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>,
    );
    // 关键判据：cmdk 各部件能在 `<Command>` 祖先下正常渲染（不抛 store.subscribe 错）。
    expect(screen.getByPlaceholderText("搜索…")).toBeInTheDocument();
    expect(screen.getByText("新建")).toBeInTheDocument();
    // 有 1 条结果时 CommandEmpty 不渲染，确认它也不会因缺少祖先而报错。
    expect(screen.queryByText("无结果")).toBeNull();
  });
});
