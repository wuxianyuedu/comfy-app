/**
 * 源扫描根是**显式的两张名单**，每一根都要能证明承重：Tailwind v4 不写 `source()` 时按「被 git 跟踪」自动发现，正文/镜像/typedoc/账本/门禁脚本样本/CHANGELOG/用例全进扫描面，每处 `prop-[值]` 生成一条无调用点的规则；实测 2796→2558 选择器、382452→349887 字节，差集 238 条且新−旧=0，只做减法。
 * 四格形状判据（不依赖负载）：①登记与声明逐条对齐（多/少/不在磁盘/向根里塞正文，四种都红）；②每根承重（摘根必真丢样式且丢的逐字出自该根）；③共用 CSS 入口的面看得见自己的类（不看名单，防②把根从声明与登记同时摘除后静默失效）；④判据自己的编译入口剥掉生产根（否则 #1336 顺带扫全 src，theme 间歇红）。
 * 变异复演：`.storybook`→`docs` ①红；helper 停止剥根 ④红；`.storybook` 从声明与登记同时摘掉 → ②与③各红一条。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { compiledCssPinnedTo, compiledGlobalsCss, ruleSelectors } from "./helpers/theme-tokens";

const ROOT = path.resolve(import.meta.dirname, "..");
const GLOBALS_PATH = path.join(ROOT, "src", "app", "globals.css");

/**
 * 登记表：**相对 `src/app`** 的扫描根。加一棵根是有意的动作 —— 它同时意味着「那个目录里的
 * 类名字面量会变成生产产物的一部分」，所以要在这里登记并写明它是谁。
 */
const SOURCE_ROOTS: Record<string, string> = {
  "../../src": "应用本体（页面 / 组件 / lib / 用例外的全部运行时代码）",
  "../../.storybook":
    "Storybook 工作台外壳自己的取景尺寸 —— `.storybook/preview.tsx` 引的就是本仓同一份 globals.css",
};

/** 出现即红的目录：正文、账本、门禁脚本、生成物 —— 它们一旦进根就是把死规则请回来。 */
const FORBIDDEN_IN_ROOTS = ["docs", "changelog.d", "scripts", "tests", "tools", "e2e", "src-tauri"];

/**
 * 与 app **共用同一份 `globals.css` 入口**的外部面：它们写的类必须出现在生产产物里，
 * 无论名单怎么改。这一格不看名单 —— 名单与登记同时摘掉一棵根时，差集判据会失去依据，
 * 而样式消失是静默的。
 */
const MUST_BE_SCANNED = [
  {
    dir: ".storybook",
    reason:
      "`.storybook/preview.tsx` 直接 import 本仓同一份 globals.css，工作台外壳的取景高度写在它自己里",
  },
];

/**
 * 数值型任意值（形如「属性名 - 方括号里一个带单位的数」那种）—— 只认这一族是为了让**文本侧**的探针可靠：
 * 第 9 刀量过纯文本正则会在别的方向上多报（模板串、变体选择器、`[0-9]` 这类正则字符组），
 * 而「属性名 + 方括号里是一个带单位的数」这一族在真源文件里不会出现假形。
 */
const NUMERIC_ARBITRARY_RE = /[-\w]+-\[[\d.]+(?:px|rem|em|vh|vw|vmin|vmax|ms|s|%)?\]/g;

/** 一棵根目录下所有文本文件的拼接（用于「丢的那些确实写在这一根里」）。 */
function textUnder(absDir: string): string {
  const skip = new Set(["node_modules", ".next", "generated", "dist"]);
  const out: Array<string> = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!skip.has(e.name)) {
          walk(path.join(dir, e.name));
        }
      } else if (/\.(?:ts|tsx|css|js|mjs|cjs)$/.test(e.name)) {
        out.push(readFileSync(path.join(dir, e.name), "utf8"));
      }
    }
  };
  if (existsSync(absDir)) {
    walk(absDir);
  }
  return out.join("\n");
}

/** 从 globals.css 里读出 `@source` 指令的目标（忽略 `inline(...)` 点名与 `not` 形态）。 */
function declaredRoots(css: string): Array<string> {
  const out: Array<string> = [];
  for (const m of css.matchAll(/^\s*@source\s+"(?<target>[^"]+)"\s*;/gm)) {
    const target = m.groups?.target;
    if (target !== undefined && target !== "" && !target.startsWith("inline(")) {
      out.push(target);
    }
  }
  return out;
}

