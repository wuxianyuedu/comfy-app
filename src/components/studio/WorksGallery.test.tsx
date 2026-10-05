/* 「所有项目」屏的**渲染**判据（ISSUE #1522 收尾）。
 *
 * 逻辑层（取数 / 确认流 / 出处标注）由 `works/hooks/UseWorksGallery.test.tsx`
 * 守，这里只断言**用户看得见的那一层**：那一句说明文案到底排成了什么。
 *
 * 为什么值得单钉一条：原先它写成 `列表以**服务端**为准`，而 JSX 文本节点
 * 不解析 Markdown —— 星号原样印在界面上。这类错**类型检查、lint、逻辑层用例
 * 全都看不见**（它们一个字都不看渲染结果），只有真渲染才现形。
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { ToastProvider } from "./ToastProvider";
import { WorksGallery } from "./WorksGallery";
import type { WorksGalleryController } from "./works/hooks/use-works-gallery";

const controllerMock = vi.hoisted(() => vi.fn<() => WorksGalleryController>());

vi.mock("./works/hooks/use-works-gallery", () => ({
  useWorksGallery: (): WorksGalleryController => controllerMock(),
}));

/* 用**真** ToastProvider 包一层，而不是把提示通道 mock 掉：这一屏的删除确认流
 * 会用到它，mock 掉就等于换掉被渲染的那棵树（本文件断言的正是渲染结果）。 */
function renderScreen(): HTMLElement {
  const { container } = render(
    <ToastProvider>
      <WorksGallery />
    </ToastProvider>,
  );
  return container;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function controller(
  over: Partial<WorksGalleryController> = {},
): WorksGalleryController {
  return {
    projects: [],
    loading: false,
    serverOk: true,
    openProject: () => undefined,
    requestDelete: () => undefined,
    pendingDelete: null,
    cancelDelete: () => undefined,
    confirmDelete: async () => null,
    deleting: false,
    refresh: () => undefined,
    ...over,
  };
}

describe("WorksGallery 说明文案", () => {
  /* 判据是**渲染后的可见文本**，不是源码字符串：源码里「有没有星号」可以靠
   * 肉眼核，但「星号会不会被渲染出来」只有这一层答得了。 */
  it("把「服务端」排成强调，而不是把 Markdown 星号印到界面上", () => {
    controllerMock.mockReturnValue(controller());
    const text = renderScreen().textContent ?? "";
    expect(text).toContain("列表以服务端为准");
    expect(text, "裸的 Markdown 星号会原样显示给用户").not.toContain("**");
  });

  it("词边界没有让 JSX 缩进带出多余空白", () => {
    controllerMock.mockReturnValue(controller());
    const text = renderScreen().textContent ?? "";
    // 中文句子里不该出现词间空格（JSX 会把换行处的空白当内容渲染）。
    expect(text).not.toContain("服务端 为准");
    expect(text).not.toContain("列表以 服务端");
  });
});
