/**
 * 字阶档位的「当前渲染值」怎么读 —— 全仓只允许这一份读法（规范 §12.18），
 * 与 `radius-scale.ts` 对圆角做的事完全对称。
 *
 * 两份真源，**项目档覆盖默认档**：
 *   · `node_modules/tailwindcss/theme.css` 的 `--text-<名>: <rem>` —— Tailwind 自己的
 *     默认字阶（本仓库刻意**不覆盖** `xs` / `sm` / `base` / `lg` …，这一点由
 *     `tests/design-md-contract-sync.test.ts` 里那条「12px / 13px 只有一个名字」的
 *     反向断言钉着：默认档没了，归零判据会因为「这档不存在」而空绿）；
 *   · `src/app/globals.css` 的 `--text-*` —— 项目自己命名的档（`2xs` / `3xs` / `4xs`）。
 *
 * **标题那三颗（`section` / `page` / `stage`）不在本表里，而且两层理由各管一段**：
 * 它们乘 `--font-scale`，**没有单一渲染值**（14px 的 `section` 在 125% 档下是 17.5px ——
 * 拿 scale=1 的读数当等式去要求调用点改类名是错的）；而它们已经从 `@theme` 移到 `:root`，
 * 所以 Tailwind 根本不为它们生成 utility（`.u-title*` 是 components 层的类，不是工具类）。
 * 从前这里写的是「因为名字不是 t-shirt 形状才被挡在外面」—— 那只是**第二道**闸，
 * 第一道（`TEXT_DECL_RE` 不认 `calc()`）一直更有效；而「改名就入射程」那句是错的。
 * 名字形状那道闸仍然留着，它管的是**项目自加的常量档**：`cn()` 把不认识的
 * `text-<名字>` 归进颜色组，实测吃掉同行状态色，所以自造的名字必须是 t-shirt 形状。
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** Tailwind 默认字阶的出处（依赖自带，不抄进仓库当第二本账）。 */
function tailwindThemeCss(): string {
  return require.resolve("tailwindcss/theme.css");
}

const TEXT_DECL_RE = /^\s*--text-([a-z0-9]+)\s*:\s*([0-9.]+)(rem|px)\s*;/gm;

/**
 * 档位的**配对行高**：Tailwind v4 里 `--text-<名>--line-height` 一旦存在，
 * 生成的 `text-<名>` 就连带锁 `line-height`（这正是 §3.10.1 那批「同一个字号两种行高」
 * 的来路）。默认表写的是 `calc(1.25 / 0.875)` 这种「行高 ÷ 字号」的比值形状，
 * 浏览器按比值乘字号算出行盒 —— 所以这里也按比值存，别在调用方凭印象写死像素。
 *
 * **认不出形状就抛错，不当「没有配对」**：静默漏掉一条配对，会让
 * 「按行高推理」的判据拿到一份缺东西的表，那比红更糟。
 */
const LINE_HEIGHT_RE = /^\s*--text-([a-z0-9]+)--line-height\s*:\s*([^;]+);\s*$/gm;

/** 解一条行高声明成比值（乘字号得像素）。支持 `calc(a / b)` 与裸数值两种形状。 */
function parseLineRatio(raw: string, where: string): number {
  const calc = /^calc\(\s*([0-9.]+)\s*\/\s*([0-9.]+)\s*\)$/.exec(raw.trim());
  if (calc?.[1] && calc[2]) {
    return Number.parseFloat(calc[1]) / Number.parseFloat(calc[2]);
  }
  const bare = /^([0-9.]+)$/.exec(raw.trim());
  if (bare?.[1]) {
    return Number.parseFloat(bare[1]);
  }
  throw new Error(
    `认不出的 --text-${where}--line-height 形状：${raw}（新增写法要同步这里的解法，不许静默跳过）`,
  );
}

/** 一条 `--text-*` 声明渲染成多少 px（rem 按 16 换算，与 Tailwind 的口径一致）。 */
function toPx(value: string, unit: string): number {
  const n = Number.parseFloat(value);
  return unit === "rem" ? n * 16 : n;
}

