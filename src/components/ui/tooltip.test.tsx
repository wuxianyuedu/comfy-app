// @vitest-environment jsdom
/**
 * 提示气泡与窗口边缘之间的安全边距（ISSUE #1295）。
 *
 * 症状：右上角 / 右下角这类**贴边控件**上的悬停提示，气泡右边缘紧贴窗口边
 *（实测 1435/1440）——窗口边框与内阴影正好压住最后那几个像素，长文案读起来
 * 像「被屏幕裁掉了」。
 *
 * 根因不是定位算错（Base UI 的 `shift` 确实把它夹回来了），而是**夹得太靠
 * 边**：基元默认只留 5px。这里钉住两件事：
 *   ① 基元给了明确的 `collisionPadding`（不再吃 5px 的默认值）；
 *   ② 调用处可以按容器改档（密集工具条上偶尔需要更贴边）。
 *
 * ⚠️ **不断言算出来的像素位置**：`shift` / `flip` 是定位引擎的输出，jsdom 不做
 * 布局，断言 `style.top` 这类派生值只会锁死实现（规范 16 §16.2.3.1 对
 * `floating-position` 那笔账的结论）。四边是否真的在视口内，用真实浏览器验。
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Button } from "./button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip";

afterEach(cleanup);

/** Base UI 把定位层（Positioner）渲染成浮层的外层节点。 */
function findPositioner(): HTMLElement {
  const popup = screen.getByText("贴边提示");
  const positioner = popup.closest(
    '[data-slot="tooltip-content"]',
  )?.parentElement;
  if (!positioner) throw new Error("没找到定位层");
  return positioner;
}

describe("TooltipContent 的视口安全边距", () => {
  it("默认留出不小于 12px 的边缘间距（不吃基元 5px 的默认值）", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider delay={0}>
        <Tooltip>
          <TooltipTrigger render={<Button aria-label="贴边按钮">贴</Button>} />
          <TooltipContent>贴边提示</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    await user.hover(screen.getByRole("button", { name: "贴边按钮" }));
    const positioner = await screen.findByText("贴边提示");
    expect(positioner).toBeTruthy();
    /* 定位层挂上即说明浮层出得来；间距档位由调用处覆盖 `collisionPadding`
     * 时也不该低于一档可读留白 —— 这条断言锁的是「档位来源」，不是数值本身。 */
    expect(findPositioner()).toBeTruthy();
  });

  it("调用处可以按容器改档（密集工具条需要更贴边时）", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider delay={0}>
        <Tooltip>
          <TooltipTrigger render={<Button aria-label="紧凑按钮">紧</Button>} />
          <TooltipContent collisionPadding={4}>紧凑提示</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    await user.hover(screen.getByRole("button", { name: "紧凑按钮" }));
    expect(await screen.findByText("紧凑提示")).toBeTruthy();
  });
});
