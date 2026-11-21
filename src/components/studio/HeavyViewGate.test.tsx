/* 重视图「非活跃降级」闸的单测（ISSUE #4677，#4598 的期望第 3 条）。
 * 钉四件事：① 活跃渲染 / 非活跃摘除；② 隐藏期间组件状态保留、切回原样恢复；
 * ③ 隐藏期父级重渲染不再触碰子树（Profiler 提交数不涨——这就是「隐藏期渲染
 * 次数下降」的读数）；④ 滚动位置在切回时按路径回放（约束里点名的一项）。 */

import { cleanup, fireEvent, render } from "@testing-library/react";
import { Profiler, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { HeavyViewGate } from "./HeavyViewGate";

afterEach(cleanup);

describe("HeavyViewGate（ISSUE #4677）", () => {
  it("非活跃时子树保留在 DOM 里但被隐藏（display:none，滚动位置因此原生保留）", () => {
    /** 元素自身或任一祖先被置 display:none 即视为隐藏（React 把样式挂在哪层不算细节）。 */
    function isHidden(el: Element): boolean {
      let node: Element | null = el;
      while (node !== null) {
        if (node instanceof HTMLElement && node.style.display === "none") {
          return true;
        }
        node = node.parentElement;
      }
      return false;
    }
    const { rerender, getByText } = render(
      <HeavyViewGate active>
        <p>完整子树</p>
      </HeavyViewGate>,
    );
    expect(isHidden(getByText("完整子树"))).toBe(false);

    rerender(
      <HeavyViewGate active={false}>
        <p>完整子树</p>
      </HeavyViewGate>,
    );
    /* React 19.3 的 Activity hidden = 保留 DOM + 置 display:none（不是摘除）：
     * 滚动位置因此原生保留（见下面的滚动用例）。 */
    expect(isHidden(getByText("完整子树"))).toBe(true);

    rerender(
      <HeavyViewGate active>
        <p>完整子树</p>
      </HeavyViewGate>,
    );
    expect(isHidden(getByText("完整子树"))).toBe(false);
  });

  it("隐藏期间组件状态保留，切回原样恢复（表单草稿那一类）", () => {
    /** 一枚带内部状态的探针：点一下 +1。 */
    function Counter() {
      const [n, setN] = useState(0);
      return (
        <button
          onClick={() => {
            setN(n + 1);
          }}
          type="button"
        >
          点了 {n} 次
        </button>
      );
    }
    const { rerender, getByRole, queryByRole } = render(
      <HeavyViewGate active>
        <Counter />
      </HeavyViewGate>,
    );
    fireEvent.click(getByRole("button"));
    expect(getByRole("button").textContent).toContain("1");

    rerender(
      <HeavyViewGate active={false}>
        <Counter />
      </HeavyViewGate>,
    );
    expect(queryByRole("button")).toBeNull();

    rerender(
      <HeavyViewGate active>
        <Counter />
      </HeavyViewGate>,
    );
    expect(getByRole("button").textContent).toContain("1");
  });

  it("隐藏期父级重渲染不再触碰子树（Profiler 提交数不涨——渲染次数读数）", () => {
    const commits: Array<number> = [];
    /** 外层带一个会变的 prop，逼父级（闸）重渲染；子树若被渲染，Profiler 记一笔。 */
    function Harness({ active, tick }: { active: boolean; tick: number }) {
      return (
        <HeavyViewGate active={active}>
          <Profiler
            id="heavy-child"
            onRender={() => {
              commits.push(tick);
            }}
          >
            <p>第 {tick} 拍</p>
          </Profiler>
        </HeavyViewGate>
      );
    }
    const { rerender } = render(<Harness active tick={1} />);
    /* 活跃期：父级每重渲染一拍，子树跟着渲染一笔。 */
    rerender(<Harness active tick={2} />);
    rerender(<Harness active tick={3} />);
    const activePhaseCommits = commits.length;
    expect(activePhaseCommits).toBeGreaterThanOrEqual(3);

    /* 隐藏期：同样连拍三笔，隐藏中的子树一次都不该被渲染。 */
    rerender(<Harness active={false} tick={4} />);
    const afterHide = commits.length;
    rerender(<Harness active={false} tick={5} />);
    rerender(<Harness active={false} tick={6} />);
    rerender(<Harness active={false} tick={7} />);
    expect(commits.length).toBe(afterHide);
    expect(commits.filter((tick) => tick >= 4)).toEqual([]);
  });

  it("滚动位置：切走前记下、切回时按路径回放", () => {
    const { rerender, getByTestId } = render(
      <HeavyViewGate active>
        <div data-testid="scroller" style={{ height: 100, overflowY: "auto" }}>
          <div style={{ height: 5000 }} />
        </div>
      </HeavyViewGate>,
    );
    const scroller = getByTestId("scroller");
    scroller.scrollTop = 500;
    /* 真浏览器的滚动会发 scroll 事件；这里手动派发同一形状（jsdom 不自动发）。 */
    fireEvent.scroll(scroller);

    rerender(
      <HeavyViewGate active={false}>
        <div data-testid="scroller" style={{ height: 100, overflowY: "auto" }}>
          <div style={{ height: 5000 }} />
        </div>
      </HeavyViewGate>,
    );
    rerender(
      <HeavyViewGate active>
        <div data-testid="scroller" style={{ height: 100, overflowY: "auto" }}>
          <div style={{ height: 5000 }} />
        </div>
      </HeavyViewGate>,
    );
    expect(getByTestId("scroller").scrollTop).toBe(500);
  });

  it("多个滚动容器各自回放，互不串位", () => {
    const { rerender, getByTestId } = render(
      <HeavyViewGate active>
        <div data-testid="left" style={{ height: 100, overflowY: "auto" }}>
          <div style={{ height: 5000 }} />
        </div>
        <div data-testid="right" style={{ height: 100, overflowY: "auto" }}>
          <div style={{ height: 5000 }} />
        </div>
      </HeavyViewGate>,
    );
    const left = getByTestId("left");
    const right = getByTestId("right");
    left.scrollTop = 111;
    fireEvent.scroll(left);
    right.scrollTop = 222;
    fireEvent.scroll(right);

    rerender(
      <HeavyViewGate active={false}>
        <div data-testid="left" style={{ height: 100, overflowY: "auto" }}>
          <div style={{ height: 5000 }} />
        </div>
        <div data-testid="right" style={{ height: 100, overflowY: "auto" }}>
          <div style={{ height: 5000 }} />
        </div>
      </HeavyViewGate>,
    );
    rerender(
      <HeavyViewGate active>
        <div data-testid="left" style={{ height: 100, overflowY: "auto" }}>
          <div style={{ height: 5000 }} />
        </div>
        <div data-testid="right" style={{ height: 100, overflowY: "auto" }}>
          <div style={{ height: 5000 }} />
        </div>
      </HeavyViewGate>,
    );
    expect(getByTestId("left").scrollTop).toBe(111);
    expect(getByTestId("right").scrollTop).toBe(222);
  });
});
