/**
 * 「用例 throw 之后平台也恢复」的判据。
 *
 * 为什么值得单独一条：这是 `test.extend` 相对手写 `try/finally` 的**唯一实质收益**
 * （见 `platform-fixtures.ts` 文件头）。它没被执行者的表现是「某天改用例的人少写了
 * 一个 try，同文件后面的用例读到被改过的 `process.platform`」—— 那种失败完全指不出
 * 根因。所以这条要么有用例，要么别在注释里承诺。
 *
 * 形态用 `test.fails`：第一条**故意抛**并标成「预期失败」，于是整份套件仍然是绿的；
 * 而一旦 fixture 的恢复逻辑被删掉，第一条会变成「意外通过」、整份套件当场红 ——
 * 判据自己带着反向执行者，不需要靠「有人记得去看某条永久红」。
 * 第二条是真正的判据：它必须读到真平台，`throw` 不能把状态漏过去。
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
