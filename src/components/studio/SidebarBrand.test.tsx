/**
 * 侧栏品牌图的接线判据（Issue #4813）：默认图能显示、点图片能换成自己的图、
 * 换完写回本机 localStorage、「恢复默认」把自定义清掉。判用户可见结果
 * （图片 src / 按钮在不在 / localStorage 读数），不摸内部 state。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { SidebarBrand } from "./SidebarBrand";

const STORAGE_KEY = "sidebar-brand-logo";
const DEFAULT_LOGO = "/brand-logo.svg";

vi.mock("~/lib/file-io", () => ({
  readFileAsDataUrl: vi.fn(() => Promise.resolve("data:image/png;base64,AAAA")),
}));

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(cleanup);

function logoImg(): HTMLImageElement {
  const el: unknown = screen.getByRole("img", { name: "品牌图片" });
  if (!(el instanceof HTMLImageElement)) {
    throw new Error("品牌图片不是 img 元素");
  }
  return el;
}

describe("侧栏品牌图片", () => {
  it("默认显示内置图片，且没有「恢复默认」入口", () => {
    render(<SidebarBrand />);
    const img = logoImg();
    expect(img.getAttribute("src")).toBe(DEFAULT_LOGO);
    expect(screen.queryByRole("button", { name: "恢复默认品牌图片" })).toBeNull();
  });

  it("挂载后读回本机自定义图片并显示，同时给出「恢复默认」入口", async () => {
    window.localStorage.setItem(STORAGE_KEY, "data:image/png;base64,CUSTOM");
    render(<SidebarBrand />);
    await waitFor(() => {
      expect(logoImg().getAttribute("src")).toBe("data:image/png;base64,CUSTOM");
    });
    expect(screen.getByRole("button", { name: "恢复默认品牌图片" })).toBeInTheDocument();
  });

  it("点图片选一张新图后即时替换并写回本机", async () => {
    render(<SidebarBrand />);
    fireEvent.click(screen.getByRole("button", { name: "更换品牌图片" }));
    /* 隐藏 input 由 useFilePicker 挂着，测试直接对它派发 change。 */
    const found: unknown = document.querySelector('input[type="file"]');
    if (!(found instanceof HTMLInputElement)) {
      throw new Error("未找到文件输入框");
    }
    const input: HTMLInputElement = found;
    const file = new File(["bytes"], "logo.png", { type: "image/png" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    fireEvent.change(input);

    await waitFor(() => {
      expect(logoImg().getAttribute("src")).toBe("data:image/png;base64,AAAA");
    });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("data:image/png;base64,AAAA");
  });

  it("点「恢复默认」回到内置图片并清掉本机自定义", async () => {
    window.localStorage.setItem(STORAGE_KEY, "data:image/png;base64,CUSTOM");
    render(<SidebarBrand />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "恢复默认品牌图片" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "恢复默认品牌图片" }));
    expect(logoImg().getAttribute("src")).toBe(DEFAULT_LOGO);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
