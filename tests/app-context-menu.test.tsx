/**
 * `AppContextMenu` 的契约（ISSUE #4132 / #4822）：应用内右键菜单，样式与 WebView2
 * 默认菜单同款并随明暗主题切换。钉：① 没人管的右键 ⇒ preventDefault + 渲染菜单
 * （导航三项 + ComfyUI 组两项）；② 画布等已自处理（`defaultPrevented`）的右键 ⇒
 * 尊重原处理，不重复出菜单；③ 菜单在下一次 pointerdown / 失焦时收起，点「刷新页面」
 * 走 `location.reload`；④ ComfyUI 组两档卸载走 `setting.comfyFree`
 * （`freeMemory` false / true），结果信封的 detail 进 toast。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AppContextMenu } from "~/components/app-context-menu/AppContextMenu";

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
const comfyFree = vi.hoisted(() => vi.fn());

vi.mock("~/components/studio/ToastProvider", () => ({
  useToast: () => ({
    toast: vi.fn(),
    success: toastSuccess,
    error: toastError,
    info: vi.fn(),
    loading: vi.fn(),
    update: vi.fn(),
    dismiss: vi.fn(),
  }),
}));
/* 菜单只消费 `setting.comfyFree` 这一个端点：给到 mutationOptions 形状即可，
 * useMutation 本身用真的（应用里由根布局的 TRPCReactProvider 提供上下文）。 */
vi.mock("~/trpc/react", () => ({
  useTRPC: () => ({
    setting: {
      comfyFree: {
        mutationOptions: () => ({ mutationFn: comfyFree }),
      },
    },
  }),
}));

/** 在 body 上派发一个右键事件（bubble 到 window 的监听），回传事件本身。 */
function contextmenuAt(x: number, y: number): MouseEvent {
  const event = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
  });
  document.body.dispatchEvent(event);
  return event;
}

const menuEl = () => document.querySelector('[role="menu"]');

/** useMutation 需要 QueryClient 上下文，包一层与根布局等价的最小壳。 */
function renderMenu() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AppContextMenu />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  comfyFree.mockReset();
  toastSuccess.mockClear();
  toastError.mockClear();
});

describe("AppContextMenu：应用内右键菜单（ISSUE #4132）", () => {
  it("没人管的右键 ⇒ preventDefault 并渲染原生同款菜单（导航三项 + ComfyUI 组两项）", () => {
    renderMenu();
    let event: MouseEvent;
    act(() => {
      event = contextmenuAt(30, 40);
    });
    expect(event!.defaultPrevented).toBe(true);
    const menuNode = menuEl();
    if (!(menuNode instanceof HTMLElement)) {
      throw new Error("菜单没渲染成 HTMLElement");
    }
    expect(menuNode.style.left).toBe("30px");
    expect(menuNode.style.top).toBe("40px");
    expect(screen.getByRole("menuitem", { name: "刷新页面" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "后退" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "前进" })).toBeTruthy();
    expect(screen.getByText("ComfyUI")).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "卸载模型" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "卸载模型和执行缓存" })).toBeTruthy();
  });

  it("画布等已自处理的右键（先 preventDefault）⇒ 尊重原处理，不重复出菜单", () => {
    renderMenu();
    act(() => {
      const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      event.preventDefault();
      document.body.dispatchEvent(event);
    });
    expect(menuEl()).toBeNull();
  });

  it("下一次 pointerdown ⇒ 菜单收起", () => {
    renderMenu();
    act(() => {
      contextmenuAt(10, 10);
    });
    expect(menuEl()).not.toBeNull();
    act(() => {
      window.dispatchEvent(new Event("pointerdown"));
    });
    expect(menuEl()).toBeNull();
  });

  it("点「刷新页面」⇒ location.reload 且菜单收起", () => {
    /* happy-dom 的 `location.reload` 不可 redefine ⇒ 用最小桩替身接住调用。 */
    const reload = vi.fn();
    vi.stubGlobal("location", { reload });
    renderMenu();
    act(() => {
      contextmenuAt(10, 10);
    });
    act(() => {
      screen.getByRole("menuitem", { name: "刷新页面" }).click();
    });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(menuEl()).toBeNull();
  });

  it("菜单配色带 dark: 变体 ⇒ 跟随明暗主题（#4822）", () => {
    renderMenu();
    act(() => {
      contextmenuAt(10, 10);
    });
    const menuNode = menuEl();
    if (!(menuNode instanceof HTMLElement)) {
      throw new Error("菜单没渲染成 HTMLElement");
    }
    /* 暗色档的三处关键值：容器底色、菜单项文字、悬停底色。写死浅色不跟主题
     * 是本次立案的症状，钉住类名即钉住「两态都有」。 */
    expect(menuNode.className).toContain("dark:bg-[#292a2d]");
    expect(screen.getByRole("menuitem", { name: "刷新页面" }).className).toContain(
      "dark:text-[#e8eaed]",
    );
    expect(screen.getByRole("menuitem", { name: "刷新页面" }).className).toContain(
      "dark:hover:bg-[#3c3b40]",
    );
  });
});

