/**
 * 圆角刻度的解析口径 —— `--radius` 基数与「由它派生的各档」这件事，全仓只允许有
 * 一份读法（规范 §12.18）。两处判据共用：
 *   · `tests/theme-token-single-source.test.ts` 的 T4（判定义侧：刻度对不对）；
 *   · `tests/design-md-contract-sync.test.ts`（判调用侧：有没有把档位值重抄成字面 px）。
 *
 * 读的是 `src/app/globals.css` 的**源码文本**而不是编译产物，这是刻意的：
 * `@theme inline` 的语义是「值内插进工具类」，未被 `var()` 引用的档位根本不会
 * 出现在产物 `:root` 里（实测只有 `--radius-md` / `--radius-lg` 存活），
 * 拿产物当判据会看不见其余五档。定义侧的唯一事实来源仍然是 globals.css 本身。
 */

/** 一颗派生式：`渲染值 = 基数 × coef + offset`。 */
export interface RadiusDerivation {
  coef: number;
  offset: number;
}

export interface RadiusScale {
  /** `:root` 里那颗基数，换算成 px（只认 rem/px 两种形态）。 */
  basePx: number;
  /** 档位名（`--radius-sm` … 含 `--radius-node`）→ 派生式。 */
  derivations: Map<string, RadiusDerivation>;
}

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
    if (!m[1]) continue;
    if (m[2] === "*") {
      derivations.set(m[1], {
        coef: Number.parseFloat(m[3] ?? "1"),
        offset: 0,
      });
    } else if (m[4]) {
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
  if (!baseMatch?.[1] || !baseMatch[2]) {
    throw new Error("globals.css 里找不到 --radius 基数");
  }
  const basePx =
    baseMatch[2] === "rem"
      ? Number.parseFloat(baseMatch[1]) * 16
      : Number.parseFloat(baseMatch[1]);

  return { basePx, derivations: parseDerivations(css) };
}

/** 一颗派生式在给定基数下渲染成多少 px（四舍五入到整数，与浏览器一致）。 */
export function renderRadiusPx(d: RadiusDerivation, basePx: number): number {
  return Math.round(basePx * d.coef + d.offset);
}

/** 整张表渲染出来的 px 值集合（含 `--radius-node` 这类非档位）。 */
export function renderedRadiusValues(scale: RadiusScale): number[] {
  return [...scale.derivations.values()].map((d) =>
    renderRadiusPx(d, scale.basePx),
  );
}
