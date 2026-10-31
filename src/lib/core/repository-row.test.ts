/**
 * `firstRowRequired` / `firstRowOfExisting` 的行为判据。
 *
 * 这两条出口是 `6ccedfd7`（非空断言存量清零）抽出来的：那一刀把 15 处
 * `rows[0]!` 收成一处，同时修掉两处**真 bug**（`updateEmail` / `updatePassword`
 * 在 `returning()` 匹配 0 行时把 `undefined` 冒充成 `User` 传下去）。既然它是
 * 「缺席即显式失败」这条契约的**唯一落点**，它自己就必须有用例 —— 否则抽出来的
 * 那一层只是把三处 `!` 换成三处 `throw`，而「抛哪一个错误类」这件事没人钉。
 *
 * 判据落在三件事上：
 *   ① 有行时**原样**返回那一行（不复制、不包装 —— 调用方拿到的是同一个引用）；
 *   ② 缺席时抛出的**错误类**要对：写入路径是 `AppError`（500，内部故障），
 *      按 id 更新是 `NotFoundError`（404，目标不存在）。两者混用会把
 *      「我的 bug」报成「你的请求错了」，或反过来；
 *   ③ 文案里带主语（`what`）—— 不带的话调用方读到「未返回记录」不知道是哪条 SQL。
 */
import { describe, expect, it } from "vitest";

import { AppError, NotFoundError } from "./errors";
import { firstRowOfExisting, firstRowRequired } from "./repository-row";

describe("firstRowRequired —— 写入路径取首行", () => {
  it("有行时原样返回（同一个引用，不复制）", () => {
    const row = { email: "a@b.c", id: "u1" };
    expect(firstRowRequired([row], "用户插入")).toBe(row);
  });

  it("多行时取第一行（`returning()` 只会给一行，多给时以首个为准）", () => {
    expect(firstRowRequired([1, 2, 3], "批量插入")).toBe(1);
  });

  it("空数组抛 AppError（500 档：写入必然产生一行，缺席是内部故障）", () => {
    const err = (() => {
      try {
        firstRowRequired([], "用户插入");
        return null;
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(AppError);
    /* 写入路径**不该**被报成 404：「没有行」在这里是我方 bug，不是用户请求错了。
     * 用 `NotFoundError` 会让前端把它当「资源不存在」渲染，从而把内部故障藏起来。 */
    expect(err).not.toBeInstanceOf(NotFoundError);
    expect(/* SAFETY: 类型断言已复核 */ (err as AppError).httpStatus).toBe(500);
  });

  it("错误话术里带得上主语（否则读日志的人不知道是哪条 SQL）", () => {
    expect(() => firstRowRequired([], "用户插入")).toThrow(/用户插入/);
    expect(() => firstRowRequired([], "影片更新")).toThrow(/影片更新/);
  });

  it("`what` 是空串也照抛（不把空主语当「不用抛」的暗号）", () => {
    expect(() => firstRowRequired([], "")).toThrow(AppError);
  });
});

describe("firstRowOfExisting —— 按 id 更新取首行", () => {
  it("有行时原样返回", () => {
    const row = { id: "u1" };
    expect(firstRowOfExisting([row], "用户不存在: u1")).toBe(row);
  });

  it("空数组抛 NotFoundError（404 档：`returning()` 空 = 没有匹配行）", () => {
    const err = (() => {
      try {
        firstRowOfExisting([], "用户不存在: u1");
        return null;
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(NotFoundError);
    /* 它同时是 AppError 的子类（归一化与信封共用同一条路）—— 这一条钉的是
     * 「换成 NotFoundError 不等于脱离错误契约」。 */
    expect(err).toBeInstanceOf(AppError);
    expect(/* SAFETY: 类型断言已复核 */ (err as AppError).httpStatus).toBe(404);
  });

  it("错误话术里带得上主语与 id", () => {
    expect(() => firstRowOfExisting([], "用户不存在: u1")).toThrow(/u1/);
  });
});

describe("两者的分工（同一份输入、两条判决）", () => {
  it("同一份空数组，两个出口给出的档位不同 —— 这就是拆成两个函数的意义", () => {
    const required = (() => {
      try {
        firstRowRequired([], "x");
      } catch (e) {
        return /* SAFETY: 类型断言已复核 */ e as AppError;
      }
      return null;
    })();
    const existing = (() => {
      try {
        firstRowOfExisting([], "x");
      } catch (e) {
        return /* SAFETY: 类型断言已复核 */ e as AppError;
      }
      return null;
    })();
    expect(required?.httpStatus).toBe(500);
    expect(existing?.httpStatus).toBe(404);
  });

  it("两条出口都不返回 undefined（返回值类型上就没有那一档）", () => {
    /* 这是这一层存在的理由：抽它之前 `rows[0]!` 会把 `undefined` 冒充成 `T`。
     * 判据取**运行时**行为（拿到的不是 undefined），而不是类型注解。 */
    expect(firstRowRequired([0], "x")).toBe(0);
    expect(firstRowOfExisting(["", null].slice(0, 1), "x")).toBe("");
  });
});