/** 产物 → 每个**复合选择器**里的单个选择器片段（逗号按未转义处分组）。 */
function selectorParts(css: string): Set<string> {
  const out = new Set<string>();
  for (const selector of ruleSelectors(css)) {
    for (const part of selector.split(/(?<!\\),/)) {
      const p = part.trim();
      if (p) {
        out.add(p);
      }
    }
  }
  return out;
}

/** 应用本体那棵根是所有对照的基准（其余每一根都要在它之上证明自己承重）。 */
const BASE_ROOT = "../../src";

let declared: Array<string> = [];
let rootsCss = "";
let baseCss = "";

beforeAll(async () => {
  /* 编译用**文件里声明的**那几棵根，而不是本文件抄的一份 —— 抄一遍就会与源头漂开，
   * 而漂开的表现是「判据在替一个不存在的配置作证」。 */
  declared = declaredRoots(readFileSync(GLOBALS_PATH, "utf8"));
  expect(declared.length, "globals.css 里一条 @source 都没有 —— 判据在空跑").toBeGreaterThan(0);
  const [r, c] = await Promise.all([
    compiledCssPinnedTo(declared),
    compiledCssPinnedTo([BASE_ROOT]),
  ]);
  rootsCss = r;
  baseCss = c;
  /* 空跑挡板：两遍都必须真解出东西，否则下面的差集判据是在对着空集立法。 */
  expect(
    selectorParts(rootsCss).size,
    "两棵根编出来的产物是空的 —— 扫描面的路径基准写错了（相对 CSS 文件所在目录 src/app）",
  ).toBeGreaterThan(1000);
});

