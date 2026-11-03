/**
 * 「router 层的错误信封只许 TRPCError」这条判据自身的用例（台账 E8 的防线）。
 *
 * 三层各管一件事，缺任何一层都会静默失效：
 *   ① **存量为零** —— 真扫 `src/server/api/routers/**`（先过 `stripComments`，
 *      否则本文件的注释里那些「裸 `throw new Error`」叙述会把自己判红）。
 *      同时断言**扫描面非空**：路径写错时「零命中」看起来就像「全都修好了」，
 *      这是这一类清单最典型的死法。
 *   ② **配置在写** —— `eslint.config.js` 里确实有针对该 glob 的 `no-restricted-syntax`，
 *      规则条目直接从**导入的配置对象**里取（不在这里重抄一份，否则改了配置而测试还绿）。
 *   ③ **selector 真的会响** —— 拿 eslint 自带的 `Linter` 在最小片段上跑**行为断言**：
 *      裸 `throw new Error` 必须报、`throw new TRPCError` 必须不报；并且 router 目录里
 *      store selector 那条**同样还在响**（#2777 修层覆盖前，后一层会把前一层整条替换掉，
 *      只看源码文本永远看不出这事）。
 *      少了这一层，② 就只是一句「配置里有个字符串」—— 而本仓库已经付过学费：
 *      **「有配置 ≠ 配置在跑」**（§11.7 / 台账 E2 同源）。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Linter } from "eslint";

import eslintConfig from "../eslint.config.js";
import { stripComments } from "./helpers/strip-comments";

const ROOT = process.cwd();
const ROUTER_DIR = path.join(ROOT, "src", "server", "api", "routers");
const ROUTER_GLOB = "src/server/api/routers/**/*.ts";

/** 被拦的形状：`throw new 任何非 TRPCError`。 */
const BARE_THROW = /throw\s+new\s+(?!TRPCError\b)[A-Za-z_$][\w$]*\s*\(/;

type RestrictedSyntaxEntry = { message: string; selector: string };
type ConfigBlock = {
  files?: Array<string> | string;
  ignores?: Array<string>;
  rules?: Record<string, unknown>;
};

function routerSources(): Array<string> {
  return readdirSync(ROUTER_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => path.join(ROUTER_DIR, f));
}

/** 从真实配置里取 router 那一档生效的规则条目（配置变了，这里跟着变）。 */
function routerRestrictedSyntax(): { block: ConfigBlock; entries: Array<RestrictedSyntaxEntry> } {
  const blocks = (eslintConfig as unknown as Array<ConfigBlock>).filter((block) =>
    Array.isArray(block.files) && block.files.includes(ROUTER_GLOB),
  );
  expect(blocks).toHaveLength(1);
  const block = blocks[0];
  if (!block) throw new Error(`eslint.config.js 里没有 ${ROUTER_GLOB} 这一档（glob 改过？）`);
  const rules = block.rules?.["no-restricted-syntax"];
  expect(Array.isArray(rules)).toBe(true);
  const entries = (rules as Array<unknown>).slice(1) as Array<RestrictedSyntaxEntry>;
  return { block, entries };
}

/** 用真实条目跑一次 Linter —— 这就是「判据是否真的会响」的行为断言。 */
function lintWith(entries: Array<RestrictedSyntaxEntry>, code: string): Array<string> {
  const linter = new Linter();
  return linter
    .verify(code, {
      languageOptions: { ecmaVersion: 2022, sourceType: "module" },
      rules: { "no-restricted-syntax": ["error", ...entries] },
    })
    .map((m) => m.ruleId ?? "");
}

describe("① 存量为零：router 里不许有裸 throw", () => {
  it("扫描面非空（路径写错时「零命中」是假绿，不是好消息）", () => {
    const files = routerSources();
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      expect(statSync(f).isFile()).toBe(true);
    }
  });

  it("每个 router 源文件都没有 `throw new 非 TRPCError`", () => {
    const hits: Array<string> = [];
    for (const file of routerSources()) {
      const code = stripComments(readFileSync(file, "utf8"));
      code.split("\n").forEach((line, idx) => {
        if (BARE_THROW.test(line)) {
          hits.push(`${path.relative(ROOT, file)}:${idx + 1}  ${line.trim()}`);
        }
      });
    }
    // 台账 E8：19 处已在⑨第三刀清零。新增一处就红，且红信息直接给出位置 ——
    // 裸 Error 在 tRPC 里是 INTERNAL_SERVER_ERROR，界面分不出「不存在 / 越权 / 重名」。
    expect(hits).toEqual([]);
  });
});

describe("② + ③ router 档的规则条目：两层同时生效，且真的会响", () => {
  it("router 档同时带着 router selector 和 store selector（层覆盖缺陷已修）", () => {
    const { block, entries } = routerRestrictedSyntax();
    expect(entries).toHaveLength(3);
    const selectors = entries.map((e) => e.selector);
    expect(selectors.some((s) => s.includes("ThrowStatement"))).toBe(true);
    expect(selectors.filter((s) => s.includes("STORE_SELECTOR") || s.includes("CallExpression[callee.name=")))
      .toHaveLength(2);
    // 测试夹具要模拟裸 Error，必须留在豁免面外。
    expect(block.ignores).toContain("src/server/api/routers/**/*.test.ts");
  });

  it("行为：裸 Error / TypeError 报，TRPCError 不报", () => {
    const { entries } = routerRestrictedSyntax();
    expect(lintWith(entries, `export const a = () => {\n  throw new Error("x");\n};`)).toContain(
      "no-restricted-syntax",
    );
    expect(
      lintWith(entries, `export const a = () => {\n  throw new TypeError("x");\n};`),
    ).toContain("no-restricted-syntax");
    expect(
      lintWith(entries, `export const a = () => {\n  throw new TRPCError({ code: "NOT_FOUND" });\n};`),
    ).not.toContain("no-restricted-syntax");
  });

  it("行为：router 文件里的 store selector 同类形态照样报（没被 router 层盖掉）", () => {
    const { entries } = routerRestrictedSyntax();
    const storeSelectorSample = `export const value = useLogStore((s) => ({ a: s.a }));`;
    expect(lintWith(entries, storeSelectorSample)).toContain("no-restricted-syntax");
    expect(
      lintWith(entries, `export const value = useLogStore((s) => s.a);`),
    ).not.toContain("no-restricted-syntax");
  });
});
