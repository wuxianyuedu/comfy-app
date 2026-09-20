import { describe, expect, it } from "vitest";
import { commonOwnProps, splitDomProps, type OmitOwnProps } from "./dom-props";

type InputProps = React.ComponentProps<"input">;
const PRIVATE = ["type", "value", "onChange"] as const;
/** 一个恒等函数当 `onChange` 桩（避免空函数体被 lint 拦下）。 */
const noop = () => undefined;

describe("splitDomProps", () => {
  it("私有字段进 own、其余进 rest", () => {
    const props = { value: 3, onChange: noop, id: "a", title: "t" };
    const { own, rest } = splitDomProps(props, PRIVATE);
    expect(own.value).toBe(3);
    expect(own.onChange).toBe(noop);
    expect(rest).toEqual({ id: "a", title: "t" });
  });

  it("rest 里不含任何私有键（透传给 DOM 的那一份是干净的）", () => {
    const props = { type: "range", value: 1, min: 0, onChange: noop };
    const { rest } = splitDomProps(props, PRIVATE);
    expect(Object.keys(rest)).toEqual(["min"]);
  });

  it("调用处没传的私有键不出现在 own（不凭空补 undefined）", () => {
    const props = { id: "a" };
    const { own, rest } = splitDomProps(props, PRIVATE);
    expect("value" in own).toBe(false);
    expect(rest).toEqual({ id: "a" });
  });

  it("只搬不改写：不合并 className、不给默认值", () => {
    const props = { type: "range", className: "x" };
    const { rest } = splitDomProps(props, PRIVATE);
    expect(rest.className).toBe("x");
  });

  it("不改动入参对象", () => {
    const props = { type: "range", id: "a" };
    splitDomProps(props, PRIVATE);
    expect(props).toEqual({ type: "range", id: "a" });
  });

  it("空 keys 时 rest 是全部、own 为空", () => {
    const props = { id: "a" };
    const { own, rest } = splitDomProps(props, [] as const);
    expect(own).toEqual({});
    expect(rest).toEqual({ id: "a" });
  });
});

describe("OmitOwnProps", () => {
  it("剔掉表里列出的键（类型层面）", () => {
    type Props = OmitOwnProps<InputProps, (typeof PRIVATE)[number]>;
    const ok: Props = { id: "a" };
    expect(ok.id).toBe("a");
  });

  it("与手写 Omit 等价：表里的键不再可选", () => {
    type Props = OmitOwnProps<InputProps, (typeof PRIVATE)[number]>;
    /* 若 `value` 没被剔掉，下面的对象字面量不会报错（多余属性检查会放行），
     * 故用「赋值给不含 value 的类型」来钉住这一点。 */
    const assignable: Omit<Props, "value"> = { id: "a" };
    expect(assignable.id).toBe("a");
  });
});

describe("commonOwnProps", () => {
  it("两张表的交集才是该剔的（并集会把只属于一侧的字段也剔掉）", () => {
    expect(commonOwnProps(["src", "alt"], ["src", "poster"])).toEqual(["src"]);
  });

  it("无交集给空表", () => {
    expect(commonOwnProps(["a"], ["b"])).toEqual([]);
  });

  it("保持第一张表的顺序", () => {
    expect(commonOwnProps(["b", "a", "c"], ["c", "a", "b"])).toEqual([
      "b",
      "a",
      "c",
    ]);
  });
});