export interface TextTiers {
  /** 渲染 px → 档名（多个档同名值时保留第一个，仅用于报错话术）。 */
  byPx: Map<number, string>;
  /** 当前在用的全部档名（已按 t-shirt 形状筛过）。 */
  names: Array<string>;
  /**
   * 档名 → **配对行高比值**（`text-<名>` 会连带锁 `line-height`）。
   * 不在表里 = 这一档没有配对，行高走继承（项目自加的 `2xs` / `3xs` 就是刻意如此）。
   */
  lineRatios: Map<string, number>;
}

/**
 * 读两张表并按「项目覆盖默认」合并。
 *
 * **默认表全收、项目自加的档名才要 t-shirt 形状**：`TSHIRT_NAME` 那条限制的射程是
 * 「`cn()` 把不认识的 `text-<名字>` 归进颜色组」，而 Tailwind 自带的那批名字
 * （`xs` / `sm` / `base` / `lg` …）是 `cn` 原生认识的字号组成员，不受这个坑影响；
 * 受影响的是项目自己新造的名字（`section` / `page` / `stage`）。所以这里按来源分治，
 * 而不是拿一个正则把两批名字一起筛掉 —— 上一版就是这么把 `base` 误筛出去的
 * （由该判据自己的量具自验抓到：16px 查无档名）。
 *
 * **解不出任何一颗就抛错** —— 静默返回空集会让「等于档位值就红」那条判据永远绿，
 * 那比红更糟。
 */
export function parseTextTiers(globalsCss: string, tshirt: RegExp): TextTiers {
  const collected = new Map<string, number>();
  const defaults = new Set<string>();
  const sources: Array<{ text: string; fromProject: boolean }> = [
    { text: readFileSync(tailwindThemeCss(), "utf8"), fromProject: false },
    { text: globalsCss, fromProject: true },
  ];
  for (const { text, fromProject } of sources) {
    for (const m of text.matchAll(TEXT_DECL_RE)) {
      if (!m[1] || !m[2] || !m[3]) {
        continue;
      }
      if (fromProject && !fromProjectIsUsable(m[1], tshirt, defaults)) {
        continue;
      }
      if (!fromProject) {
        defaults.add(m[1]);
      }
      collected.set(m[1], toPx(m[2], m[3]));
    }
  }

  const lineRatios = new Map<string, number>();
  for (const { text } of sources) {
    for (const m of text.matchAll(LINE_HEIGHT_RE)) {
      if (!m[1] || !m[2]) {
        continue;
      }
      lineRatios.set(m[1], parseLineRatio(m[2], m[1]));
    }
  }

  const byPx = new Map<number, string>();
  const names: Array<string> = [];
  for (const [name, px] of [...collected].sort((a, b) => a[1] - b[1])) {
    names.push(name);
    if (!byPx.has(px)) {
      byPx.set(px, name);
    }
  }
  if (names.length === 0) {
    throw new Error(
      "一个字阶档位都没解出来 —— 依赖里的 Tailwind 默认表或 globals.css 的形状变了，" +
        "「调用点不许把档位值重抄成字面 px」那条判据会因此空转（永远绿）。",
    );
  }
  /* 配对表同理要自证非空：默认表里至少该有 xs / sm / base / lg 四颗配对，
   * 一条都没解出来就是形状变了（比如换成裸数值以外的新写法），必须响。 */
  if (lineRatios.size < 4) {
    throw new Error(
      `只解出 ${lineRatios.size} 条 --text-*-line-height 配对（默认表里至少该有四颗）` +
        " —— 行高判据会因此看不见这一档，比红更糟。",
    );
  }
  return { byPx, names, lineRatios };
}

/**
 * 某一档在真浏览器里渲染出的行盒高度（px，四舍五入到 0.01 与读数对齐）。
 * 没有配对的档返回 `null` —— 那一档的行高由继承决定，不由这张表担保。
 */
export function renderedLineHeightPx(tiers: TextTiers, name: string): number | null {
  const ratio = tiers.lineRatios.get(name);
  const size = [...tiers.byPx].find(([, n]) => n === name)?.[0];
  if (ratio === undefined || size === undefined) {
    return null;
  }
  return Math.round(size * ratio * 100) / 100;
}

/** 项目自加的档名：t-shirt 形状、或覆盖的是一个默认名（那 `cn` 本来就认识）才算可用。 */
function fromProjectIsUsable(name: string, tshirt: RegExp, defaults: Set<string>): boolean {
  return tshirt.test(name) || defaults.has(name);
}
