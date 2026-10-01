/**
 * 「router 层的错误信封只许 TRPCError」这条判据自身的用例（台账 E8 的防线）。
 *
 * 三层各管一件事，缺任何一层都会静默失效：
 *   ① **存量为零** —— 真扫 `src/server/api/routers/**`（先过 `stripComments`，
 *      否则本文件的注释里那些「裸 `throw new Error`」叙述会把自己判红）。
 *      同时断言**扫描面非空**：路径写错时「零命中」看起来就像「全都修好了」，
 *      这是这一类清单最典型的死法。
 *   ② **配置在写** —— `eslint.config.js` 里确实有针对该 glob 的 `no-restricted-syntax`，
 *      selector 直接从配置源码里取（不在这里重抄一份，否则改了配置而测试还绿）。
 *   ③ **selector 真的会响** —— 拿 eslint 自带的 `Linter` 在两段最小片段上验一次：
 *      裸 `throw new Error` 必须报、`throw new TRPCError` 必须不报。
 *      少了这一层，② 就只是一句「配置里有个字符串」—— 而本仓库已经付过学费：
 *      **「有配置 ≠ 配置在跑」**（§11.7 / 台账 E2 同源）。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Linter } from "eslint";

import { stripComments } from "./helpers/strip-comments";

const ROOT = process.cwd();
const ROUTER_DIR = path.join(ROOT, "src", "server", "api", "routers");
const CONFIG = path.join(ROOT, "eslint.config.js");

/** 被拦的形状：`throw new 任何非 TRPCError`。 */
const BARE_THROW = /throw\s+new\s+(?!TRPCError\b)[A-Za-z_$][\w$]*\s*\(/;

function routerSources(): string[] {
  return readdirSync(ROUTER_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => path.join(ROUTER_DIR, f));
}

describe("① 存量为零：router 里不许有裸 throw", () => {
  it("扫描面非空（路径写错时「零命中」是假绿，不是好消息）", () => {
    const files = routerSources();
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) expect(statSync(f).isFile()).toBe(true);
  });

  it("每个 router 源文件都没有 `throw new 非 TRPCError`", () => {
    const hits: string[] = [];
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

describe("② + ③ 配置在写，且 selector 真的会响", () => {
  const configSrc = readFileSync(CONFIG, "utf8");

  it("eslint.config.js 为 router 目录声明了 no-restricted-syntax", () => {
    expect(configSrc).toContain("src/server/api/routers/**/*.ts");
    expect(configSrc).toContain("no-restricted-syntax");
  });

  it("从配置里取出的 selector：裸 Error 报、TRPCError 不报", () => {
    const selector =
      /selector:\s*\n?\s*'([^']*NewExpression[^']*)'/.exec(configSrc)?.[1] ??
      "";
    expect(selector).toContain("ThrowStatement");
    expect(selector).toContain('callee.name!="TRPCError"');

    const linter = new Linter();
    const verify = (code: string) =>
      linter.verify(code, {
        languageOptions: { ecmaVersion: 2022, sourceType: "module" },
        rules: {
          "no-restricted-syntax": ["error", { selector, message: "bare" }],
        },
      });

    expect(
      verify(`export const a = () => {\n  throw new Error("x");\n};`).map(
        (m) => m.ruleId,
      ),
    ).toContain("no-restricted-syntax");
    expect(
      verify(
        `export const a = () => {\n  throw new TRPCError({ code: "NOT_FOUND" });\n};`,
      ).map((m) => m.ruleId),
    ).not.toContain("no-restricted-syntax");
    // TypeError / 自定义错误名同样在拦的范围里（不只是 `Error` 这一个词）
    expect(
      verify(`export const a = () => {\n  throw new TypeError("x");\n};`).map(
        (m) => m.ruleId,
      ),
    ).toContain("no-restricted-syntax");
  });
});
