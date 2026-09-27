// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

import { Button } from "./button";
import { Hint } from "./hint";
import { TooltipProvider } from "./tooltip";

afterEach(cleanup);

const wrap = (ui: ReactNode) => (
  <TooltipProvider delay={0}>{ui}</TooltipProvider>
);

/**
 * P82 出口（规范 16 §16.2.3）的回归：`Hint` 是「原生 `title=` → Tooltip」
 * 这条治理线唯一的落点，所以三件事必须钉住 ——
 *   ① 提示真的出得来（否则治理等于把文案删了）；
 *   ② 点击 / 禁用等原有交互不被 `TooltipTrigger` 的 render 接管吃掉；
 *   ③ 图标按钮的可访问名（规范 §6.1）在 `title=` 撤掉后仍然在。
 */
/** Base UI 的 tooltip 浮层不带 `role="tooltip"`（也不在 jsdom 里挂
 *  `aria-describedby`），所以按 `data-slot` 取那一层。 */
async function findHintPopup(text: string) {
  const popup = await screen.findByText(text);
  expect(popup.getAttribute("data-slot")).toBe("tooltip-content");
  return popup;
}

describe("Hint", () => {
  it("悬停出提示，文案落在浮层里而不是原生 title 属性上", async () => {
    const user = userEvent.setup();
    render(
      wrap(
        <Hint label="撤销这一步">
          <Button>撤销</Button>
        </Hint>,
      ),
    );
    const btn = screen.getByRole("button", { name: "撤销" });
    expect(btn).not.toHaveAttribute("title");
    await user.hover(btn);
    await findHintPopup("撤销这一步");
  });

  it("label 为空（undefined / 空串 / false）时不出浮层，按钮照常可点", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      wrap(
        <>
          <Hint label={undefined}>
            <Button onClick={onClick}>甲</Button>
          </Hint>
          <Hint label="">
            <Button onClick={onClick}>乙</Button>
          </Hint>
          <Hint label={false}>
            <Button onClick={onClick}>丙</Button>
          </Hint>
        </>,
      ),
    );
    for (const name of ["甲", "乙", "丙"]) {
      await user.hover(screen.getByRole("button", { name }));
      expect(
        document.querySelector('[data-slot="tooltip-content"]'),
      ).toBeNull();
    }
    await user.click(screen.getByRole("button", { name: "甲" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("纯图标按钮：accessibleName 把 label 同步成 aria-label（规范 §6.1）", () => {
    render(
      wrap(
        <Hint label="关闭" accessibleName>
          <Button>✕</Button>
        </Hint>,
      ),
    );
    expect(screen.getByRole("button", { name: "关闭" }).textContent).toBe("✕");
  });

  it("子元素已自带 aria-label 时不覆盖（调用处是更精确的判断）", () => {
    render(
      wrap(
        <Hint label="关闭此面板" accessibleName>
          <Button aria-label="关闭设置">✕</Button>
        </Hint>,
      ),
    );
    expect(
      screen.getByRole("button", { name: "关闭设置" }),
    ).toBeInTheDocument();
  });

  it("默认不补名：有可见文字的按钮不该出现「名字与可见文字不一致」", () => {
    render(
      wrap(
        <Hint label="按该条目配置探测接口连通性">
          <Button>探测</Button>
        </Hint>,
      ),
    );
    expect(screen.getByRole("button", { name: "探测" })).toBeInTheDocument();
  });

  it("onClick / disabled 原样透传到被接管的按钮上", () => {
    const onClick = vi.fn();
    render(
      wrap(
        <Hint label="已跑到默认连线">
          <Button onClick={onClick} disabled>
            重置
          </Button>
        </Hint>,
      ),
    );
    const btn = screen.getByRole("button", { name: "重置" });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("wrap：提示挂到锚点上，禁用按钮也能问出「为什么不能点」", async () => {
    const user = userEvent.setup();
    render(
      wrap(
        <Hint label="先选一条素材" wrap>
          <Button disabled>提取</Button>
        </Hint>,
      ),
    );
    expect(screen.getByRole("button", { name: "提取" })).toBeDisabled();
    await user.hover(
      screen.getByRole("button", { name: "提取" }).parentElement!,
    );
    await findHintPopup("先选一条素材");
  });
});