describe("源扫描根是显式名单", () => {
  it("globals.css 的自动扫描是关着的，且名单与登记表逐条对得上", () => {
    const css = readFileSync(GLOBALS_PATH, "utf8");
    expect(
      /^@import\s+["']tailwindcss["']\s+source\(none\)\s*;/m.test(css),
      "globals.css 的第一行不再写 source(none) —— 自动发现回来了，238 条无调用点的规则一起回来",
    ).toBe(true);

    expect(
      [...declared].sort(),
      `扫描根名单漂了：登记表是 ${Object.keys(SOURCE_ROOTS).sort().join(" / ")}，` +
        "实际声明的是左边这些 —— 加一根要连登记与理由一起改",
    ).toEqual(Object.keys(SOURCE_ROOTS).sort());

    /* 名单里的每一棵都得真的存在 —— 拼错一道的表现不是红，是「那一根的样式静默消失」。 */
    for (const rel of Object.keys(SOURCE_ROOTS)) {
      const abs = path.resolve(path.dirname(GLOBALS_PATH), rel);
      expect(existsSync(abs), `${rel}（登记为「${SOURCE_ROOTS[rel]}」）在磁盘上不存在`).toBe(true);
    }

    const forbidden = declared.filter((rel) =>
      FORBIDDEN_IN_ROOTS.some((dir) => rel.replace(/^[./]+/, "") === dir),
    );
    expect(
      forbidden,
      `正文 / 账本 / 门禁脚本被放进了扫描根 —— 那里每一枚写全的候选名都会变回产物里的死规则：${forbidden.join(
        " / ",
      )}`,
    ).toEqual([]);

    /* 登记表反向：条目对应的根若已从文件里消失，条目要一起删（不留「有登记、没有实物」）。 */
    const stale = Object.keys(SOURCE_ROOTS).filter((rel) => !declared.includes(rel));
    expect(stale, `这些登记过的根已经不在 globals.css 里了：${stale.join(" / ")}`).toEqual([]);
  });

  it("每一根都承重：摘掉它必须真丢样式，丢的那些必须写在它自己里", () => {
    const withRoots = selectorParts(rootsCss);
    const base = selectorParts(baseCss);
    const extras = declared.filter((rel) => rel !== BASE_ROOT);
    expect(
      extras.length,
      "除了应用本体之外一棵根都没有 —— 下面那格「摘根必须丢样式」会对着空名单假绿",
    ).toBeGreaterThan(0);

    const unescape = (s: string) =>
      s.replaceAll(/\\(?<escaped>.)/g, "$<escaped>").replace(/^\./, "");
    for (const rel of extras) {
      const onlyThisRoot = [...withRoots].filter((s) => !base.has(s));
      expect(
        onlyThisRoot.length,
        `摘掉 ${rel}（登记为「${SOURCE_ROOTS[rel]}」）一条样式都不丢 —— ` +
          "它就不该在名单里：要么删登记，要么它供给的东西其实都在应用本体里",
      ).toBeGreaterThan(0);
      const rootText = textUnder(path.resolve(path.dirname(GLOBALS_PATH), rel));
      const notSpelledThere = onlyThisRoot.filter((s) => !rootText.includes(unescape(s)));
      expect(
        notSpelledThere,
        `这些选择器只有 ${rel} 会供给，却没在那棵根的文本里找到逐字写法（说明登记理由不成立` +
          `，或差集其实来自别处）：${notSpelledThere.map(unescape).join(" / ")}`,
      ).toEqual([]);
    }

    /* 只做加法：加上任何一根都不许让应用本体自己供给的规则消失。 */
    expect(
      [...base].filter((s) => !withRoots.has(s)).length,
      "声明了更多根之后反而少了应用本体自己供给的规则 —— 两遍编译的口径不一致",
    ).toBe(0);
  });

  it("共享同一份 CSS 入口的面，它的类必须在生产产物里（摘根的红由这一格认）", () => {
    /* 这一格是「.storybook 为什么必须在根里」的**正面**表述：上面那格判的是差集，
     * 而把一棵根从声明与登记里同时摘掉时差集会一起消失 —— 那一格就没人可依了。
     * 所以这里不看名单，只看「这些面写了哪些数值型任意值」与「产物里有没有它们」。 */
    const unescape = (s: string) =>
      s.replaceAll(/\\(?<escaped>.)/g, "$<escaped>").replace(/^\./, "");
    const inProduct = new Set([...selectorParts(rootsCss)].map((s) => unescape(s)));
    for (const surface of MUST_BE_SCANNED) {
      const text = textUnder(path.join(ROOT, surface.dir));
      const spelled = [...new Set([...text.matchAll(NUMERIC_ARBITRARY_RE)].map((m) => m[0]))];
      expect(
        spelled.length,
        `${surface.dir} 里找不到任何数值型任意值 —— 这一格的探针失效了（那边改写法了？）`,
      ).toBeGreaterThan(0);
      const missing = spelled.filter((c) => !inProduct.has(c));
      expect(
        missing,
        `${surface.dir} 与 app 共用同一份 globals.css（${surface.reason}），` +
          `但这些类没进产物 —— 扫描根里少了这一棵：${missing.join(" / ")}`,
      ).toEqual([]);
    }
  });

  it("判据自己的编译入口真的剥掉了生产根（#1336 那份固定输入源没被顺带放宽）", async () => {
    /* `withPinnedSources` 只钉判据要读的那几条 utility。若它不再剥 `@source`，生产的两棵根
     * 会跟着进来，产物里就会出现「只有 src 才供给」的具名类 —— 表现不是红，而是「耗时与
     * 不可复现一起回来」，所以要正面认出来。`text-2xs` 是全仓大量使用、却没被钉进清单的那枚
     * 具名类，正好当这个形状的探针。 */
    const pinned = await compiledGlobalsCss();
    expect(
      /\n\s*\.text-2xs\s*\{/.test(pinned),
      "钉住输入源的那份产物里出现了 .text-2xs —— withPinnedSources 没把 globals.css 自带的生产" +
        "扫描根剥掉，theme 判据正在顺带扫全 src（#1336 那笔账会以新形状回来）",
    ).toBe(false);
    /* 探针本身要有效：两棵根的那份产物里必须看得见它，否则上面那条是在空跑。 */
    expect(
      /\n\s*\.text-2xs\s*\{/.test(rootsCss),
      "两棵根的产物里没有 .text-2xs —— 反向那条失去依据（src 根本没被扫进来？先查路径基准）",
    ).toBe(true);
  });
});
