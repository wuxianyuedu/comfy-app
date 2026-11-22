/**
 * 侧栏品牌图的接线判据（Issue #4813 复评）：它是**回主页**的按钮，不是换图入口；
 * 悬停提示「主页」，且悬停不出现背景框；换图后（设置页写的本机存储 + 广播）即时跟上。
 * 判用户可见结果（按钮名 / 图片 src / 类名），不摸内部 state。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { emitAppEvent, subscribeAppEvent } from "~/lib/app-events";
import { readBrandLogo, restoreBrandLogo, saveBrandLogo } from "~/lib/appearance";
import { TooltipProvider } from "~/components/ui/tooltip";
import { SidebarBrand } from "./SidebarBrand";

const STORAGE_KEY = "sidebar-brand-logo";
const DEFAULT_LOGO = "/brand-logo.svg";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function logoImg(): HTMLImageElement {
  const el: unknown = screen.getByRole("img", { name: "品牌图片" });
  if (!(el instanceof HTMLImageElement)) {
    throw new Error("品牌图片不是 img 元素");
  }
  return el;
}

describe("侧栏品牌图", () => {
  it("默认显示内置图，点击回主页（不是打开换图）", () => {
    const onHome = vi.fn();
    render(<SidebarBrand onHome={onHome} />);
    expect(logoImg().getAttribute("src")).toBe(DEFAULT_LOGO);

    const btn = screen.getByRole("button", { name: "主页" });
    fireEvent.click(btn);
    expect(onHome).toHaveBeenCalledTimes(1);
    /* 换图入口已挪走：侧栏不再有文件输入框。 */
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it("悬停弹出「主页」提示（走 Hint/Tooltip，不是原生 title）", async () => {
    const user = userEvent.setup();
    const wrap = (ui: ReactNode) => <TooltipProvider delay={0}>{ui}</TooltipProvider>;
    render(wrap(<SidebarBrand onHome={vi.fn()} />));
    const btn = screen.getByRole("button", { name: "主页" });
    expect(btn).not.toHaveAttribute("title");
    await user.hover(btn);
    const popup = await screen.findByText("主页");
    expect(popup.dataset.slot).toBe("tooltip-content");
  });

  it("品牌按钮没有悬停背景色（只留焦点环）", () => {
    render(<SidebarBrand onHome={vi.fn()} />);
    const btn = screen.getByRole("button", { name: "主页" });
    /* 基元 ghost 自带 `hover:bg-muted`/暗态 `hover:bg-muted/50`（0,2,0），
       必须有 ! 覆盖类把它压成透明，否则悬停还是会长出背景框。 */
    expect(btn.className).toContain("hover:bg-transparent!");
    expect(btn.className).toContain("bg-transparent!");
  });

  it("挂载后读回本机自定义图：换图入口虽挪走，旧数据仍显示", async () => {
    window.localStorage.setItem(STORAGE_KEY, "data:image/png;base64,CUSTOM");
    render(<SidebarBrand onHome={vi.fn()} />);
    await expect.poll(() => logoImg().getAttribute("src")).toBe("data:image/png;base64,CUSTOM");
  });

  it("设置页换图广播后即时换成新图，恢复默认广播后回到内置图", async () => {
    render(<SidebarBrand onHome={vi.fn()} />);
    window.localStorage.setItem(STORAGE_KEY, "data:image/png;base64,NEW");
    emitAppEvent("comfyapp:brand-logo-changed");
    await expect.poll(() => logoImg().getAttribute("src")).toBe("data:image/png;base64,NEW");

    window.localStorage.removeItem(STORAGE_KEY);
    emitAppEvent("comfyapp:brand-logo-changed");
    await expect.poll(() => logoImg().getAttribute("src")).toBe(DEFAULT_LOGO);
  });
});

/** app-events 两端成对的判据按源码认字面量，这里只验证事件本身能派发/订阅（运行时）。 */
describe("品牌图广播（lib 层），", () => {
  it("saveBrandLogo / restoreBrandLogo 写本机并各发一条广播", () => {
    const seen: string[] = [];
    const off = subscribeAppEvent("comfyapp:brand-logo-changed", () => {
      seen.push("changed");
    });
    saveBrandLogo("data:image/png;base64,X");
    expect(readBrandLogo()).toBe("data:image/png;base64,X");
    restoreBrandLogo();
    expect(readBrandLogo()).toBe(DEFAULT_LOGO);
    expect(seen).toHaveLength(2);
    off();
  });
});
