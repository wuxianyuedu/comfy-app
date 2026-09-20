import { describe, it, expect, beforeEach } from "vitest";

import {
  nextId,
  uniqueStamp,
  randomToken,
  __resetIdSequences,
} from "./unique-id";

describe("nextId", () => {
  beforeEach(() => __resetIdSequences());

  it("同一前缀内严格递增（同一毫秒也不撞）", () => {
    /* 这是本出口存在的唯一理由：收口前日志 / 消息中心那两处的计数器
     * 取模回绕（`% 1_000_000`），转一圈之后同一毫秒的两条会拿到同一个 id。 */
    const ids = Array.from({ length: 50 }, () =>
      nextId("msg_", { now: 1_700_000_000_000 }),
    );
    expect(new Set(ids).size).toBe(50);
  });

  it("id 里带前缀、时间戳与序号（可读、可解析）", () => {
    const id = nextId("log-", { now: 1_700_000_000_000 });
    expect(id.startsWith("log-")).toBe(true);
    expect(id).toContain((1_700_000_000_000).toString(36));
  });

  it("序号每前缀各一套（互不推走对方的号）", () => {
    const a1 = nextId("a_", { now: 1 });
    const b1 = nextId("b_", { now: 1 });
    const a2 = nextId("a_", { now: 1 });
    expect(a1.endsWith("-1")).toBe(true);
    expect(b1.endsWith("-1")).toBe(true);
    expect(a2.endsWith("-2")).toBe(true);
  });

  it("同一批可以共享一个时刻（now 由调用处注入）", () => {
    const ids = [
      nextId("log-", { now: 42 }),
      nextId("log-", { now: 42 }),
      nextId("log-", { now: 42 }),
    ];
    expect(ids.every((id) => id.startsWith(`log-${(42).toString(36)}-`))).toBe(
      true,
    );
  });

  it("缺省时刻取当前时间（不必每次传 now）", () => {
    const before = Date.now();
    const id = nextId("t_");
    const after = Date.now();
    const stamp = Number.parseInt(
      id.slice("t_".length, id.lastIndexOf("-")),
      36,
    );
    expect(stamp).toBeGreaterThanOrEqual(before);
    expect(stamp).toBeLessThanOrEqual(after);
  });
});

describe("uniqueStamp", () => {
  it("一次调用一个 id，两次调用不撞（哪怕同一毫秒）", () => {
    const ids = new Set(
      Array.from({ length: 20 }, () => uniqueStamp("e_", { now: 7 })),
    );
    expect(ids.size).toBe(20);
  });

  it("不带前缀时只给随机段（文件名场景由调用处拼）", () => {
    const id = uniqueStamp("", { now: 1 });
    expect(id.startsWith(`${(1).toString(36)}-`)).toBe(true);
  });
});

describe("randomToken", () => {
  it("长度可控，且只含 36 进制字符", () => {
    const token = randomToken(8);
    expect(token).toHaveLength(8);
    expect(token).toMatch(/^[0-9a-z]+$/);
  });

  it("连取多个互不相同（可读短标记不参与去重，但仍要别撞）", () => {
    const tokens = new Set(Array.from({ length: 30 }, () => randomToken(6)));
    expect(tokens.size).toBe(30);
  });
});

describe("randomToken 的补齐分支", () => {
  it("请求长度超过单次随机段长度时继续拼（while 循环不是摆设）", () => {
    /* `Math.random().toString(36).slice(2)` 的长度是**不定**的，
     * 所以出口用 while 一直补到够长 —— 这一支不写用例就永远走不到。 */
    const token = randomToken(40);
    expect(token).toHaveLength(40);
  });

  it("缺省给 6 位", () => {
    expect(randomToken()).toHaveLength(6);
  });

  it("首轮调用时序号表里没有这个前缀（`?? 0` 那一支）", () => {
    __resetIdSequences();
    expect(nextId("fresh_", { now: 1 }).endsWith("-1")).toBe(true);
  });

  it("不传 options 时走缺省参数（`options = {}` 那一支）", () => {
    expect(nextId("bare_")).toMatch(/^bare_[0-9a-z]+-1$/);
  });
});

describe("uniqueStamp 的缺省分支", () => {
  it("不传 options 时取当前时刻（`options = {}` 那一支）", () => {
    const before = Date.now();
    const id = uniqueStamp("bare_");
    const after = Date.now();
    const stamp = Number.parseInt(
      id.slice("bare_".length, id.lastIndexOf("-")),
      36,
    );
    expect(stamp).toBeGreaterThanOrEqual(before);
    expect(stamp).toBeLessThanOrEqual(after);
  });
});
