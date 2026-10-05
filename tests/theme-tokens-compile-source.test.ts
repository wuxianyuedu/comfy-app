/**
 * 主题判据的编译输入源是**固定的**（ISSUE #1336）。
 *
 * 背景：三份 theme 用例（`theme-token-single-source` / `theme-dark-token-cascade` /
 * `sidebar-state-contrast`，合计 60 条）过去每个文件都在 `beforeAll` 里把 `globals.css`
 * **全量编译**一遍 —— 本机裸跑实测 21109ms、vitest 隔离跑 7.2s。全量满载时这份编译排到
 * `hookTimeout: 45_000` 之外，表现是**整份 suite 红、里面的用例一条没跑却被记成 skipped**，
 * 而串行隔离重跑全绿（典型争用假红）。修法是把编译的输入源固定住（关自动扫描 + 钉住判据
 * 要读的 utility + 项目 `@theme` 走 `static`），而不是再抬一次超时。
 *
 * 本文件钉的是**固定之后不许悄悄回到全量扫描**：那件事的表现不是「这里红」，而是
 * 「某天满载时 theme 又间歇红」，而归因线索全断 —— 所以它需要一条自己的、与负载无关的判据。
 * 三条判据全部打在**产物形状**上，不用耗时当判据（耗时断言本身就是会自己红的东西）。
 */
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  compiledGlobalsCss,
  themeTokens,
  withPinnedSources,
} from "./helpers/theme-tokens";

const ROOT = process.cwd();
const GLOBALS = path.join(ROOT, "src", "app", "globals.css");

/** 判据在产物里要读的那几条 utility（与 helper 里的清单同源）。 */
const UTILITY_CLASSES = ["bg-card", "bg-popover", "border-border"];

/** 只有开着全仓扫描才会出现在产物里的默认调色板档（本项目没有把它们钉进输入源）。 */
const SCAN_ONLY_PROBES = [
  "--color-red-200",
  "--color-amber-100",
  "--color-sky-200",
];

let css: string;
let light: ReturnType<typeof themeTokens>;
let dark: ReturnType<typeof themeTokens>;

beforeAll(async () => {
  css = await compiledGlobalsCss();
  light = themeTokens("light", css);
  dark = themeTokens("dark", css);
});

describe("theme 编译的输入源固定住了（#1336 的反向判据）", () => {
  it("项目 `@theme` 块里声明的每个 token 都无条件进产物", () => {
    // `@theme static` 的性质：这些声明与「全仓哪里用到过某个类」无关。
    // 一旦回到按用法 tree-shake，就会有用例读到「浅色档在、深色档不在」这种半截形状
    // （第一版实测到的正是 `--color-primary-strong`，见 helper 注释）。
    const src = fs.readFileSync(GLOBALS, "utf8");
    const declared: string[] = [];
    for (const block of src.matchAll(
      /@theme(?:\s+inline)?\s*\{([\s\S]*?)\n\}/g,
    )) {
      const body = block[1] ?? "";
      for (const decl of body.matchAll(/(--[A-Za-z0-9-]+)\s*:/g)) {
        const name = decl[1];
        if (name) declared.push(name);
      }
    }
    // 解析不到名字 = 这条判据在空跑，先钉住「真的解析到了」
    expect(declared.length).toBeGreaterThan(50);
    const missing = [...new Set(declared)].filter(
      (name) => !light.has(name) && !dark.has(name),
    );
    expect(
      missing,
      `这些 @theme token 没进产物，说明按用法 tree-shake 又生效了：${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("判据要读的三条 utility 仍在产物里（钉住输入源不是只关了扫描）", () => {
    for (const cls of UTILITY_CLASSES) {
      expect(
        new RegExp(`\\.${cls}\\s*\\{`).test(css),
        `产物里没有 .${cls} 规则 —— 它没被 @source inline 钉住，而 theme 判据正读着它`,
      ).toBe(true);
    }
  });

  it("默认调色板档不在产物里 = 自动扫描确实是关着的", () => {
    // 开着扫描时这三条都在（全量扫描的产物比固定输入源的多出 238 条这类声明）。
    // 这条与负载无关，专门拦「把 source(none) 摘掉」那一步退回到 21s 的形状。
    for (const probe of SCAN_ONLY_PROBES) {
      expect(
        light.has(probe) || dark.has(probe),
        `产物里出现了 ${probe} —— 只有全仓扫描才会带进默认调色板档，#1336 的耗时请回来了`,
      ).toBe(false);
    }
  });

  it("globals.css 少掉那行 @import 时抛错，不静默按全量扫描编一遍", () => {
    // helper 里的匹配式与 globals.css 的那一行是**一对**：任何一边改形状而另一边没跟上，
    // 静默放行等于让这条优化悄悄失效。这里直接喂一份没有那行的文本，钉它必须抛。
    expect(() => withPinnedSources("/* 没有 @import 的假 css */")).toThrow(
      /tailwindcss/,
    );
  });
});

/**
 * 主题 token 的**完整清单**（规范 11 §11.9 的「大块产物比对人读」那一档）。
 *
 * 为什么用 `toMatchFileSnapshot` 而不是 `toEqual([...149 个名字])`：
 * 内联数组的失败信息是把 149 行挤进 diff，而**人真正想看的是一次改名/删名之后
 * 清单长什么样**。文件快照把基线写成一份能独立打开、能单独 diff 的真文件
 * （`tests/__snapshots__/theme-tokens.css-theme-surface.txt`），于是 review 的对象
 * 变回「产物本身」而不是「测试文件里的一段字面量」。
 *
 * 为什么这份清单值得被钉：`@theme` 里少一个声明，表现不是「某个用例红」，而是
 * **某个 `bg-*` / `text-*` 类编不出来、界面上那处颜色悄悄回退到兜底**。
 * 上面那条「每个声明都进产物」判的是「有没有掉队」，这条判的是「**这一版到底
 * 声明了哪些**」—— 后者只有人读得出来，所以它要做成一份可 diff 的文件。
 */
describe("主题 token 清单（文件快照，人工 review 的对象）", () => {
  it("`@theme` 声明的 token 清单与基线一致", async () => {
    const src = fs.readFileSync(GLOBALS, "utf8");
    const declared = new Set<string>();
    for (const block of src.matchAll(
      /@theme(?:\s+inline)?\s*\{([\s\S]*?)\n\}/g,
    )) {
      for (const decl of (block[1] ?? "").matchAll(/(--[A-Za-z0-9-]+)\s*:/g)) {
        declared.add(decl[1]!);
      }
    }
    /* 一份声明都没有时快照会变成空文件而「照样通过」——先钉住解析本身有效。 */
    expect(
      declared.size,
      "@theme 解析不出声明 —— 这条判据在空跑",
    ).toBeGreaterThan(50);
    await expect([...declared].sort().join("\n")).toMatchFileSnapshot(
      "__snapshots__/theme-tokens.css-theme-surface.txt",
    );
  });
});
