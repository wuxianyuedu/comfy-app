/**
 * 圆角刻度的解析口径 —— `--radius` 基数与派生各档全仓只允许一份读法（规范 §12.18），两处判据共用：
 * `theme-token-single-source.test.ts` 的 T4（定义侧）、`design-md-contract-sync.test.ts`（调用侧是否重抄字面 px）。
 * 读 `src/app/globals.css` 源码而非产物是刻意的：`@theme inline` 未被 `var()` 引用的档位不进产物 `:root`（实测只剩 md/lg），拿产物当判据会漏五档。
 */

/** 一颗派生式：`渲染值 = 基数 × coef + offset`。 */
export type RadiusDerivation = {
  coef: number;
  offset: number;
};

export type RadiusScale = {
  /** `:root` 里那颗基数，换算成 px（只认 rem/px 两种形态）。 */
  basePx: number;
  /** 档位名（`--radius-sm` … 含 `--radius-node`）→ 派生式。 */
  derivations: Map<string, RadiusDerivation>;
};

/**
 * 解出所有由 `--radius` 派生的档位（不要求输入里带基数声明，便于反向验证）。支持三种写法：
 * `var(--radius)`（×1）、`calc(var(--radius) * N)`、`calc(var(--radius) ± Npx)`。
 * **写成字面 px 的档位解不出来** —— 调用方要的就是这个「解不出来」。
 */
export function parseDerivations(css: string): Map<string, RadiusDerivation> {
  const derivations = new Map<string, RadiusDerivation>();
  for (const m of css.matchAll(
    /^\s*(--radius-[a-z0-9]+)\s*:\s*(?:var\(--radius\)|calc\(var\(--radius\)\s*(?:(\*)\s*([0-9.]+)|([+-])\s*([0-9.]+)px)\))\s*;/gm,
  )) {
    if (m[1] === undefined || m[1] === "") {
      continue;
    }
    if (m[2] === "*") {
      derivations.set(m[1], {
        coef: Number.parseFloat(m[3] ?? "1"),
        offset: 0,
      });
    } else if (m[4] !== undefined && m[4] !== "") {
      const magnitude = Number.parseFloat(m[5] ?? "0");
      derivations.set(m[1], {
        coef: 1,
        offset: m[4] === "-" ? -magnitude : magnitude,
      });
    } else {
      derivations.set(m[1], { coef: 1, offset: 0 });
    }
  }
  return derivations;
}

/** 基数 + 派生表一起解出来（`css` 必须是 globals.css 全文）。 */
export function parseRadiusScale(css: string): RadiusScale {
  const baseMatch = /^\s*--radius\s*:\s*([0-9.]+)(rem|px)\s*;/m.exec(css);
  const baseValue = baseMatch?.[1];
  const baseUnit = baseMatch?.[2];
  if (baseValue === undefined || baseValue === "" || baseUnit === undefined || baseUnit === "") {
    throw new Error("globals.css 里找不到 --radius 基数");
  }
  const basePx =
    baseUnit === "rem" ? Number.parseFloat(baseValue) * 16 : Number.parseFloat(baseValue);

  return { basePx, derivations: parseDerivations(css) };
}

/** 一颗派生式在给定基数下渲染成多少 px（四舍五入到整数，与浏览器一致）。 */
export function renderRadiusPx(d: RadiusDerivation, basePx: number): number {
  return Math.round(basePx * d.coef + d.offset);
}

/** 整张表渲染出来的 px 值集合（含 `--radius-node` 这类非档位）。 */
export function renderedRadiusValues(scale: RadiusScale): Array<number> {
  return [...scale.derivations.values()].map((d) => renderRadiusPx(d, scale.basePx));
}
