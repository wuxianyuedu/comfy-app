/**
 * 「用例的环境档」门禁自测（规范 §11.17）。
 *
 * 判据的价值全在**判定口径**上，所以这里跑的是**真脚本**（临时仓库 + 只放被测文件），
 * 断言「该拦的拦、不该误伤的放过」。三处口径各有一条用例，都是实测踩出来的：
 *
 *   ① **环境早退**里 `typeof` 后面只认环境全局 —— 首版写成「任意标识符」时，
 *      `function requestUrl(input) { if (typeof input === "string") return input; }`
 *      被当场误报。一条会误报的判据活不过一次评审，所以这条误报要有人钉住。
 *   ② **注释不算** —— 仓里就有注释在**讲解这个反模式**，而剥注释那一步的
 *      字符串处理首版会把 `"undefined"` 删空、于是正则连同哨兵一起失配
 *      （变异测试当场证明它认不出自己最想认的形状）。这两条都得有用例。
 *   ③ **目录档矛盾**只判「jsdom 档里的用例声明 node」，不判「node 档里声明 jsdom」——
 *      后者是完全正当的写法（文件头优先级高于 project）。按后一种口径装上去
 *      当场报 37 处误报。
 *   ④ **冗余文件头**判「头与所属档给同一个结论」，但不能扩张成「两个档都不匹配 /
 *      都匹配时也判」—— 那是配置自己有缝 / 有重叠，报「冗余」只会把人带偏。
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = path.resolve(__dirname, "../scripts/check-test-environment.cjs");

/**
 * 最小可用的 `vitest.config.ts`：脚本要按括号配对解出两个 project 的
 * `include` / `exclude`，形状不对就判「解析失败」（不静默按「没有目录档」处理）。
 * 这里给的是**与真实配置同形**的最小版。
 */
const CONFIG = [
  "const JSDOM_TEST_GLOBS = [",
  '  "src/dom/**/*.test.{ts,tsx}",',
  '  "src/**/*.test.tsx",',
  "];",
  "export default {",
  "  test: {",
  "    setupFiles: [\"tests/setup.ts\"],",
  "    globals: false,",
  "    projects: [",
  "      {",
  "        test: {",
  '          name: "node",',
  '          environment: "node",',
  '          include: ["src/**/*.test.{ts,tsx}"],',
  "          exclude: JSDOM_TEST_GLOBS,",
  "        },",
  "      },",
  "      {",
  "        test: {",
  '          name: "jsdom",',
  '          environment: "jsdom",',
  "          include: JSDOM_TEST_GLOBS,",
  "        },",
  "      },",
  "    ],",
  "  },",
  "};",
  "",
].join("\n");

