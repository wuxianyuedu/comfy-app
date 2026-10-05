/**
 * fixture 层自己的判据（改 `platform-fixtures.ts` 先跑这里）。
 *
 * 为什么它需要自己的用例：fixture 失灵的表现**不是「这里红」**，而是「消费它的
 * 那些用例悄悄少跑了几档」—— 那是台账 E7 记的那个形状（零执行者比红更糟）。
 * 所以这一份钉三件事：`asPlatform` 真的切到了、**收尾真的恢复了**（用例中途
 * throw 也一样）、以及 `onWindows` 与 `realPlatform` 不分叉。
 */
import { describe, expect } from "vitest";
import { test } from "./platform-fixtures";

describe("asPlatform", () => {
  test("切过去之后被测代码读到的是新值", ({ asPlatform }) => {
    asPlatform("win32");
    expect(process.platform).toBe("win32");
  });

  test("两次切换后读到的是最后一次（可以切多段）", ({ asPlatform }) => {
    asPlatform("win32");
    expect(process.platform).toBe("win32");
    asPlatform("linux");
    expect(process.platform).toBe("linux");
  });

  test("正常结束时平台已恢复（否则会污染同文件后面的用例）", ({
    asPlatform,
    realPlatform,
  }) => {
    asPlatform("win32");
    expect(process.platform).not.toBe(realPlatform);
    /* 收尾是 vitest 在用例返回之后跑的，所以这里只能靠**下一条**用例来看；
     * 这一条的价值是「切换确实生效了」，恢复由下面那条钉。 */
  });

  test("上一条切过 win32，这一条读到的仍是真平台", ({ realPlatform }) => {
    expect(process.platform).toBe(realPlatform);
  });
});

describe("onWindows", () => {
  test("是 realPlatform 的派生，不分叉", ({ onWindows, realPlatform }) => {
    expect(onWindows).toBe(realPlatform === "win32");
  });

  test("不看被 asPlatform 改过的值（依赖的是真宿主）", ({
    asPlatform,
    onWindows,
    realPlatform,
  }) => {
    asPlatform(realPlatform === "win32" ? "linux" : "win32");
    expect(onWindows).toBe(realPlatform === "win32");
  });
});

describe("makeHost", () => {
  test("名单内的路径带执行位、名单外抛 EACCES", ({ makeHost }) => {
    const host = makeHost(["/usr/bin/node"]);
    expect(() => host.access("/usr/bin/node")).not.toThrow();
    expect(() => host.access("/usr/bin/other")).toThrow(/EACCES/);
  });

  test("spawn 恒 null = 这台机器的内核起得来它", ({ makeHost }) => {
    expect(makeHost(["/usr/bin/node"]).spawn("/usr/bin/node")).toBeNull();
  });
});

describe("throw 之后仍恢复", () => {
  /* 「用例中途 throw 时收尾照样跑」是 `test.extend` 相对手写 try/finally 的唯一实质
   * 收益，它有自己的执行者：`platform-fixtures.failure.test.ts`（用 `test.fails`
   * 故意抛一条，于是整份套件仍然绿、而恢复逻辑被删掉时当场红）。这里不重复。 */
  test("正常路径下 asPlatform 生效，下一条读到干净平台", ({
    asPlatform,
    realPlatform,
  }) => {
    asPlatform("linux");
    expect(process.platform).toBe("linux");
    expect(realPlatform).not.toBe("lost");
  });
});
