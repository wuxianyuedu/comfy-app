/**
 * 「把一组值写成查询串」的唯一出口（规范 16 §16.2.4.32）。
 *
 * 用例钉的是**四个语义决定** —— 收口前 `URLSearchParams` 与手拼模板串
 * 两种写法在这四件事上各判各的，而服务端对它们的反应不同：
 *  ① 哪些键会被省略（`undefined` / 空串）；
 *  ② 数字 `0` 与 `false` 是**值**不是缺值；
 *  ③ 编码是出口的责任（调用处漏一处 `encodeURIComponent` 就是静默打错端点）；
 *  ④ 重复键的表达（数组 → `a=1&a=2`）。
 */
import { describe, expect, it } from "vitest";

import { buildQueryString, readQueryParam, withQuery } from "./query-string";

describe("buildQueryString", () => {
  it("按声明顺序拼键值对，不带前导 ?", () => {
    expect(buildQueryString({ filename: "a.png", type: "input" })).toBe(
      "filename=a.png&type=input",
    );
  });

  it('undefined / null 省略整个键（不写成 "undefined"）', () => {
    /* 这正是 `URLSearchParams` 与手拼写法最容易分叉的一点：
     * `new URLSearchParams({ a: undefined })` 会产出 `a=undefined`。 */
    expect(buildQueryString({ a: "1", b: undefined, c: null })).toBe("a=1");
    expect(buildQueryString({ a: undefined })).toBe("");
  });

  it("空串默认省略（空串与「不传」在服务端是同一个意思）", () => {
    expect(buildQueryString({ q: "", folder: "docs" })).toBe("folder=docs");
  });

  it("keepEmpty 让空串留下那个键（服务端把空串当一次有效输入时用）", () => {
    expect(buildQueryString({ q: "" }, { keepEmpty: true })).toBe("q=");
  });

  it("数字 0 与布尔 false 都是真实的值，不被当成缺值", () => {
    /* 与 `~/lib/display-value` 的 `0` 判据同源：省略 `offset=0` 会让服务端
     * 按自己的默认游标回答，那是另一件事。 */
    expect(buildQueryString({ offset: 0 })).toBe("offset=0");
    expect(buildQueryString({ all: false })).toBe("all=false");
    expect(buildQueryString({ all: true })).toBe("all=true");
  });

  it("值一律编码（# / & / 中文 / 空格都不能裸奔）", () => {
    expect(buildQueryString({ filename: "sub#dir&x.png" })).toBe(
      "filename=sub%23dir%26x.png",
    );
    expect(buildQueryString({ q: "角色 参考" })).toBe(
      "q=%E8%A7%92%E8%89%B2%20%E5%8F%82%E8%80%83",
    );
  });

  it("键也被编码（键来自调用处给的常量时不该漏）", () => {
    expect(buildQueryString({ "a b": "1" })).toBe("a%20b=1");
  });

  it("数组 → 重复键（append 语义，不是覆盖）", () => {
    expect(buildQueryString({ tag: ["a", "b"] })).toBe("tag=a&tag=b");
  });

  it("数组里的空值按单值口径省略", () => {
    expect(buildQueryString({ tag: ["a", null, "b"] })).toBe("tag=a&tag=b");
    expect(buildQueryString({ tag: [] })).toBe("");
  });

  it("一个参数都没有时返回空串", () => {
    expect(buildQueryString({})).toBe("");
  });
});

describe("withQuery", () => {
  it("有参数时带 ?，没有参数时原样返回路径", () => {
    expect(withQuery("/api/images", { type: "input" })).toBe(
      "/api/images?type=input",
    );
    /* 收口前手拼的落点在这里有三套写法，其中一套无条件带 `?` ——
     * 于是「一个参数都没有」时会请求 `/api/x?`。 */
    expect(withQuery("/api/workshop/draft", {})).toBe("/api/workshop/draft");
  });

  it("路径上原有的查询串不会被吞掉（拼在 ? 之前是调用处的责任）", () => {
    /* 出口只负责「路径 + ? + 查询串」；路径里已经带了 `?` 的落点
     * 应当改用 `buildQueryString` 自己拼（见 `/api/images` 的用法）。 */
    expect(withQuery("/api/logs/sessions", { source: "app" })).toBe(
      "/api/logs/sessions?source=app",
    );
  });
});

describe("readQueryParam", () => {
  it("读得到值，前导 ? 可带可不带", () => {
    expect(readQueryParam("a=1&b=2", "b")).toBe("2");
    expect(readQueryParam("?a=1&b=2", "b")).toBe("2");
  });

  it("值里的转义与 + 都解回来", () => {
    expect(readQueryParam("q=%E8%A7%92%E8%89%B2+x", "q")).toBe("角色 x");
  });

  it("「键不存在」与「键存在但值为空串」分得开", () => {
    expect(readQueryParam("a=1", "b")).toBeNull();
    expect(readQueryParam("b=", "b")).toBe("");
    expect(readQueryParam("b", "b")).toBe("");
  });

  it("坏转义原样返回而不抛（查询串来自别处）", () => {
    expect(readQueryParam("q=%zz", "q")).toBe("%zz");
  });

  it("空段被跳过（`a=1&&b=2` 这类串不产生空键）", () => {
    expect(readQueryParam("a=1&&b=2", "")).toBeNull();
    expect(readQueryParam("a=1&&b=2", "b")).toBe("2");
  });
});
