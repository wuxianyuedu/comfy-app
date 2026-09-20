/**
 * 「`unknown` 是不是纯对象」的唯一出口（规范 16 §16.2.4.44）。
 *
 * 这两个判据的**边界就是它们的价值**：收口前 9 份实现全都把数组算成「是对象」
 *（`typeof [] === "object"`），而消费侧（`script-parse` / `api-channel-client`）
 * 另有 `Array.isArray` 判断。改判据会静默改变九处收窄结果 —— 所以两个函数
 * 分开、行为逐条钉住。
 */
import { describe, expect, it } from "vitest";

import { isPlainRecord, isRecord } from "./is-record";

describe("isRecord", () => {
  it("认对象与数组（与既有 9 处实现同口径）", () => {
    expect(isRecord({})).toBe(true);
    /* 数组是对象 —— 这一条**刻意**保留：调用方另行判 `Array.isArray`。 */
    expect(isRecord([])).toBe(true);
  });

  it("null / 基本类型 / 函数都不是", () => {
    expect(isRecord(null)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
    expect(isRecord("x")).toBe(false);
    expect(isRecord(1)).toBe(false);
    expect(isRecord(true)).toBe(false);
    /* `typeof function === "function"`，所以这条天然为 false。 */
    expect(isRecord(() => undefined)).toBe(false);
  });
});

describe("isPlainRecord", () => {
  it("排除数组（REST 请求体这一层要的是「对象」不是「数组」）", () => {
    expect(isPlainRecord({})).toBe(true);
    expect(isPlainRecord([])).toBe(false);
  });

  it("其余判据与 isRecord 一致", () => {
    expect(isPlainRecord(null)).toBe(false);
    expect(isPlainRecord("x")).toBe(false);
    expect(isPlainRecord(1)).toBe(false);
  });
});
