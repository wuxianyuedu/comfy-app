/**
 * 字阶档位的「当前渲染值」怎么读 —— 全仓唯一读法（规范 §12.18），与 `radius-scale.ts` 对称。两份
 * 真源（项目档覆盖默认档）：`theme.css` 的默认档（本仓不覆盖，靠 `design-md-contract-sync.test.ts`
 * 的反向断言避免空绿）与 `globals.css` 的自命名档。标题三颗乘 `--font-scale`、已移出 `@theme`，不入表。
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
 * 档位的**配对行高**：Tailwind v4 里 `--text-<名>--line-height` 存在就连带锁 `line-height`（§3.10.1
 * 「同字号两种行高」的来路）。默认表是「行高 ÷ 字号」的比值形状，浏览器按比值乘字号，故这里也按
 * 比值存。**认不出形状就抛错**：静默漏一条会让「按行高推理」的判据拿到缺表的读数。
 */
const LINE_HEIGHT_RE = /^\s*--text-([a-z0-9]+)--line-height\s*:\s*([^;]+);\s*$/gm;

/** 解一条行高声明成比值（乘字号得像素）。支持 `calc(a / b)` 与裸数值两种形状。 */
function parseLineRatio(raw: string, where: string): number {
  const calc = /^calc\(\s*([0-9.]+)\s*\/\s*([0-9.]+)\s*\)$/.exec(raw.trim());
  const numerator = calc?.[1];
  const denominator = calc?.[2];
  if (
    numerator !== undefined &&
    numerator !== "" &&
    denominator !== undefined &&
    denominator !== ""
  ) {
    return Number.parseFloat(numerator) / Number.parseFloat(denominator);
  }
  const bare = /^([0-9.]+)$/.exec(raw.trim());
  const bareNumber = bare?.[1];
  if (bareNumber !== undefined && bareNumber !== "") {
    return Number.parseFloat(bareNumber);
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

export type TextTiers = {
  /** 渲染 px → 档名（多个档同名值时保留第一个，仅用于报错话术）。 */
  byPx: Map<number, string>;
  /**
   * 档名 → **配对行高比值**（`text-<名>` 会连带锁 `line-height`）。
   * 不在表里 = 这一档没有配对，行高走继承（项目自加的 `2xs` / `3xs` 就是刻意如此）。
   */
  lineRatios: Map<string, number>;
  /** 当前在用的全部档名（已按 t-shirt 形状筛过）。 */
  names: Array<string>;
};

/**
 * 读两张表并按「项目覆盖默认」合并。**默认表全收，只有项目自加档名要 t-shirt 形状**（`cn()` 会把
 * 不认识的 `text-*` 归进颜色组；上一版一个正则连 `base` 一起筛掉，被 16px 查无档名的自验抓到）。
 * **解不出任何一颗就抛错** —— 静默空集会让「等于档位值就红」的判据永远绿。
 */
export function parseTextTiers(globalsCss: string, tshirt: RegExp): TextTiers {
  const collected = new Map<string, number>();
  const defaults = new Set<string>();
  const sources: Array<{ fromProject: boolean; text: string }> = [
    { text: readFileSync(tailwindThemeCss(), "utf8"), fromProject: false },
    { text: globalsCss, fromProject: true },
  ];
  for (const { text, fromProject } of sources) {
    for (const m of text.matchAll(TEXT_DECL_RE)) {
      if (
        m[1] === undefined ||
        m[1] === "" ||
        m[2] === undefined ||
        m[2] === "" ||
        m[3] === undefined ||
        m[3] === ""
      ) {
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
      if (m[1] === undefined || m[1] === "" || m[2] === undefined || m[2] === "") {
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
