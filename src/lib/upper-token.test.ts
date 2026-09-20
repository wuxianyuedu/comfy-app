/**
 * 大写归一的判据（规范 16 §16.2.4.64）。
 *
 * 这条账的实质是**「要不要吃空白」这一个决定，却决定匹配成败**：
 * ComfyUI 的类型字段带尾随空白、模式码来自用户输入，而收口前同一个文件里
 * `trim` 与不 `trim` 两种写法并存 —— 同一个模式码，一处匹配得上、一处匹配不上。
 */
import { describe, expect, it } from "vitest";

import { upperToken, upperTokenOr } from "./upper-token";

describe("upperToken", () => {
  it("吃前后空白（本条账唯一的口径）", () => {
    expect(upperToken(" image ")).toBe("IMAGE");
    expect(upperToken("\tINT\n")).toBe("INT");
  });

  it("折大写", () => {
    expect(upperToken("float")).toBe("FLOAT");
    expect(upperToken("Float")).toBe("FLOAT");
  });

  it("缺省给空串（`null` / `undefined` / 非字符串都算缺省）", () => {
    expect(upperToken(null)).toBe("");
    expect(upperToken(undefined)).toBe("");
    expect(upperToken("")).toBe("");
    expect(upperToken("   ")).toBe("");
  });

  it('接受 unknown —— 替调用处承担 `typeof === "string"` 的守卫', () => {
    /* 这是本出口相对手写版的一处**收窄**：`rec.mode` 这类外来值的类型是
     * `unknown`，手写版各写一遍 `typeof x === "string" ? … : ""`。 */
    expect(upperToken(42)).toBe("");
    expect(upperToken({ mode: "x" })).toBe("");
    expect(upperToken(["X"])).toBe("");
    expect(upperToken(true)).toBe("");
  });

  it("不折内部分隔符（`t2v` 与 `T2V` 是同一个码，`t-2-v` 不是）", () => {
    expect(upperToken("t2v")).toBe("T2V");
    expect(upperToken("t-2-v")).toBe("T-2-V");
  });
});

describe("upperTokenOr", () => {
  it("缺省给具名兜底（默认 `*`）", () => {
    expect(upperTokenOr(undefined)).toBe("*");
    expect(upperTokenOr("")).toBe("*");
    expect(upperTokenOr(null, "INT")).toBe("INT");
  });

  it("有值时与 upperToken 同口径", () => {
    expect(upperTokenOr(" image ")).toBe("IMAGE");
    expect(upperTokenOr(" int ", "FLOAT")).toBe("INT");
  });

  it("兜底不做 trim / 大写（它是调用处自己的常量）", () => {
    expect(upperTokenOr(undefined, " int ")).toBe(" int ");
  });
});