describe("AppContextMenu 菜单项可点（#4417）", () => {
  it("菜单项上的 pointerdown 不卸载菜单：随后的 click 照常执行动作", () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { reload });
    renderMenu();
    act(() => {
      contextmenuAt(10, 10);
    });
    const item = screen.getByRole("menuitem", { name: "刷新页面" });
    act(() => {
      /* 真实浏览器事件序：菜单项上先 pointerdown、后 click。修缺陷前
       * pointerdown 把菜单卸了，click 派发时按钮已不在 DOM——动作永远不执行。 */
      item.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    });
    expect(menuEl()).not.toBeNull();
    act(() => {
      item.click();
    });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(menuEl()).toBeNull();
  });

  it("菜单之外的 pointerdown 仍收起菜单（关闭纪律不变）", () => {
    renderMenu();
    act(() => {
      contextmenuAt(10, 10);
    });
    expect(menuEl()).not.toBeNull();
    act(() => {
      window.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    });
    expect(menuEl()).toBeNull();
  });
});

describe("AppContextMenu 的 ComfyUI 卸载组（ISSUE #4822）", () => {
  it("点「卸载模型」⇒ comfyFree({freeMemory:false})，服务端 detail 进成功 toast，菜单收起", async () => {
    const user = userEvent.setup();
    comfyFree.mockResolvedValue({ ok: true, detail: "已卸载模型" });
    renderMenu();
    act(() => {
      contextmenuAt(10, 10);
    });
    await user.click(screen.getByRole("menuitem", { name: "卸载模型" }));
    /* react-query v5 会给 mutationFn 追加第二个内部上下文实参：只断言业务入参。 */
    expect(comfyFree.mock.calls[0]?.[0]).toEqual({ freeMemory: false });
    expect(toastSuccess).toHaveBeenCalledWith("已卸载模型");
    expect(toastError).not.toHaveBeenCalled();
    expect(menuEl()).toBeNull();
  });

  it("点「卸载模型和执行缓存」⇒ 同一端点的另一档（freeMemory:true）", async () => {
    const user = userEvent.setup();
    comfyFree.mockResolvedValue({ ok: true, detail: "已卸载模型并释放执行缓存" });
    renderMenu();
    act(() => {
      contextmenuAt(10, 10);
    });
    await user.click(screen.getByRole("menuitem", { name: "卸载模型和执行缓存" }));
    expect(comfyFree.mock.calls[0]?.[0]).toEqual({ freeMemory: true });
    expect(toastSuccess).toHaveBeenCalledWith("已卸载模型并释放执行缓存");
    expect(menuEl()).toBeNull();
  });

  it("卸载返回失败信封（如未在运行）⇒ detail 进 toast.error，不误报成功", async () => {
    const user = userEvent.setup();
    comfyFree.mockResolvedValue({
      ok: false,
      detail: "ComfyUI 未在运行，无需卸载 —— 请先点「启动 ComfyUI」",
    });
    renderMenu();
    act(() => {
      contextmenuAt(10, 10);
    });
    await user.click(screen.getByRole("menuitem", { name: "卸载模型" }));
    expect(toastError).toHaveBeenCalledWith("ComfyUI 未在运行，无需卸载 —— 请先点「启动 ComfyUI」");
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("卸载请求抛错（网络层）⇒ 详情进 toast.error（失败路径有可见出口）", async () => {
    const user = userEvent.setup();
    comfyFree.mockRejectedValue(new Error("网络断了"));
    renderMenu();
    act(() => {
      contextmenuAt(10, 10);
    });
    await user.click(screen.getByRole("menuitem", { name: "卸载模型" }));
    /* errorMessage 的口径：抛值带 message 时给详情本身；`failureText`
     * （「卸载模型失败」）只是详情取不到时的兜底，不做前缀拼接。 */
    expect(toastError).toHaveBeenCalledWith("网络断了");
  });
});
