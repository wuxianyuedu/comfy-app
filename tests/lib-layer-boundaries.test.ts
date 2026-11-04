/**
 * `src/lib` 分层边界（ISSUE #575 第 1 项 / 规范 §18.3）。elements 曾漏 `src/lib/{comfyui,workshop,film,llm}`（`default: allow` 放行），
 * 故 H1「lib 不得 import components」无机器判据（实测确有两处倒置）。本测试锁：`lib` → `components` 显式禁止、`src/lib/{core,db}/**`
 * 须排 `src/lib/**` 之前（顺序是语义，反了数据层归 `lib` 致 `server → components` 静默失效），以及真实仓库无越界 import。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import oxlintConfig from "@/../oxlint.parity.config.mjs";

type ElementDef = { pattern: string; type: string };
type Policy = {
  disallow?: { to?: { element?: { type?: string } } };
  from?: { element?: { type?: string } };
};

/**
 * 从 **oxlint 判决配置**里取出 boundaries 那一节（含 elements 声明与策略）。
 * #2777 PR-B 起 boundaries 的生效面在 oxlint（jsPlugin `boundaries`）；
 * #3157 起 eslint 已退役，判决面只有 oxlint。
 */
function boundariesSection(): { elements: Array<ElementDef>; policies: Array<Policy> } {
  /* SAFETY: 类型断言已复核 */
  const config = oxlintConfig as unknown as {
    overrides?: Array<{ rules?: Record<string, unknown> }>;
    settings?: Record<string, unknown>;
  };
  /* SAFETY: 类型断言已复核 */
  const elements = (config.settings?.["boundaries/elements"] ?? []) as Array<ElementDef>;
  let rule: [string, { policies?: Array<Policy> }] | undefined;
  for (const one of config.overrides ?? []) {
    const candidate = one.rules?.["boundaries/dependencies"] as
      | [string, { policies?: Array<Policy> }]
      | undefined;
    if (candidate) {
      rule = candidate;
    }
  }
  expect(rule, "oxlint 判决配置里找不到 boundaries/dependencies").toBeTruthy();
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
      (p) => p.from?.element?.type === "lib" && p.disallow?.to?.element?.type === "components",
    );
    expect(hasRule, "缺少 lib → components 的 disallow 策略").toBe(true);
  });

  it("真实仓库里 src/lib 没有 import src/components / src/app（事实层）", () => {
    const root = process.cwd();
    const hits: Array<string> = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) {
          continue;
        }
        const src = readFileSync(full, "utf8");
        // 只匹配模块说明符，注释里提到的路径不算（规范 §18.3 的注释惯例）
        const matches = [
          ...src.matchAll(/from\s+["']([^"']+)["']/g),
          ...src.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g),
        ].map((m) => m[1]);
        for (const spec of matches) {
          if (typeof spec !== "string") {
            continue;
          }
          if (/^((~|@)\/)(components|app)\//.test(spec)) {
            hits.push(`${relative(root, full)} → ${spec}`);
          }
        }
      }
    };
    walk(join(root, "src", "lib"));
    expect(
      hits,
      `src/lib 不得 import 视图层（需要共享的类型请下沉到 src/lib 下的类型模块，规范 §18.3）：\n${hits
        .map((h) => `  ✗ ${h}`)
        .join("\n")}`,
    ).toEqual([]);
  });
});
