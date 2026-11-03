// @vitest-environment happy-dom
/**
 * `useSectionScrollSpy` 的唯一实现（ISSUE #1722）：失效模式是**静默**的，故钉四件事——
 * ① 越过顶线的文档顺序最后一节为当前分区；② 无节越过线时保留当前值；③ 点导航立刻通知
 * 并 `scrollIntoView`；④ 无 `IntersectionObserver` 时退化不崩（DOM 档没有它，装假观察器）。
 */
import { act, renderHook } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SECTION_ROOT_MARGIN, useSectionScrollSpy } from "./use-section-scroll-spy";

/** 假观察器：只记录「观察了谁、配置是什么」，回调由用例手动投递。 */
class FakeIntersectionObserver {
  static last: FakeIntersectionObserver | null = null;
  observed: Array<Element> = [];
  options: IntersectionObserverInit | undefined;
  callback: IntersectionObserverCallback;
  disconnected = false;

  constructor(cb: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = cb;
    this.options = options;
    FakeIntersectionObserver.last = this;
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  unobserve() {
    /* 有意为空：本假观察器只服务「谁进入了」这一条判据，退订不入账。 */
  }
  disconnect() {
    this.disconnected = true;
  }
  takeRecords(): Array<IntersectionObserverEntry> {
    return [];
  }

  /** 投递一次「谁进入了 / 谁离开了」。 */
  emit(entries: Array<{ isIntersecting: boolean; target: Element }>) {
    /* SAFETY: 类型断言已复核 */
    this.callback(
      entries.map(
        /* SAFETY: 类型断言已复核 */
        (e) =>
          ({
            target: e.target,
            isIntersecting: e.isIntersecting,
            intersectionRatio: e.isIntersecting ? 1 : 0,
          }) as unknown as IntersectionObserverEntry,
      ),
      this as unknown as IntersectionObserver,
    );
  }
}

/* SAFETY: 类型断言已复核 */
const IDS = ["a", "b", "c"] as const;

/** 建宿主容器 + 三个分区节，并把 `ref` 回调挂上去。 */
function mountSections(ref: React.RefObject<HTMLElement | null>) {
  const container = document.createElement("div");
  document.body.append(container);
  const nodes = new Map<string, HTMLElement>();
  for (const id of IDS) {
    const el = document.createElement("section");
    el.id = `settings-${id}`;
    container.append(el);
    nodes.set(id, el);
  }
  ref.current = container;
  return { container, nodes };
}

afterEach(() => {
  document.body.innerHTML = "";
  FakeIntersectionObserver.last = null;
  vi.unstubAllGlobals();
});

describe("useSectionScrollSpy", () => {
  it("越过顶线的最后一节成为当前分区，且观察配置收在顶线之上", () => {
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
    const ref: React.RefObject<HTMLElement | null> = { current: null };
    const { nodes } = mountSections(ref);
    const onActiveChange = vi.fn();
    const { result } = renderHook(() =>
      useSectionScrollSpy({
        containerRef: ref,
        sectionIds: IDS,
        activeId: "a",
        onActiveChange,
      }),
    );

    /* 挂 `ref` 回调（真实调用处是 React 的 `ref` 属性，这里手动调）。 */
    act(() => {
      for (const id of IDS) {
        result.current.registerSection(id)(nodes.get(id)!);
      }
    });

    const observer = FakeIntersectionObserver.last!;
    /* 观察器把可视区压成上沿往下**一条线**（下沿也收掉，否则「进入」退化成
       「看得见」＝ 屏底那一节 —— 这条形状就是判据本身）。 */
    expect(observer.options?.rootMargin).toBe(SECTION_ROOT_MARGIN);
    expect(SECTION_ROOT_MARGIN).toContain("-100%");
    expect(observer.observed).toHaveLength(3);

    /* a、b 都进入了 —— 取文档顺序里最后一个（b）。 */
    act(() => {
      observer.emit([
        { target: nodes.get("a")!, isIntersecting: true },
        { target: nodes.get("b")!, isIntersecting: true },
      ]);
    });
    expect(onActiveChange).toHaveBeenCalledWith("b");

    /* 再进入 c —— 当前项推到 c。 */
    act(() => {
      observer.emit([{ target: nodes.get("c")!, isIntersecting: true }]);
    });
    expect(onActiveChange).toHaveBeenLastCalledWith("c");
  });

  it("没有一节越过线时保留当前值（滚到最顶不清掉高亮）", () => {
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
    const ref: React.RefObject<HTMLElement | null> = { current: null };
    const { nodes } = mountSections(ref);
    const onActiveChange = vi.fn();
    const { result } = renderHook(() =>
      useSectionScrollSpy({
        containerRef: ref,
        sectionIds: IDS,
        activeId: "b",
        onActiveChange,
      }),
    );
    act(() => {
      for (const id of IDS) {
        result.current.registerSection(id)(nodes.get(id)!);
      }
    });

    act(() => {
      FakeIntersectionObserver.last!.emit([
        { target: nodes.get("a")!, isIntersecting: false },
        { target: nodes.get("b")!, isIntersecting: false },
      ]);
    });
    expect(onActiveChange).not.toHaveBeenCalled();
  });

  it("点导航立刻通知并滚到那一节（不等滚动落定）", () => {
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
    const ref: React.RefObject<HTMLElement | null> = { current: null };
    const { nodes } = mountSections(ref);
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const onActiveChange = vi.fn();
    const { result } = renderHook(() =>
      useSectionScrollSpy({
        containerRef: ref,
        sectionIds: IDS,
        activeId: "a",
        onActiveChange,
      }),
    );
    act(() => {
      for (const id of IDS) {
        result.current.registerSection(id)(nodes.get(id)!);
      }
    });

    act(() => {
      result.current.scrollToSection("c");
    });
    expect(onActiveChange).toHaveBeenCalledWith("c");
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.instances[0]).toBe(nodes.get("c"));
  });

  it("没有 IntersectionObserver 时退化：不跟随，但点击仍可用", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const ref: React.RefObject<HTMLElement | null> = { current: null };
    const { nodes } = mountSections(ref);
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const onActiveChange = vi.fn();
    const { result } = renderHook(() =>
      useSectionScrollSpy({
        containerRef: ref,
        sectionIds: IDS,
        activeId: "a",
        onActiveChange,
      }),
    );
    act(() => {
      for (const id of IDS) {
        result.current.registerSection(id)(nodes.get(id)!);
      }
    });

    act(() => {
      result.current.scrollToSection("b");
    });
    expect(onActiveChange).toHaveBeenCalledWith("b");
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });
});
