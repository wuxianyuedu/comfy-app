/**
 * 「用例 throw 之后平台也恢复」的判据：这是 `test.extend` 相对手写 `try/finally` 的唯一实质收益（见 `platform-fixtures.ts` 文件头）。它没被执行者的表现是后一个用例读到被改过的 `process.platform`，根因指不出。
 * 形态用 `test.fails`：第一条故意抛并标预期失败，套件仍绿；一旦恢复逻辑被删，第一条变成「意外通过」、套件当场红，判据自带反向执行者。
 * 第二条必须读到真平台，`throw` 不能把状态漏过去。
 */
import { describe, expect } from "vitest";
import { test } from "./platform-fixtures";

describe("throw 之后仍恢复", () => {
  test.fails("第一步：切到 win32 然后故意抛（预期失败）", ({ asPlatform }) => {
    asPlatform("win32");
    expect(process.platform).toBe("win32");
    throw new Error("故意抛：验证 throw 之后平台仍被恢复");
  });

  test("第二步：上一条抛了，这一条读到的仍是真平台", ({ realPlatform }) => {
    expect(process.platform).toBe(realPlatform);
  });
});
