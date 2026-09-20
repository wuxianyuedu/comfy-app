import { describe, expect, it, vi } from "vitest";
import {
  bindKey,
  checkedHandler,
  digitsOnly,
  numberHandler,
  readTextInput,
  textHandler,
} from "./form-props";

/** 造一个最小的事件对象（只带适配器要读的字段）。 */
const valueEvent = (value: string) => ({ target: { value } });
const checkedEvent = (checked: boolean) => ({ target: { checked } });

describe("form-props —— 事件值 → 值回调", () => {
  it("textHandler 把 target.value 交给回调", () => {
    const onValue = vi.fn();
    textHandler(onValue)(valueEvent("abc"));
    expect(onValue).toHaveBeenCalledWith("abc");
  });

  it("textHandler 的 transform 是显式的（过滤规则只有一处）", () => {
    const onValue = vi.fn();
    textHandler(onValue, digitsOnly)(valueEvent("1a2b3"));
    expect(onValue).toHaveBeenCalledWith("123");
  });

  it("textHandler 不带 transform 时也传原值（不复制、不裁剪）", () => {
    const onValue = vi.fn();
    textHandler(onValue)(valueEvent("  保留空格  "));
    expect(onValue).toHaveBeenCalledWith("  保留空格  ");
  });

  it("checkedHandler 读的是 target.checked（不是 value）", () => {
    const onValue = vi.fn();
    checkedHandler(onValue)(checkedEvent(true));
    expect(onValue).toHaveBeenCalledWith(true);
  });

  it("numberHandler 能读出的值原样交出去", () => {
    const onValue = vi.fn();
    numberHandler(onValue, 0)(valueEvent("42.5"));
    expect(onValue).toHaveBeenCalledWith(42.5);
  });

  it("numberHandler 读不出来时用调用处给的 fallback（不是 0 / NaN）", () => {
    const onValue = vi.fn();
    numberHandler(onValue, 5)(valueEvent("abc"));
    expect(onValue).toHaveBeenCalledWith(5);
  });

  it("numberHandler 对空串走 fallback —— 清空输入框不等于设为 0", () => {
    const onValue = vi.fn();
    numberHandler(onValue, 7)(valueEvent(""));
    expect(onValue).toHaveBeenCalledWith(7);
    numberHandler(onValue, 7)(valueEvent("   "));
    expect(onValue).toHaveBeenCalledWith(7);
  });

  it("numberHandler 不把 Infinity 交出去", () => {
    const onValue = vi.fn();
    numberHandler(onValue, 1)(valueEvent("Infinity"));
    expect(onValue).toHaveBeenCalledWith(1);
  });

  it("bindKey 把值绑到指定的键上", () => {
    const patch = vi.fn();
    bindKey<{ model: string; base: string }, "model">(patch, "model")("m1");
    expect(patch).toHaveBeenCalledWith({ model: "m1" });
  });

  it("readTextInput 就地取值并返回 void（事件仍归调用处）", () => {
    const onValue = vi.fn();
    const event = valueEvent("hi");
    expect(readTextInput(event, onValue)).toBeUndefined();
    expect(onValue).toHaveBeenCalledWith("hi");
  });

  it("digitsOnly 只留数字：小数 / 负号 / 空格都去掉", () => {
    expect(digitsOnly("12.5")).toBe("125");
    expect(digitsOnly("-3")).toBe("3");
    expect(digitsOnly(" 4 5 ")).toBe("45");
    expect(digitsOnly("")).toBe("");
  });
});
