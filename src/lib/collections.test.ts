import { describe, expect, it } from "vitest";
import { getOrCreate, getOrThrow } from "./collections";

describe("getOrCreate", () => {
  it("键不存在时用工厂建桶、写入并返回", () => {
    const map = new Map<string, number[]>();
    const bucket = getOrCreate(map, "a", () => []);
    bucket.push(1);
    expect(map.get("a")).toEqual([1]);
  });

  it("键已存在时返回原桶、不重复新建", () => {
    const map = new Map<string, number[]>();
    const first = getOrCreate(map, "a", () => []);
    first.push(1);
    const second = getOrCreate(map, "a", () => [999]);
    // 工厂不该被调用，拿回的仍是同一桶
    expect(second).toBe(first);
    expect(second).toEqual([1]);
  });

  it("不同键各自建桶、互不串桶", () => {
    const map = new Map<string, Set<string>>();
    getOrCreate(map, "x", () => new Set()).add("1");
    getOrCreate(map, "y", () => new Set()).add("2");
    expect([...map.get("x")!]).toEqual(["1"]);
    expect([...map.get("y")!]).toEqual(["2"]);
  });
});

describe("getOrThrow", () => {
  it("命中时返回原值", () => {
    const map = new Map<string, { v: number }>();
    const obj = { v: 7 };
    map.set("k", obj);
    expect(getOrThrow(map, "k", "找不到")).toBe(obj);
  });

  it("缺失时抛带上下文与键名的错误（替代静默的 !）", () => {
    const map = new Map<string, number>();
    expect(() => getOrThrow(map, "missing", "节点表里缺")).toThrow(
      "节点表里缺（键：missing）",
    );
  });
});
