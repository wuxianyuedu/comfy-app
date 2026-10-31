/**
 * `normalizeControlFlow` 的单元测试：把单语句控制流块折成单行体，使源码形态断言
 * 对 `curly` 这类加括号规则免疫。重点守住「块括号」与「对象字面量括号」的区分。
 */
import { describe, expect, it } from "vitest";

import { normalizeControlFlow } from "./helpers/source-shape";

describe("normalizeControlFlow", () => {
  it("把单语句 if 块折成单行体", () => {
    expect(normalizeControlFlow('if (who !== "dev") {\n  return null;\n}')).toBe(
      'if (who !== "dev") return null;',
    );
  });

  it("把 if/else 两组单语句块都折", () => {
    expect(normalizeControlFlow("if (a) {\n  foo();\n} else {\n  bar();\n}")).toBe(
      "if (a) foo(); else bar();",
    );
  });

  it("for / for-of / while / do 同样折", () => {
    expect(normalizeControlFlow("for (const x of arr) {\n  process(x);\n}")).toBe(
      "for (const x of arr) process(x);",
    );
    expect(normalizeControlFlow("while (ok) {\n  step();\n}")).toBe("while (ok) step();");
  });

  it("**不**折对象字面量里的括号（这是正则做不到的安全点）", () => {
    expect(normalizeControlFlow("if (a) return { x: 1 };")).toBe("if (a) return { x: 1 };");
    expect(normalizeControlFlow("const o = { x: 1 };\nif (o.x) {\n  use(o);\n}")).toBe(
      "const o = { x: 1 };\nif (o.x) use(o);",
    );
  });

  it("多语句块原样保留（curly 不会把多语句体加括号）", () => {
    const src = "if (a) {\n  one();\n  two();\n}";
    expect(normalizeControlFlow(src)).toBe(src);
  });

  it("嵌套收敛到稳定态", () => {
    expect(
      normalizeControlFlow("function f() {\n  if (a) {\n    if (b) {\n      g();\n    }\n  }\n}"),
    ).toBe("function f() {\n  if (a) if (b) g();");
  });

  it("幂等：再跑一遍文本不变", () => {
    const once = normalizeControlFlow("if (a) {\n  foo();\n} else {\n  bar();\n}");
    expect(normalizeControlFlow(once)).toBe(once);
  });

  it("非 JS 家族源码原样返回（避免被 TS 解析器误折）", () => {
    const rust = "if x > 0 { do_thing(); }";
    expect(normalizeControlFlow(rust, "shell_launch.rs")).toBe(rust);
  });

  it("按扩展名推断方言：.mjs 也归一化", () => {
    expect(normalizeControlFlow("if (ok) {\n  exit(0);\n}", "script.mjs")).toBe("if (ok) exit(0);");
  });
});
