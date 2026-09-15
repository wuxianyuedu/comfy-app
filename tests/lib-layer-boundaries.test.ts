/**
 * `src/lib` 的分层边界（ISSUE #575 第 1 项 / 规范 §18.3）。
 *
 * 背景：`eslint-plugin-boundaries` 的 `elements` 此前只声明了 `src/server`、
 * `src/lib/core`、`src/lib/db`、`src/components`、`src/features`——
 * `src/lib/comfyui`、`workshop`、`film`、`llm` **不属于任何 element**，
 * 靠 `default: allow` 放行。于是「lib 不得 import components（H1 依赖倒置）」
 * 这条只写在注释与规范里，**没有任何机器判据**，实测确有两处倒置悄悄存在。
 *
 * 本测试锁两件事：
 *   ① 配置层：`src/lib/**` 是 element `lib`，且 `lib` → `components` 被显式禁止；
 *   ② **元素顺序**：更具体的 `src/lib/core/**`、`src/lib/db/**` 必须排在
 *      `src/lib/**` 之前 —— boundaries 按声明顺序取第一个匹配的 element，
 *      顺序反了会让数据层被重新归类成 `lib`，`server → components` 的既有约束
 *      **静默失效**（没有报错，只是不再拦）。
 *   ③ 事实层：真实仓库里 `src/lib/**` 没有 import `src/components/**`、`src/app/**`。
 *
 * 为什么配置也要断言：这类「顺序是语义」的配置改错了不会让任何既有用例变红，
 * 只会在某次越界时才发现门禁没生效。用测试把顺序钉住，比写注释可靠。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import eslintConfig from "@/../eslint.config.js";

type ElementDef = { type: string; pattern: string };
type Policy = {
  from?: { element?: { type?: string } };
  disallow?: { to?: { element?: { type?: string } } };
};

/** 从扁平配置里取出 boundaries 那一节（含 elements 声明与策略）。 */
function boundariesSection(): { elements: ElementDef[]; policies: Policy[] } {
  const configs = eslintConfig as unknown as Array<{
    plugins?: Record<string, unknown>;
    settings?: Record<string, unknown>;
    rules?: Record<string, unknown>;
  }>;
  const section = configs.find((c) => c.plugins?.boundaries);
  expect(section, "eslint.config.js 里找不到 boundaries 配置节").toBeTruthy();
  const elements = (section?.settings?.["boundaries/elements"] ?? []) as ElementDef[];
  const rule = section?.rules?.["boundaries/dependencies"] as
    | [string, { policies?: Policy[] }]
    | undefined;
  return { elements, policies: rule?.[1]?.policies ?? [] };
}

describe("src/lib 的分层边界（规范 §18.3）", () => {
  it("`src/lib/**` 被声明为 element `lib`（不再是 boundaries 盲区）", () => {
    const { elements } = boundariesSection();
    expect(elements).toContainEqual({ type: "lib", pattern: "src/lib/**" });
  });

  it("元素顺序语义：更具体的 core/db 必须排在 src/lib/** 之前", () => {
    const { elements } = boundariesSection();
    const idx = (pattern: string) => elements.findIndex((e) => e.pattern === pattern);
    const libIdx = idx("src/lib/**");
    expect(libIdx).toBeGreaterThanOrEqual(0);
    // 顺序反了 = 数据层被归到 lib，server→components 的约束静默失效
    for (const specific of ["src/lib/core/**", "src/lib/db/**"]) {
      const i = idx(specific);
      expect(i, `缺少元素声明：${specific}`).toBeGreaterThanOrEqual(0);
      expect(i, `${specific} 必须排在 src/lib/** 之前（顺序是语义）`).toBeLessThan(libIdx);
    }
    // 且它们仍归 server（数据层），不是 lib
    for (const specific of ["src/lib/core/**", "src/lib/db/**"]) {
      expect(elements[idx(specific)]?.type).toBe("server");
    }
  });

  it("`lib` → `components` 被显式禁止（H1 依赖倒置）", () => {
    const { policies } = boundariesSection();
    const hasRule = policies.some(
      (p) =>
        p.from?.element?.type === "lib" && p.disallow?.to?.element?.type === "components",
    );
    expect(hasRule, "缺少 lib → components 的 disallow 策略").toBe(true);
  });

  it("真实仓库里 src/lib 没有 import src/components / src/app（事实层）", () => {
    const root = process.cwd();
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) continue;
        const src = readFileSync(full, "utf8");
        // 只匹配模块说明符，注释里提到的路径不算（规范 §18.3 的注释惯例）
        const matches = [
          ...src.matchAll(/from\s+["']([^"']+)["']/g),
          ...src.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g),
        ].map((m) => m[1]);
        for (const spec of matches) {
          if (typeof spec !== "string") continue;
          if (/^((~|@)\/)(components|app)\//.test(spec)) {
            hits.push(`${relative(root, full)} → ${spec}`);
          }
        }
      }
    };
    walk(join(root, "src", "lib"));
    expect(
      hits,
      "src/lib 不得 import 视图层（需要共享的类型请下沉到 src/lib 下的类型模块，规范 §18.3）：\n" +
        hits.map((h) => `  ✗ ${h}`).join("\n"),
    ).toEqual([]);
  });
});
