/**
 * 「对象渲染成键值行」的形态契约（规范 16 §16.2.4.20）。
 *
 * 收口前全库 5 处各写一遍「标签 + 值 + 空值占位」的行，四种布局语言。
 * 「空值显示什么」早由 `~/lib/display-value` 收口（P8），所以这里钉的是
 * **布局**那一半 —— 以及那几条「散在 5 处就不会被统一说出来」的语义：
 *
 *   1. `raw` 走 `displayValue`（缺值给 `—`），`value` 原样；
 *   2. 值走**截断**而不是撑破容器（长图片名 / 长 JSON 不该把行挤爆）；
 *   3. `table` 用 `<th scope="row">`（手写那份用的是 `<td>`，语义是空的）；
 *   4. 空数组整块不渲染（不留一个空壳边框）。
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { KeyValueRows } from "./key-value-rows";

afterEach(cleanup);

describe("值与缺值", () => {
  it('raw 走 displayValue：null / undefined / "" 给占位符', () => {
    const { container } = render(
      <KeyValueRows
        items={[
          { key: "a", raw: null },
          { key: "b", raw: undefined },
          { key: "c", raw: "" },
          { key: "d", raw: 0 },
        ]}
      />,
    );
    const texts = Array.from(container.querySelectorAll("span")).map(
      (s) => s.textContent,
    );
    expect(texts.filter((s) => s === "—")).toHaveLength(3);
    /* `0` 是真实值，照常显示（与 displayValue 的口径一致）。 */
    expect(texts).toContain("0");
  });

  it("value（已渲染节点）原样渲染，不被 displayValue 改写", () => {
    const { container } = render(
      <KeyValueRows
        items={[{ key: "k", value: <em data-testid="custom">自定义</em> }]}
      />,
    );
    expect(container.querySelector('[data-testid="custom"]')).not.toBeNull();
    expect(container.textContent).not.toContain("—");
  });
});

describe("rows 布局（缺省）", () => {
  it("标签左、值右，值走等宽字体", () => {
    const { container } = render(
      <KeyValueRows bordered striped items={[{ key: "Seed", raw: 12345 }]} />,
    );
    const row = container.querySelector("div > div")!;
    expect(row.textContent).toContain("Seed");
    expect(row.textContent).toContain("12345");
    const value = row.querySelector("span:last-child")!;
    expect(value.className).toContain("font-mono");
    expect(value.className).toContain("truncate");
  });

  it("mono=false 时值不走等宽（文案类字段）", () => {
    const { container } = render(
      <KeyValueRows mono={false} items={[{ key: "模型", raw: "anime" }]} />,
    );
    const value = container.querySelector("span:last-child")!;
    expect(value.className).not.toContain("font-mono");
  });
});

describe("stacked 布局", () => {
  it("标签在值上方，hint 渲染在值下面", () => {
    const { container } = render(
      <KeyValueRows
        layout="stacked"
        items={[{ key: "触发词", raw: "abc", hint: "本次真实值" }]}
      />,
    );
    expect(container.textContent).toContain("触发词");
    expect(container.textContent).toContain("abc");
    expect(container.textContent).toContain("本次真实值");
    const item = container.firstElementChild!.firstElementChild!;
    expect(item.className).toContain("flex-col");
  });

  it("columns 只影响网格列数", () => {
    const { container, rerender } = render(
      <KeyValueRows layout="stacked" columns={3} items={[{ key: "a" }]} />,
    );
    expect(container.firstElementChild!.className).toContain("sm:grid-cols-3");
    rerender(
      <KeyValueRows layout="stacked" columns={1} items={[{ key: "a" }]} />,
    );
    expect(container.firstElementChild!.className).toContain("grid-cols-1");
  });
});

describe("table 布局", () => {
  it("用真实 table 且行表头是 th[scope=row]", () => {
    const { container } = render(
      <KeyValueRows layout="table" items={[{ key: "seed", value: "12345" }]} />,
    );
    expect(container.querySelector("table")).not.toBeNull();
    const th = container.querySelector("th")!;
    expect(th.getAttribute("scope")).toBe("row");
    expect(th.textContent).toBe("seed");
    expect(container.querySelector("td")!.textContent).toBe("12345");
  });
});

describe("inline 布局与空块", () => {
  it("inline 把标签与值挤在一行", () => {
    const { container } = render(
      <KeyValueRows layout="inline" items={[{ key: "内存", raw: "1.2 GB" }]} />,
    );
    expect(container.firstElementChild!.className).toContain("inline-flex");
    expect(container.textContent).toContain("内存");
    expect(container.textContent).toContain("1.2 GB");
  });

  it("空数组整块不渲染（不留空壳边框）", () => {
    const { container } = render(<KeyValueRows bordered items={[]} />);
    expect(container.firstElementChild).toBeNull();
  });
});

describe("键可以是已渲染节点（含徽标），并可用 id 定 React key", () => {
  it("节点形式的键原样渲染", () => {
    const { container } = render(
      <KeyValueRows
        items={[
          {
            id: "x",
            key: <span data-testid="kv-badge">必填</span>,
            value: "target",
          },
        ]}
      />,
    );
    expect(container.querySelector('[data-testid="kv-badge"]')).not.toBeNull();
    expect(container.textContent).toContain("target");
  });
});
