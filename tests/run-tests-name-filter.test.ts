/**
 * run-tests.mjs 的名称过滤读数（ISSUE #2400）。
 *
 * vitest 对「-t 一条都没命中」退 0 —— 与真绿在退出码上逐字同形，一次敲错的用例名
 * 换来一次无可指摘的绿。入口为此把那一次跑与 junit 配对，读出「执行了几条」：
 * 这里钉住两个纯函数的形状（识别过滤器、从 junit 算执行数）。
 */
import { describe, expect, it } from "vitest";

import { hasNameFilter, junitExecutedCount } from "../scripts/run-tests.mjs";

describe("hasNameFilter：识别透传参数里的名称过滤", () => {
  it("四种形状都认：-t <pat> / -t=<pat> / --testNamePattern <pat> / --testNamePattern=pat", () => {
    expect(hasNameFilter(["-t", "foo"])).toBe(true);
    expect(hasNameFilter(["-t=foo"])).toBe(true);
    expect(hasNameFilter(["--testNamePattern", "foo"])).toBe(true);
    expect(hasNameFilter(["--testNamePattern=foo"])).toBe(true);
  });

  it("无过滤 / 相邻旗标不带 -t 时不误判", () => {
    expect(hasNameFilter([])).toBe(false);
    expect(hasNameFilter(["src/a.test.ts"])).toBe(false);
    expect(hasNameFilter(["--reporter=basic"])).toBe(false);
  });
});

describe("junitExecutedCount：从 junit 算「执行了几条」", () => {
  it("零命中（全 skipped）⇒ 0 —— 这就是与真绿同形的那个 0", () => {
    const xml =
      '<testsuites name="vitest tests" tests="9" failures="0" errors="0">' +
      '<testsuite name="a.test.ts" tests="9" failures="0" errors="0" skipped="9" time="0">' +
      "</testsuite></testsuites>";
    expect(junitExecutedCount(xml)).toBe(0);
  });

  it("部分命中 ⇒ 执行数 = 收集数 − skipped；失败计入执行数", () => {
    const xml =
      "<testsuites>" +
      '<testsuite name="a" tests="8" failures="1" errors="0" skipped="5">' +
      "</testsuite></testsuites>";
    expect(junitExecutedCount(xml)).toBe(3);
  });

  it("多份 suite 求和；skipped 缺省按 0", () => {
    const xml =
      "<testsuites>" +
      '<testsuite name="a" tests="4" failures="0" errors="0" skipped="1">' +
      '<testsuite name="b" tests="6" failures="0" errors="0">' +
      "</testsuite></testsuite></testsuites>";
    expect(junitExecutedCount(xml)).toBe(9);
  });

  it("没有 suite 节点 ⇒ null（解析失败不许冒充 0）", () => {
    expect(junitExecutedCount("<html>404</html>")).toBeNull();
    expect(junitExecutedCount("")).toBeNull();
  });
});
