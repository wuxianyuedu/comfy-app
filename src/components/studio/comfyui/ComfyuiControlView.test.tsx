// ComfyUI 运行页可见行为（ISSUE #1900）。风险在「状态 → 该按哪颗」的投影：
// 断言四态文案、启动/关闭互斥主行动（当前态实心、另一颗禁用）、未配置路径时启动禁用
// 且给出设置页出口、启动日志框在页上、以及「这一点下去按哪条已保存路径启动」。
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ComfyuiControlView } from "./ComfyuiControlView";
import type { ComfyuiControlController } from "./hooks/use-comfyui-control";

/* 记账「跳转出口」派发的事件载荷：`emitAppEvent` 换成 spy，其余（订阅侧）保留真实实现，
   免得本页挂载链上别处对 `app-events` 的用法被一起换掉。 */
const { emitAppEventMock, emitCalls } = vi.hoisted(() => {
  const calls: Array<{ name: string; payload: unknown }> = [];
  return {
    emitAppEventMock: vi.fn((name: string, payload?: unknown) => {
      calls.push({ name, payload });
    }),
    emitCalls: calls,
  };
});
vi.mock("~/lib/app-events", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("~/lib/app-events");
  return { ...actual, emitAppEvent: emitAppEventMock };
});

/* 本仓不在 setup 里注册自动 cleanup（`globals: false`），每份用例自己收尾 ——
   与 RuntimeLogBox.test.tsx / AppearanceSection.test.tsx 同款。 */
afterEach(cleanup);
beforeEach(() => {
  emitCalls.length = 0;
});

function controller(over: Partial<ComfyuiControlController> = {}): ComfyuiControlController {
  return {
    status: null,
    instance: {
      pathConfigured: true,
      instanceType: "portable",
      desktopManaged: false,
      pathExists: true,
      interpreter: { configured: false, exists: null },
    },
    starting: false,
    stopping: false,
    opening: false,
    browserOpening: false,
    freeing: false,
    startComfy: vi.fn(() => Promise.resolve()),
    stopComfy: vi.fn(() => Promise.resolve()),
    unloadModels: vi.fn(() => Promise.resolve()),
    unloadModelsWithCache: vi.fn(() => Promise.resolve()),
    openComfy: vi.fn(() => Promise.resolve()),
    openComfyInBrowser: vi.fn(() => Promise.resolve()),
    refreshStatus: vi.fn(() => Promise.resolve()),
    log: {
      text: "",
      segments: [],
      sessions: [],
      sessionId: null,
      truncated: false,
      windowed: false,
      total: 0,
      active: false,
      selectSession: vi.fn(),
      refresh: vi.fn(() => Promise.resolve()),
    },
    ...over,
  };
}

const running = {
  up: true,
  starting: false,
  probing: false,
  stopping: false,
  base: "http://127.0.0.1:8188",
  port: 8188,
  via: "配置路径的实例",
  path: String.raw`D:\ComfyUI`,
};

