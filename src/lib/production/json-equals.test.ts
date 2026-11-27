/** jsonEquals 的行为契约（#5224 A5）：键序无关、`undefined` 视同缺键、数组保序。
 *  原实现直接 `JSON.stringify` 比字符串，同一份内容换个键序就被判成「变了」，
 *  在桥接层会白写一列，在历史列表会让 memo 的卡片整批失效。 */
import { describe, expect, it } from "vitest";

import { jsonEquals } from "./json-equals";

describe("jsonEquals", () => {
  it("键序不同的等价对象判相等", () => {
    expect(jsonEquals({ a: 1, b: { c: 2 } }, { b: { c: 2 }, a: 1 })).toBe(true);
  });

  it("undefined 属性与缺键同义", () => {
    expect(jsonEquals({ a: 1, b: undefined }, { a: 1 })).toBe(true);
  });

  it("数组保序：顺序不同判不等", () => {
    expect(jsonEquals([1, 2], [2, 1])).toBe(false);
  });

  it("标量与原实现一致", () => {
    expect(jsonEquals(42, 42)).toBe(true);
    expect(jsonEquals("x", "y")).toBe(false);
    expect(jsonEquals(null, {})).toBe(false);
  });

  it("对象内的 undefined 值不因键序错位而误判", () => {
    expect(jsonEquals({ a: undefined, b: 1 }, { b: 1 })).toBe(true);
  });

  it("对象内的 undefined 与 null 不等；顶层保原口径（都序列化成 null）", () => {
    expect(jsonEquals({ a: undefined }, { a: null })).toBe(false);
    expect(jsonEquals(undefined, null)).toBe(true);
  });

  it("嵌套数组与对象混合结构", () => {
    const left = { shots: [{ id: "1", params: { b: 2, a: 1 } }] };
    const right = { shots: [{ id: "1", params: { a: 1, b: 2 } }] };
    expect(jsonEquals(left, right)).toBe(true);
  });
});