/** 在临时仓库里跑真脚本（cwd = 临时仓库根）。 */
function gate(files: Record<string, string>): { ok: boolean; output: string } {
  const root = mkdtempSync(path.join(tmpdir(), "test-env-"));
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  copyFileSync(SCRIPT, path.join(root, "scripts", path.basename(SCRIPT)));
  writeFileSync(path.join(root, "vitest.config.ts"), CONFIG);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  try {
    return {
      ok: true,
      output: execFileSync(
        process.execPath,
        [path.join(root, "scripts", path.basename(SCRIPT))],
        { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      ),
    };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string };
    return { ok: false, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

const JSDOM_HEADER = "// @vitest-environment jsdom";
const NODE_HEADER = "// @vitest-environment node";

describe("用例环境档门禁：环境早退", () => {
  it("`typeof window !== \"undefined\"` 后裸 return → 拦下并给出正解", () => {
    const r = gate({
      "src/lib/x.test.ts": [
        'it("覆盖 SSR 分支", () => {',
        '  if (typeof window !== "undefined") return;',
        '  expect(readCssColorToken("--x")).toBeNull();',
        "});",
      ].join("\n"),
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("环境早退");
    // 正解必须出现在修法里（判据的价值一半在「读得懂怎么改」）。
    expect(r.output).toContain("vi.stubGlobal");
  });

  it("反向守卫（`=== \"undefined\"`）同样拦下", () => {
    const r = gate({
      "src/lib/x.test.ts": 'it("x", () => {\n  if (typeof document === "undefined") return;\n});',
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("环境早退");
  });

  it("`typeof <普通标识符>` 是类型收窄，**不许**误报", () => {
    /* 实测现场：UseWorkshopPipelinePersistence.test.tsx 的 requestUrl()。 */
    const r = gate({
      "src/lib/x.test.ts": [
        "function requestUrl(input: RequestInfo | URL): string {",
        '  if (typeof input === "string") return input;',
        "  return input instanceof URL ? input.href : input.url;",
        "}",
        'it("x", () => { expect(requestUrl("a")).toBe("a"); });',
      ].join("\n"),
    });
    expect(r.ok, r.output).toBe(true);
  });

  it("注释里讲解这个反模式 → 不算违规（注释被剥掉）", () => {
    const r = gate({
      "src/lib/x.test.ts": [
        "/* 反例：不要写 `if (typeof window !== \"undefined\") return;` —— 那是环境早退。 */",
        '// if (typeof window !== "undefined") return;',
        'it("x", () => { expect(1).toBe(1); });',
      ].join("\n"),
    });
    expect(r.ok, r.output).toBe(true);
  });

  it("守卫后面有断言（不是裸 return）→ 放过", () => {
    const r = gate({
      "src/lib/x.test.ts": [
        'it("两个分支各判各的", () => {',
        '  if (typeof window === "undefined") {',
        "    expect(readCssColorToken(\"--x\")).toBeNull();",
        "    return;",
        "  }",
        '  expect(readCssColorToken("--x")).toBeTruthy();',
        "});",
      ].join("\n"),
    });
    expect(r.ok, r.output).toBe(true);
  });
});

describe("用例环境档门禁：目录档与文件头矛盾", () => {
  it("jsdom 档（`.test.tsx`）里的文件头写 node → 拦下", () => {
    const r = gate({
      "src/components/x.test.tsx": `${NODE_HEADER}\nit("x", () => {});`,
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("目录档与文件头矛盾");
  });

  it("jsdom 目录（整目录一致）里的文件头写 node → 拦下", () => {
    const r = gate({
      "src/dom/a.test.ts": `${NODE_HEADER}\nit("x", () => {});`,
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("目录档与文件头矛盾");
  });

  it("node 档目录里声明 jsdom → **不算**矛盾（文件头优先级更高）", () => {
    /* 这是混合目录里的正当写法：目录档是 node，用例自己靠文件头要 jsdom。
     * 早期口径按「与 project 同名」判，实测一次报 37 处，全是这一类。 */
    const r = gate({
      "src/lib/x.test.ts": `${JSDOM_HEADER}\nit("x", () => {});`,
    });
    expect(r.ok, r.output).toBe(true);
  });
});

describe("用例环境档门禁：冗余文件头", () => {
  it("jsdom 档（`.test.tsx`）里再写一遍 jsdom 头 → 拦下（同一件事两个来源）", () => {
    /* 实测现场：ISSUE #1485 那轮删掉 147 份冗余头之后**漏了 1 份** ——
     * tests/sidebar-selected-state.test.tsx 已由 `.test.tsx` 那一条目录档收进 jsdom 档，
     * 头部那行是第二个来源。当时没有这条判据，所以没人发现。 */
    const r = gate({
      "src/components/x.test.tsx": `${JSDOM_HEADER}\nit("x", () => {});`,
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("冗余文件头");
  });

  it("node 档里的用例写 node 头 → 同样拦下", () => {
    const r = gate({
      "src/lib/x.test.ts": `${NODE_HEADER}\nit("x", () => {});`,
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("冗余文件头");
  });

  it("**承重**头（node 档目录里声明 jsdom）→ 不许误报", () => {
    /* 这是混合目录里那 36 份的形态：目录档给 node，用例自己要 jsdom，
     * 文件头是归属的**唯一**声明。判「冗余」把这条也收进去 = 当场删错 36 份。 */
    const r = gate({
      "src/lib/x.test.ts": `${JSDOM_HEADER}\nit("x", () => {});`,
    });
    expect(r.ok, r.output).toBe(true);
  });

  it("两个档都不匹配的文件不判冗余（配置有缝不归这条判据）", () => {
    /* `include` 之外的路径：node 档的 `include` 只写了 `src/**`，这份在 `tests/`。
     * 它一个档都进不去 —— 若判「冗余 node 头」，报的是**错误的原因**。 */
    const r = gate({
      "tests/outside.test.ts": `${NODE_HEADER}\nit("x", () => {});`,
    });
    expect(r.ok, r.output).toBe(true);
  });
});

describe("用例环境档门禁：判据自己不许静默降级", () => {
  it("`projects` 解析不到（形状变了）→ 判失败，不退回「没有目录档」", () => {
    const root = mkdtempSync(path.join(tmpdir(), "test-env-bad-"));
    mkdirSync(path.join(root, "scripts"), { recursive: true });
    copyFileSync(SCRIPT, path.join(root, "scripts", path.basename(SCRIPT)));
    writeFileSync(
      path.join(root, "vitest.config.ts"),
      "export default { test: { environment: \"node\" } };\n",
    );
    let ok = true;
    let output = "";
    try {
      output = execFileSync(
        process.execPath,
        [path.join(root, "scripts", path.basename(SCRIPT))],
        { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (error) {
      const e = error as { stdout?: string; stderr?: string };
      ok = false;
      output = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    }
    expect(ok).toBe(false);
    expect(output).toContain("解析 `vitest.config.ts` 的 `projects` 失败");
  });

  /**
   * **注释里出现 `projects:` 不能把解析带偏**。
   *
   * 这条是改配置那一步**当场撞出来的**：`vitest.config.ts` 的解释性注释里写了一句
   * 「inline project（`projects: [{ test: {…} }]`）」，而解析器原先直接在**原文**上
   * `indexOf("projects:")` —— 命中的是注释里那一处，两个档一个都解析不出来。
   * 当时是 `found < 2` 那条兜底把它拦下的（说明兜底是承重的）；
   * 但若没有兜底，它会退回「没有目录档」＝判据②静默消失、照样报 OK。
   * 修法是在**抹掉注释、偏移不变**的文本上定位（`blankComments()`）。
   *
   * ⚠️ 这一格必须**改注释本身**才有执行者：把干扰放在 `test: {` 之前的最上方，
   * 逼解析器在原文与「去注释文本」上给出不同答案。只把 `projects:` 换个写法的变异
   * 测试**抓不到**这一条（它会照样绿）。
   */
  it("注释里写出 `projects: [...]` → 解析仍认真正的那个键，不判失败", () => {
    const root = mkdtempSync(path.join(tmpdir(), "test-env-comment-"));
    mkdirSync(path.join(root, "scripts"), { recursive: true });
    copyFileSync(SCRIPT, path.join(root, "scripts", path.basename(SCRIPT)));
    writeFileSync(
      path.join(root, "vitest.config.ts"),
      [
        "/* 讲解：inline project 的形状是 projects: [{ test: {…} }]，注意这里的 [ 与 } */",
        "// 行注释里也来一处：projects: [假的]",
        CONFIG,
      ].join("\n"),
    );
    mkdirSync(path.join(root, "src/lib"), { recursive: true });
    writeFileSync(
      path.join(root, "src/lib/x.test.ts"),
      'it("x", () => { expect(1).toBe(1); });\n',
    );
    const output = execFileSync(
      process.execPath,
      [path.join(root, "scripts", path.basename(SCRIPT))],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    expect(output).toContain("OK");
    expect(output).not.toContain("解析 `vitest.config.ts` 的 `projects` 失败");
  });
});
