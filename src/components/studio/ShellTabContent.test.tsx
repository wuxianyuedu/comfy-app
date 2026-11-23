/**
 * `ShellTabContent` 的两条契约（ISSUE #1244，用例自 `ShellTabs.test.tsx` 迁来）：
 * ① 可嵌时内容渲染在页签里（一个 `iframe`，`title` 就是页签名）；② 不可嵌时仍在
 * 同一页签里给出可读说明（带地址），既不塞注定空白的 `iframe`，也不弹第二个窗口。
 * 自 ISSUE #4898 起本组件渲染在 `AppShell` 的内容列（不再整窗覆盖）——
 * 「iframe 激活时侧栏仍可见」那条装配判据在 `AppShell.sidebar-temp-tabs.test.tsx`。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { ShellTab } from "~/lib/shell/shell-tabs-store";

import { ShellTabContent } from "./ShellTabContent";

/* 剪贴板桩：说明里那颗「复制地址」会经 `~/lib/browser-io` 的 `copyText` 写剪贴板，
 * 而它在 jsdom 里的兜底路径会往 `document.body` 挂一个临时 `textarea`（handle 残留）。
 * 用例不必真碰剪贴板，给一份成功实现即可。 */
const written: Array<string> = [];

beforeEach(() => {
  written.length = 0;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: (text: string) => {
        void written.push(text);
      },
    },
  });
});

afterEach(() => {
  cleanup();
});

/** 按设置页那条真实路径的字段摆一个 ComfyUI 页签（照抄原 ShellTabs 用例）。 */
function comfyTab(patch: {
  blockedReason?: string | null;
  blockedUrl?: string | null;
  url?: string | null;
}): Array<ShellTab> {
  return [
    {
      id: "comfyui",
      label: "ComfyUI",
      url: patch.url ?? null,
      closable: true,
      blockedReason: patch.blockedReason ?? null,
      blockedUrl: patch.blockedUrl ?? null,
    },
  ];
}

describe("ShellTabContent · 壳内 ComfyUI 页签内容", () => {
  it("可嵌：内容渲染在页签内（iframe 的 title 是页签名）", () => {
    const view = render(
      <ShellTabContent activeTabId="comfyui" tabs={comfyTab({ url: "http://127.0.0.1:8188" })} />,
    );
    /* iframe 就在这一棵子树里，`title` 是页签名（读屏器与 e2e 都靠它认）。 */
    const frame = screen.getByTitle("ComfyUI");
    expect(frame.tagName).toBe("IFRAME");
    expect(frame.getAttribute("src")).toBe("http://127.0.0.1:8188");
    expect(view.container.contains(frame)).toBe(true);
    expect(view.container.querySelectorAll("iframe")).toHaveLength(1);
  });

  it("不可嵌：页签内给可读说明（带地址），同时**不塞**注定空白的 iframe", () => {
    const url = "http://127.0.0.1:8188";
    const view = render(
      <ShellTabContent
        activeTabId="comfyui"
        tabs={comfyTab({
          url,
          blockedReason: "目标拒绝了跨源内嵌（X-Frame-Options: DENY）",
          blockedUrl: url,
        })}
      />,
    );
    /* 说明在页签里：一句「无法在此页签中显示 ComfyUI」，加成因与地址。 */
    expect(screen.getByText("无法在此页签中显示 ComfyUI")).not.toBeNull();
    expect(screen.getByText(/X-Frame-Options: DENY/)).not.toBeNull();
    expect(screen.getByText(url)).not.toBeNull();
    /* 另一半是「不许塞空白 iframe」——少了它，界面只剩一片空白错误页，
     * 用户既看不出被谁拦、也没有下一步（ISSUE #310 第三次回归现场）。 */
    expect(view.container.querySelectorAll("iframe")).toHaveLength(0);
  });

  it("页签既无地址也无拦截说明时给空态（不塞空白 iframe）", () => {
    const view = render(<ShellTabContent activeTabId="comfyui" tabs={comfyTab({})} />);
    /* 形态由页签状态直接决定，这一档在真实链路上进不来（打开动作要么给 `url`、
     * 要么给 `blockedReason`），所以这里直接摆状态而不是假装走一遍。
     * 判它的理由是「三分支里最后那一个」：若只有它没人判，一次误改就会让页签里
     * 只剩一片空白 —— 与 ISSUE #310 记的那类现场同一个姿态。 */
    expect(screen.getByText("页签内容为空")).not.toBeNull();
    expect(view.container.querySelectorAll("iframe")).toHaveLength(0);
  });

  it("切页签只切显隐：非当前页签带 aria-hidden 且保持挂载", () => {
    const tabs = comfyTab({ url: "http://127.0.0.1:8188" });
    const view = render(<ShellTabContent activeTabId="comfyui" tabs={tabs} />);
    /* 非当前页签那层的 `aria-hidden` 由「这一格是不是当前页签」直接给出。 */
    const host = () => view.container.querySelector("iframe")!.closest("div")!;
    expect(host().getAttribute("aria-hidden")).toBe("false");

    /* 切回主应用：ComfyUI 页签那一格变成 hidden + aria-hidden，iframe 仍在树上
     *（「始终挂载」是这一格的判据，也是「切回来不会重新加载 ComfyUI」的原因）。 */
    view.rerender(<ShellTabContent activeTabId="main" tabs={tabs} />);
    expect(host().className).toContain("hidden");
    expect(host().getAttribute("aria-hidden")).toBe("true");
    expect(view.container.querySelector("iframe")).not.toBeNull();
  });

  it("说明里的地址可复制，且复制成功有可见反馈（不静默）", async () => {
    const url = "http://127.0.0.1:8188";
    render(
      <ShellTabContent
        activeTabId="comfyui"
        tabs={comfyTab({
          url,
          blockedReason: "目标拒绝了跨源内嵌（X-Frame-Options: DENY）",
          blockedUrl: url,
        })}
      />,
    );
    /* 地址就在说明里印着 —— 用户能手动选中，这是「失败也不打扰」的前提
     *（`onFailure: "silent"`），所以这里只钉成功那半：点下去真的写进剪贴板、
     * 按钮文案换成「已复制」。少了这一句，那颗按钮点下去界面毫无变化，
     * 用户不知道成没成（规范 16 §16.2.4.43 的现场）。 */
    fireEvent.click(screen.getByRole("button", { name: "复制地址" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(written).toEqual([url]);
    expect(screen.getByRole("button", { name: "已复制" })).not.toBeNull();
  });
});
