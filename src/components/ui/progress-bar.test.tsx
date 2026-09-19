// @vitest-environment jsdom
/**
 * 进度条基元的形态契约（规范 16 §16.2.4.19）。
 *
 * 收口前全库 10 处各写一遍「track + width:X% + 百分比文字」，写法四派 ——
 * 而**数值**怎么算（夹取 / 下级可见宽度 / 不确定）已收在 `~/lib/progress`
 * （见该文件的用例）。这里只钉**形态**这一半，重点是那些「散在 10 处就永远
 * 不会被统一说出来」的语义决定：
 *
 *   1. `value === null` 是**不确定态**（滑动条纹），不是 0% 空条；
 *   2. **a11y 语义由基元给**（收口前 10 处里只有 2 处声明了 `role`）/「不确定」态没有 `aria-valuenow`（它不该被读成一个数）；
 *   3. 宽度下限只抬非零值（`minVisible`）；
 *   4. 填充观感差异走 `fillClassName`，不重画轨道。
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { ProgressBar } from "./progress-bar";

afterEach(cleanup);

describe("ProgressBar 的确定态", () => {
  it("给出 role/aria-valuenow 与按值算出的宽度", () => {
    const { container } = render(<ProgressBar value={42} />);
    const track = container.querySelector('[data-slot="progress-bar-track"]')!;
    expect(track.getAttribute("role")).toBe("progressbar");
    expect(track.getAttribute("aria-valuenow")).toBe("42");
    expect(track.getAttribute("aria-valuemin")).toBe("0");
    expect(track.getAttribute("aria-valuemax")).toBe("100");
    const fill = container.querySelector<HTMLElement>(
      '[data-slot="progress-bar-fill"]',
    )!;
    expect(fill.style.width).toBe("42%");
  });

  it("标签与百分比同排；showValue=false 时不显示百分比", () => {
    const { container, rerender } = render(
      <ProgressBar value={30} label="正在生成" />,
    );
    expect(container.textContent).toContain("正在生成");
    expect(container.textContent).toContain("30%");

    rerender(<ProgressBar value={30} label="正在生成" showValue={false} />);
    expect(container.textContent).toContain("正在生成");
    expect(container.textContent).not.toContain("30%");
  });

  it("minVisible 只抬非零值：0% 就是空条", () => {
    const { container, rerender } = render(
      <ProgressBar value={0} minVisible={4} />,
    );
    const fill = () =>
      container.querySelector<HTMLElement>('[data-slot="progress-bar-fill"]')!;
    expect(fill().style.width).toBe("0%");
    rerender(<ProgressBar value={1} minVisible={4} />);
    expect(fill().style.width).toBe("4%");
  });

  it("超量值被夹取到 100（接口给 120 不溢出容器）", () => {
    const { container } = render(<ProgressBar value={120} />);
    const track = container.querySelector('[data-slot="progress-bar-track"]')!;
    expect(track.getAttribute("aria-valuenow")).toBe("100");
  });
});

describe("ProgressBar 的不确定态（value === null）", () => {
  it("渲染滑动条纹，而不是 0% 空条", () => {
    const { container } = render(<ProgressBar value={null} label="正在扫描" />);
    expect(
      container.querySelector('[data-slot="progress-bar-indeterminate"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-slot="progress-bar-fill"]'),
    ).toBeNull();
  });

  it("不给 aria-valuenow（不确定的进度不该被读成一个数），改给 valuetext", () => {
    const { container } = render(<ProgressBar value={null} />);
    const track = container.querySelector('[data-slot="progress-bar-track"]')!;
    expect(track.getAttribute("aria-valuenow")).toBeNull();
    expect(track.getAttribute("aria-valuetext")).toBe("进行中");
  });

  it("不确定态不显示百分比文字", () => {
    const { container } = render(<ProgressBar value={null} label="扫描中" />);
    expect(container.textContent).toContain("扫描中");
    expect(container.textContent).not.toContain("%");
  });
});

describe("ProgressBar 的外观可覆盖而不重画轨道", () => {
  it("fillClassName 落在填充上，trackClassName 落在轨道上", () => {
    const { container } = render(
      <ProgressBar
        value={50}
        trackClassName="bg-elevated h-1"
        fillClassName="bg-linear-to-r from-violet-500"
      />,
    );
    const track = container.querySelector('[data-slot="progress-bar-track"]')!;
    const fill = container.querySelector('[data-slot="progress-bar-fill"]')!;
    expect(track.className).toContain("bg-elevated");
    expect(track.className).toContain("h-1");
    expect(fill.className).toContain("bg-linear-to-r");
    /* 填充仍带基元的过渡与圆角（差异化不该把这两条也顶掉）。 */
    expect(fill.className).toContain("transition-all");
    expect(fill.className).toContain("rounded-full");
  });
});