describe("ComfyuiControlView", () => {
  it("未运行：启动提为紫色实心主行动，打开查看 / 在浏览器打开降为幽灵并禁用（#4872）", () => {
    render(<ComfyuiControlView c={controller()} />);
    expect(screen.getByText("ComfyUI 未运行")).toBeInTheDocument();
    const start = screen.getByRole("button", { name: "启动 ComfyUI" });
    const stop = screen.getByRole("button", { name: "关闭 ComfyUI" });
    const open = screen.getByRole("button", { name: "打开查看" });
    const openInBrowser = screen.getByRole("button", { name: "在浏览器打开" });
    expect(start).toBeEnabled();
    expect(stop).toBeDisabled();
    expect(open).toBeDisabled();
    expect(openInBrowser).toBeDisabled();
    /* 按钮权重随运行态走（ISSUE #4872）：未运行时唯一有意义的动作是「启动」，
       提为紫色实心；点不动的「打开查看 / 在浏览器打开」降为幽灵档——
       实心档禁用后仍是饱和紫，读起来像「能点」（#4631 的遗留观感）。 */
    expect(start.className).toContain("bg-primary-500 ");
    expect(open.className).not.toContain("bg-primary-500");
    expect(openInBrowser.className).not.toContain("bg-primary-500");
    expect(stop.className).toContain("bg-destructive/10");
  });

  it("运行中：地址单独一行且不截断（用户反馈 #4710），打开查看仍是主题紫实心主按钮", () => {
    render(<ComfyuiControlView c={controller({ status: running })} />);
    /* 状态句只带启动方式；地址挪到单独一行。 */
    const text = screen.getByText(/ComfyUI 运行中/);
    expect(text.textContent).toContain("配置路径的实例");
    expect(text.textContent).not.toContain("http://127.0.0.1:8188");
    /* 地址必须显示全：独立元素 + break-all，不许 truncate。 */
    const url = screen.getByText("http://127.0.0.1:8188");
    expect(url.className).toContain("break-all");
    expect(url.className).not.toContain("truncate");
    const start = screen.getByRole("button", { name: "启动 ComfyUI" });
    const stop = screen.getByRole("button", { name: "关闭 ComfyUI" });
    const open = screen.getByRole("button", { name: "打开查看" });
    expect(start).toBeDisabled();
    expect(stop).toBeEnabled();
    expect(open.className).toContain("bg-primary-500 ");
    expect(stop.className).toContain("bg-destructive/10");
    expect(start.className).not.toContain("bg-primary-500");
  });

  it("运行中：绿点呼吸 + 文案加粗、地址等宽降亮（ISSUE #4631）", () => {
    const { container } = render(<ComfyuiControlView c={controller({ status: running })} />);
    const dot = container.querySelector('[data-slot="status-dot"]');
    expect(dot?.className).toContain("animate-pulse");

    const status = screen.getByRole("status");
    expect(status.className).toContain("font-semibold");
    const url = screen.getByText("http://127.0.0.1:8188");
    expect(url.className).toContain("font-mono");
    expect(url.className).toContain("text-ink-faint");
  });

  it("过渡态优先于探测中：正在启动时不许显示「未运行」", () => {
    render(<ComfyuiControlView c={controller({ starting: true })} />);
    expect(screen.getByText("ComfyUI 正在启动…")).toBeInTheDocument();
    expect(screen.queryByText("ComfyUI 未运行")).not.toBeInTheDocument();
  });

  it("探测进行中：文案是「检测中」而不是「未运行」（外部实例不被先误报一次）", () => {
    render(
      <ComfyuiControlView
        c={controller({
          status: {
            up: false,
            starting: false,
            probing: true,
            stopping: false,
            base: null,
            port: 0,
            via: null,
            path: String.raw`D:\ComfyUI`,
          },
        })}
      />,
    );
    expect(screen.getByText("ComfyUI 状态检测中…")).toBeInTheDocument();
    /* 探测中允许点「打开查看」：它会先取一份新鲜状态再打开（ISSUE #339）。 */
    expect(screen.getByRole("button", { name: "打开查看" })).toBeEnabled();
  });

  it("未配置路径：启动是禁用的，但**给出**去设置页配置的出口", () => {
    render(
      <ComfyuiControlView
        c={controller({
          instance: {
            pathConfigured: false,
            instanceType: null,
            desktopManaged: false,
            pathExists: false,
            interpreter: { configured: false, exists: null },
          },
        })}
      />,
    );
    expect(screen.getByRole("button", { name: "启动 ComfyUI" })).toBeDisabled();
    expect(screen.getByText(/还没配置 ComfyUI 路径/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /去设置里配置/ })).toBeInTheDocument();
  });

  it("点「去设置里配置」带上目标分区：直接停在「创作后端」那一节", () => {
    render(
      <ComfyuiControlView
        c={controller({
          instance: {
            pathConfigured: false,
            instanceType: null,
            desktopManaged: false,
            pathExists: false,
            interpreter: { configured: false, exists: null },
          },
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /去设置里配置/ }));
    /* 只切到「设置」还不够 —— 设置是一页到底的分区目录，载荷必须带上
       `section: "comfyui"`（本页文案写的「设置 → 创作后端」）。 */
    expect(emitCalls).toContainEqual({
      name: "workspace:navigate",
      payload: { view: "settings", section: "comfyui" },
    });
  });

  /* 状态那句是**活区**（`role="status"` + `aria-live="polite"`）：状态变了自己
     会刷，读屏得跟着播报。顺带它给了 E2E 一个不读文案的稳定锚点 —— 那条链路此前
     拿文案本身当判据，文案里的地址一变长度就落到「匹配到但没量到可见」的补间窗口里
     （`e2e/critical-flows.spec.ts` 的 `comfyStatusRow` 头注）。属性一掉，那条链路
     就会退回不稳定的形态，所以在这里钉住。 */
  it("状态那句是活区：读屏跟着播报，且句子以「ComfyUI」开头（E2E 的锚点靠它）", () => {
    render(<ComfyuiControlView c={controller({ status: running })} />);
    const line = screen.getByRole("status");
    expect(line).toHaveAttribute("aria-live", "polite");
    expect(line.textContent).toMatch(/^ComfyUI /);
  });

  it("启动日志框在页上（硬规则 4 的用户可见出口）", () => {
    render(<ComfyuiControlView c={controller()} />);
    expect(screen.getByText("启动日志（comfyui-runtime.log）")).toBeInTheDocument();
    expect(screen.getByText(/暂无日志/)).toBeInTheDocument();
  });

  /* ── 卸载模型两颗按钮（ISSUE #4637）──────────────────────────────
   * ComfyUI 自己菜单里的「卸载模型 / 卸载模型和执行缓存」搬上页：
   * 未运行时禁用（对没在跑的实例发 /free 只会得到连接失败）、运行中可点、
   * 点谁调谁；卸载进行中（freeing）两颗一起禁用。 */
  describe("卸载模型 / 卸载模型和执行缓存", () => {
    it("未运行：两颗都禁用", () => {
      render(<ComfyuiControlView c={controller()} />);
      expect(screen.getByRole("button", { name: "卸载模型" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "卸载模型和执行缓存" })).toBeDisabled();
    });

    it("运行中：两颗可点，点谁调谁", () => {
      const unloadModels = vi.fn(() => Promise.resolve());
      const unloadModelsWithCache = vi.fn(() => Promise.resolve());
      render(
        <ComfyuiControlView
          c={controller({ status: running, unloadModels, unloadModelsWithCache })}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "卸载模型" }));
      fireEvent.click(screen.getByRole("button", { name: "卸载模型和执行缓存" }));
      expect(unloadModels).toHaveBeenCalledTimes(1);
      expect(unloadModelsWithCache).toHaveBeenCalledTimes(1);
    });

    it("卸载进行中（freeing）：两颗一起禁用，不并发发第二份请求", () => {
      render(<ComfyuiControlView c={controller({ status: running, freeing: true })} />);
      expect(screen.getByRole("button", { name: "卸载模型" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "卸载模型和执行缓存" })).toBeDisabled();
    });
  });
});
