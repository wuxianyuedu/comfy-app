// @vitest-environment jsdom
/**
 * `Disclosure` —— 「点一行标题、把一段内容折叠 / 展开」的唯一实现
 * （规范 16 §16.2.4.13）。
 *
 * 收口前有三种写法（原生 `<details>` 六处、自绘 `role="button"` + `▸/▾`
 * 四处、树形 `expanded*` 映射两份），差别不是风格而是**无障碍语义各写各的**：
 * 自绘那份基本只有 `onClick`。所以这里逐条钉住基元**替调用处实现的那几件事**，
 * 而不是去断言某个调用点的外观。
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { Disclosure } from "./disclosure";

afterEach(cleanup);

describe("Disclosure", () => {
  it("默认收起：面板内容不在可见树里，触发按钮 aria-expanded=false", () => {
    render(
      <Disclosure trigger="展开细节">
        <p>隐藏的内容</p>
      </Disclosure>,
    );
    const trigger = screen.getByRole("button", { name: /展开细节/ });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("点击触发按钮展开 / 收起，aria-expanded 跟着变", () => {
    render(
      <Disclosure trigger="展开细节">
        <p>隐藏的内容</p>
      </Disclosure>,
    );
    const trigger = screen.getByRole("button", { name: /展开细节/ });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("defaultOpen 时初始展开", () => {
    render(
      <Disclosure defaultOpen trigger="已展开">
        <p>内容</p>
      </Disclosure>,
    );
    expect(screen.getByRole("button", { name: /已展开/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("受控：open / onOpenChange 由调用处持有（外部状态驱动）", () => {
    let opened: boolean | null = null;
    render(
      <Disclosure
        open={false}
        onOpenChange={(next) => {
          opened = next;
        }}
        trigger="受控开关"
      >
        <p>内容</p>
      </Disclosure>,
    );
    const trigger = screen.getByRole("button", { name: /受控开关/ });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    /* 受控时基元不自己改：只把意图报出来。 */
    fireEvent.click(trigger);
    expect(opened).toBe(true);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("面板用 hidden=until-found 隐藏（保留浏览器页内查找自动展开）", () => {
    const { container } = render(
      <Disclosure trigger="展开">
        <p data-testid="body">正文</p>
      </Disclosure>,
    );
    const panel = container.querySelector('[data-slot="disclosure-panel"]');
    expect(panel).not.toBeNull();
    /* `hidden="until-found"` 是原生 `<details>` 那条最值钱的语义 ——
     * 换成自绘「条件渲染」就丢了（规范 16 §16.2.4.13）。 */
    expect(panel?.getAttribute("hidden")).toBe("until-found");
  });

  it("marker=caret 时输出 ▸/▾ 两个形态（由 aria-expanded 切换，不靠 JS 条件类）", () => {
    const { container } = render(
      <Disclosure marker="caret" trigger="标题">
        <p>内容</p>
      </Disclosure>,
    );
    const markers = container.querySelectorAll(
      '[data-slot="disclosure-marker"]',
    );
    expect(markers.length).toBe(2);
  });

  it("marker=none 时不出标记（调用处自己画）", () => {
    const { container } = render(
      <Disclosure marker="none" trigger="标题">
        <p>内容</p>
      </Disclosure>,
    );
    expect(
      container.querySelectorAll('[data-slot="disclosure-marker"]').length,
    ).toBe(0);
  });

  it("disabled 时点不动，也不改 aria-expanded", () => {
    render(
      <Disclosure disabled trigger="禁用开关">
        <p>内容</p>
      </Disclosure>,
    );
    const trigger = screen.getByRole("button", { name: /禁用开关/ });
    /* base-ui 的 disabled 是 `aria-disabled`（不是原生 `disabled`）——
     * 这样键盘仍能聚焦到它，读屏器会读出「不可用」而不是静默跳过。 */
    expect(trigger).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("leading / trailing 与触发器同排 —— 一排按钮里只有一个是折叠开关", () => {
    render(
      <Disclosure
        leading={<button type="button">重试</button>}
        trailing={<button type="button">复制</button>}
        trigger="完整错误"
      >
        <p>详情</p>
      </Disclosure>,
    );
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复制" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /完整错误/ }),
    ).toBeInTheDocument();
    /* 关键：两个并列动作**不在**折叠触发按钮内部 —— 否则点它们会一并折叠，
     * 且 `<button>` 套 `<button>` 是非法 HTML（这正是自绘那份绕不过去的坑）。 */
    const trigger = screen.getByRole("button", { name: /完整错误/ });
    expect(trigger.querySelector("button")).toBeNull();
  });
});
