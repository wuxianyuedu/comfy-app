/**
 * 「Args → 数据源」注入层的**契约判据**（ISSUE #1381 续，规范 16 §16.2.3.6）。
 *
 * 为什么需要它：注入层（`.storybook/data-sources.tsx`）是 story 的**公共依赖**，
 * 而它守的那条口径（「不给数据依赖型组件 mock 假形态」）恰好是**最容易悄悄失效**的
 * 一类 —— 失效时没有任何东西会红：
 *
 *  · 有人往 `DATA_SOURCES` 里加一份手写的示例对象 → 所有依赖它的 story 一起
 *    变成「看着正常、真机上不对」，而画布上完全看不出来（这正是上一轮不给它们写
 *    story 的理由）；
 *  · 有人把 `media` 源的名字清单与磁盘上的真文件脱钩 → 名字指向的文件不存在，
 *    画布上组件渲染的是它的失败兜底，读的人会以为「设计就是这样」；
 *  · 有人把手写清单从 `DATA_SOURCES` 里删掉、改成 story 里各写各的 → 注册表空转，
 *    判据「在场」而什么都没判（与本仓 §16.2.3 反复记着的那族形态同源）。
 *
 * 判的是**形状与连接**，不是语义：
 *  1. 注册表非空，且每个源都有 `about` / `names` / `load` 三件；
 *  2. 名字不认识时 `load` **抛错**（静默回退到空值会让「源名写错了」看不出来）；
 *  3. `media` 源的名字清单与磁盘上的真文件**双向对得上** —— 这是这一层唯一能被
 *     自动核对的那半（`json` 的载荷是代码里的真报文形状，没有第二份可比）；
 *  4. 注入层用的是 Storybook 的 staticDirs 目录，**不是 `public/`** —— 后者会随
 *     `next build` 进 standalone 产物、被 `build-desktop` 内嵌进桌包
 *     （`scripts/check-standalone-contents.cjs` 的顶层白名单）。
 *
 * 注入层的**运行期行为**由真浏览器逐 story 渲染核对（那是「有没有真的画出来」这一
 * 维度，用例到不了）；这里守的是「它的接线还在不在」。
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(".");
const SOURCES = join(ROOT, ".storybook", "data-sources.tsx");
const ASSETS = join(ROOT, ".storybook", "assets");
const MAIN = join(ROOT, ".storybook", "main.ts");
const ASSET_SCRIPT = join(ROOT, "scripts", "storybook-assets.mjs");

const sources = readFileSync(SOURCES, "utf8");
const main = readFileSync(MAIN, "utf8");

/**
 * 从源码里读出一份 `as const` 的字符串清单。
 *
 * 为什么读源码而不是 import 那个 `.tsx`：它是 React 组件模块（import 会把
 * Storybook 的 `@storybook/nextjs` 一起拉进 vitest 的 node 环境）。这里判的正是
 * 「那份清单与磁盘对不对得上」，读文本足够且不引入运行期依赖。
 */
