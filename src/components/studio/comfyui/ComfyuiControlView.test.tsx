// ComfyUI 运行页的**可见行为**（ISSUE #1900）。
//
// 这一屏的风险全在「状态 → 该按哪颗」这条投影上：投影错了不会报错，只是用户
// 点了一颗点不动的按钮、或者看不见「正在启动」。所以断言挑的是那几件**看一眼
// 才知道对不对**的事：
//   · 四态文案（运行中 / 正在启动 / 检测中 / 未运行）各自说得出；
//   · 「启动 / 关闭」这对互斥主行动：当前这一态该按的那颗才实心，另一颗禁用；
//   · 未配置路径时启动禁用，且**给出**去设置页配置的出口（不是一颗点不动的按钮）；
//   · 启动日志框在页上（硬规则 4：失败路径必须有用户可见出口）；
//   · 页上写出「这一点下去会按哪条**已保存**路径启动」—— 它是「改了路径没保存」
//     这个组合就地可见的那一份事实（本页无草稿，见 ComfyuiControlView 文件头）。
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
  const actual =
    await vi.importActual<Record<string, unknown>>("~/lib/app-events");
  return { ...actual, emitAppEvent: emitAppEventMock };
});

/* 本仓不在 setup 里注册自动 cleanup（`globals: false`），每份用例自己收尾 ——
   与 RuntimeLogBox.test.tsx / AppearanceSection.test.tsx 同款。 */
afterEach(cleanup);
beforeEach(() => {
  emitCalls.length = 0;
});

function controller(
  over: Partial<ComfyuiControlController> = {},
): ComfyuiControlController {
  return {
    status: null,
    instance: {
      pathConfigured: true,
      instanceType: "portable",
      desktopManaged: false,
    },
    starting: false,
    stopping: false,
    opening: false,
    browserOpening: false,
    startComfy: vi.fn(async () => undefined),
    stopComfy: vi.fn(async () => undefined),
    openComfy: vi.fn(async () => undefined),
    openComfyInBrowser: vi.fn(async () => undefined),
    refreshStatus: vi.fn(async () => undefined),
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
      refresh: vi.fn(async () => undefined),
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
  path: "D:\\ComfyUI",
};

describe("ComfyuiControlView", () => {
  it("未运行：说明「未运行」，「启动」是当态唯一实心主行动", () => {
    render(<ComfyuiControlView c={controller()} />);
    expect(screen.getByText("ComfyUI 未运行")).toBeInTheDocument();
    const start = screen.getByRole("button", { name: "启动 ComfyUI" });
    const stop = screen.getByRole("button", { name: "关闭 ComfyUI" });
    expect(start).toBeEnabled();
    expect(stop).toBeDisabled();
    /* 实心档只有一颗：`primary-solid`（实心底 `bg-primary-500`）是「当前这一态
       该按的那颗」的编码，而软底档是 `bg-primary-500/15`。两颗都实心时用户无从
       判断该点哪个（ISSUE #423 同族）。 */
    expect(start.className).toContain("bg-primary-500 ");
    expect(stop.className).toContain("bg-primary-500/15");
  });

  it("运行中：文案带上地址与启动方式，「关闭」接替为实心主行动", () => {
    render(<ComfyuiControlView c={controller({ status: running })} />);
    const text = screen.getByText(/ComfyUI 运行中/);
    expect(text.textContent).toContain("http://127.0.0.1:8188");
    expect(text.textContent).toContain("配置路径的实例");
    const start = screen.getByRole("button", { name: "启动 ComfyUI" });
    const stop = screen.getByRole("button", { name: "关闭 ComfyUI" });
    expect(start).toBeDisabled();
    expect(stop).toBeEnabled();
    expect(stop.className).toContain("bg-primary-500 ");
    expect(start.className).toContain("bg-primary-500/15");
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
            path: "D:\\ComfyUI",
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
          },
        })}
      />,
    );
    expect(screen.getByRole("button", { name: "启动 ComfyUI" })).toBeDisabled();
    expect(screen.getByText(/还没配置 ComfyUI 路径/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /去设置里配置/ }),
    ).toBeInTheDocument();
  });

  it("点「去设置里配置」带上目标分区：直接停在「创作后端」那一节", () => {
    render(
      <ComfyuiControlView
        c={controller({
          instance: {
            pathConfigured: false,
            instanceType: null,
            desktopManaged: false,
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

  it("页上写明将按哪条已保存路径启动（本页无草稿，这条是唯一的事实出口）", () => {
    render(<ComfyuiControlView c={controller({ status: running })} />);
    const line = screen.getByTestId("comfyui-start-path");
    expect(line.textContent).toContain("D:\\ComfyUI");
    /* 明写「已保存」这一层语义：用户刚在设置页改了路径没保存时，这里显示的
       仍是旧路径，那句「改完要点保存」就是给他看的。 */
    expect(line.textContent).toContain("已保存");
    expect(line.textContent).toContain("保存");
  });

  it("路径还没保存时不说「按空路径启动」，而是指出去哪配", () => {
    render(
      <ComfyuiControlView
        c={controller({
          status: { ...running, up: false, path: "" },
        })}
      />,
    );
    const line = screen.getByTestId("comfyui-start-path");
    expect(line.textContent).toContain("尚未保存");
    expect(line.textContent).not.toContain("将按这条已保存路径拉起");
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
    expect(
      screen.getByText("启动日志（comfyui-runtime.log）"),
    ).toBeInTheDocument();
    expect(screen.getByText(/暂无日志/)).toBeInTheDocument();
  });
});
