// @vitest-environment jsdom
// 统一容器的形状判据（规范 11.2：断言用户看得见的结构，不测内部实现细节）。
//
// 这一刀把「外层滚动 + 居中窄栏」从八个视图里收进一处，所以用例要守住的是**收口这件事
// 本身**，而不是某个视图长什么样：
//   · 文档型必须恰好有一层纵向滚动条（多一层就是双层滚动，少一层内容就被裁）；
//   · 工作区型必须**不**给页面滚动条 —— 它自己管内部滚动，套上窄栏等于砍掉工作面积；
//   · 宽度档位只有三个名字，且调用处可以覆盖（规范 03 §3.8.1.1：宽度是布局决定）；
//   · 铺底挂在外框、是滚动层的兄弟：塞进居中列会改变它的位置语义。
// 这几条都是「以后有人图省事在视图里手写 div」时会静默回潮的点。

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { DocumentFrame, WorkspaceFrame } from "./ViewContainer";

afterEach(() => {
  cleanup();
});

/** 取外框（两类都带 data-view-container，便于从 DOM 判形状，而不是靠读源码）。 */
function frameOf(container: HTMLElement, kind: "document" | "workspace") {
  const frame = container.querySelector<HTMLElement>(
    `[data-view-container="${kind}"]`,
  );
  if (!frame) throw new Error(`没渲染出 data-view-container="${kind}" 的外框`);
  return frame;
}

describe("DocumentFrame（文档型）", () => {
  it("外框吃满父级且自己不滚，滚动条只在中间那一层", () => {
    const { container } = render(
      <DocumentFrame>
        <p>内容</p>
      </DocumentFrame>,
    );
    const frame = frameOf(container, "document");
    expect(frame.className).toContain("h-full");
    expect(frame.className).toContain("overflow-hidden");

    const scrollers = frame.querySelectorAll("[class*='overflow-y-auto']");
    expect(scrollers).toHaveLength(1);
  });

  it("居中列带 mx-auto + w-full，档位默认 wide", () => {
    const { container } = render(
      <DocumentFrame>
        <p>内容</p>
      </DocumentFrame>,
    );
    const column = container.querySelector<HTMLElement>(
      '[data-view-container="document"] [class*="overflow-y-auto"] > div',
    );
    if (!column) throw new Error("没找到居中列");
    expect(column.className).toContain("mx-auto");
    expect(column.className).toContain("w-full");
    expect(column.className).toContain("max-w-wide");
  });

  it.each([
    ["narrow", "max-w-narrow"],
    ["medium", "max-w-medium"],
    ["wide", "max-w-wide"],
  ] as const)("档位 %s ⇒ 只写 %s 这一个类（数值留在令牌里）", (width, cls) => {
    const { container } = render(
      <DocumentFrame width={width}>
        <p>内容</p>
      </DocumentFrame>,
    );
    const column = container.querySelector<HTMLElement>(
      '[data-view-container="document"] [class*="overflow-y-auto"] > div',
    );
    if (!column) throw new Error("没找到居中列");
    expect(column.className).toContain(cls);
    // 三个档位名互斥：同时出现两份就等于宽度又有了两个家。
    const others = ["max-w-narrow", "max-w-medium", "max-w-wide"].filter(
      (name) => name !== cls,
    );
    for (const name of others) {
      expect(column.className, `不该同时出现 ${name}`).not.toContain(name);
    }
  });

  it("调用处的 className 是追加，不是替换掉居中", () => {
    const { container } = render(
      <DocumentFrame className="px-4 py-8 sm:px-8">
        <p>内容</p>
      </DocumentFrame>,
    );
    const column = container.querySelector<HTMLElement>(
      '[data-view-container="document"] [class*="overflow-y-auto"] > div',
    );
    if (!column) throw new Error("没找到居中列");
    expect(column.className).toContain("mx-auto");
    expect(column.className).toContain("px-4");
    expect(column.className).toContain("sm:px-8");
  });

  it("宽度只有 width 这一个入口：className 里再写 max-w 不会盖掉档位", () => {
    /* 实测：合并器认不出 `--container-*` 派生出来的档位名（`max-w-narrow` 这类），
       所以两份类都会留在 class 上，谁生效取决于样式表顺序 —— 这不是「调用处赢」，
       而是**未定义行为**。因此约定：宽度只从 `width` 档位进来，className 里不许再写
       `max-w-*`。这条约定由 `tests/project-view-container.test.ts` 逐文件判住。 */
    const { container } = render(
      <DocumentFrame width="narrow" className="max-w-[50rem]">
        <p>内容</p>
      </DocumentFrame>,
    );
    const column = container.querySelector<HTMLElement>(
      '[data-view-container="document"] [class*="overflow-y-auto"] > div',
    );
    if (!column) throw new Error("没找到居中列");
    expect(column.className).toContain("max-w-narrow");
    expect(column.className).toContain("max-w-[50rem]");
  });

  it("铺底是外框的直接子节点、排在滚动层之前", () => {
    const { container } = render(
      <DocumentFrame backdrop={<div data-testid="bd" aria-hidden />}>
        <p>内容</p>
      </DocumentFrame>,
    );
    const frame = frameOf(container, "document");
    const backdrop = frame.querySelector<HTMLElement>('[data-testid="bd"]');
    if (!backdrop) throw new Error("铺底没渲染出来");
    expect(backdrop.parentElement).toBe(frame);
    const scroller = frame.querySelector("[class*='overflow-y-auto']");
    // 同一父级下的前一个兄弟 —— 它不该被塞进居中列里。
    expect(
      backdrop.compareDocumentPosition(scroller as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("内容列是 div 而不是 main（外壳的 SidebarInset 才是本页唯一的 main）", () => {
    const { container } = render(
      <DocumentFrame>
        <p>内容</p>
      </DocumentFrame>,
    );
    expect(container.querySelector("main")).toBeNull();
  });
});

describe("WorkspaceFrame（工作区型）", () => {
  it("外框吃满父级且**不**给页面滚动条", () => {
    const { container } = render(
      <WorkspaceFrame>
        <div>画布</div>
      </WorkspaceFrame>,
    );
    const frame = frameOf(container, "workspace");
    expect(frame.className).toContain("h-full");
    expect(frame.className).toContain("overflow-hidden");
    // 容器自己不产生滚动层：内部哪一栏滚，是视图的事。
    expect(frame.querySelectorAll("[class*='overflow-y-auto']")).toHaveLength(
      0,
    );
  });

  it("不出现居中列与宽度档位（工作区型被限宽就是这次要修的那个病）", () => {
    const { container } = render(
      <WorkspaceFrame>
        <div>画布</div>
      </WorkspaceFrame>,
    );
    const frame = frameOf(container, "workspace");
    expect(frame.className).not.toContain("max-w-");
    expect(frame.querySelector('[class*="mx-auto"]')).toBeNull();
  });
});