function readConstArray(name: string): string[] {
  const re = new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const;`);
  const hit = re.exec(sources);
  expect(hit, `没在 ${SOURCES} 里找到 ${name} —— 注入层的名字清单被删了？`).not.toBeNull();
  return [...hit![1]!.matchAll(/["']([^"']+)["']/g)].map((m) => m[1]!);
}

describe("Storybook 数据源注入层的契约（ISSUE #1381）", () => {
  it("有值源注册表，且每个源都带 about / names / load 三件", () => {
    expect(sources).toContain("export const DATA_SOURCES");
    for (const key of ["about", "names", "load"]) {
      expect(sources, `注册表条目缺 ${key} —— 缺 about 说不清数据从哪来，` +
        "缺 names 进不了 Args 面板，缺 load 就是个空壳").toContain(key);
    }
  });

  it("名字不认识时抛错（静默回退会让「源名写错了」看不出来）", () => {
    /* 两个源各自的那句守卫：`throw new Error` 与拼接出来的「现有的：…」提示。
       判的是**存在**而不是措辞 —— 措辞会改，行为不能改。 */
    const throws = [...sources.matchAll(/throw new Error\(/g)].length;
    expect(
      throws,
      "值源里没有 `throw` —— 名字写错时它会静默给 `undefined`，画布上看着像「这个组件就这样」",
    ).toBeGreaterThanOrEqual(2);
    expect(sources).toContain("现有的：");
  });

  it("media 源的名字清单与磁盘上的真文件对得上", () => {
    const names = readConstArray("MEDIA_SOURCE_NAMES");
    expect(names.length, "media 源一个名字都没有 —— 判据在空转").toBeGreaterThan(0);

    /* `missing.png` 是**故意不存在**的那一个（失败兜底那条分支的现场），
       所以用它做判据的锚点：它在清单里，就必须真的不在磁盘上。 */
    expect(names, "失败兜底的现场没了（`missing.png`）—— 那条分支没人验").toContain(
      "missing.png",
    );

    for (const name of names) {
      const onDisk = existsSync(join(ASSETS, name));
      if (name === "missing.png") {
        expect(
          onDisk,
          "`missing.png` 真的存在了 —— 「加载失败落兜底」那条分支的现场就没了",
        ).toBe(false);
      } else {
        expect(
          onDisk,
          `${name} 不在 .storybook/assets/ —— 名字与磁盘脱钩了：` +
            "画布上组件会渲染它的失败兜底，而读的人会以为「设计就是这样」",
        ).toBe(true);
      }
    }
  });

  it("真图由现生成脚本产出（不是手放进 .storybook/assets/ 的二进制）", () => {
    const script = readFileSync(ASSET_SCRIPT, "utf8");
    /* 三张图的文件名必须**两处同源**：注入层的清单 + 生成脚本的产出表。 */
    for (const name of readConstArray("MEDIA_SOURCE_NAMES")) {
      if (name === "missing.png") continue;
      expect(script, `${name} 不在 scripts/storybook-assets.mjs 的产出表里`).toContain(
        name,
      );
    }
  });

  it("资源走 Storybook 的 staticDirs，不落 public/（那会随桌包出厂）", () => {
    expect(
      main,
      "`.storybook/assets` 没挂进 staticDirs —— media 源指向的文件会 404",
    ).toContain(".storybook/assets");
    expect(
      main,
      "资源落在了 `public/` 下 —— 它会随 next build 进 standalone 产物、" +
        "再被 build-desktop 内嵌进桌包（scripts/check-standalone-contents.cjs 守着这一层）",
    ).not.toMatch(/staticDirs:\s*\[[^\]]*"\.\.\/public\/storybook/);
  });

  it("注入层挂在 preview 的 decorators 上（不挂 = 写了没人用）", () => {
    const preview = readFileSync(join(ROOT, ".storybook", "preview.tsx"), "utf8");
    for (const name of ["withTrpcApp", "withAppProviders", "withTheme"]) {
      expect(preview, `${name} 没进 decorators —— 那一层环境就白写了`).toContain(name);
    }
  });

  it("点目录进了 tsc 与 eslint 的扫描面（否则这一层是双重盲区）", () => {
    const tsconfig = readFileSync(join(ROOT, "tsconfig.json"), "utf8");
    const eslint = readFileSync(join(ROOT, "eslint.config.js"), "utf8");
    expect(
      tsconfig,
      "`.storybook/**` 不在 tsconfig 的 include 里 —— TS 的 `**/*.ts` 会跳过点目录",
    ).toContain(".storybook/**/*.ts");
    expect(
      eslint,
      "`.storybook/**` 不在 LINT_FILES 里 —— 同一个目录两种检查都看不到",
    ).toContain(".storybook/**/*.{ts,tsx,mts,cts}");
  });
});
