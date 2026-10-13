/**
 * 字阶档位的「当前渲染值」怎么读 —— 全仓只允许这一份读法（规范 §12.18），
 * 与 `radius-scale.ts` 对圆角做的事完全对称。
 *
 * 两份真源，**项目档覆盖默认档**：
 *   · `node_modules/tailwindcss/theme.css` 的 `--text-<名>: <rem>` —— Tailwind 自己的
 *     默认字阶（本仓库刻意**不覆盖** `xs` / `sm` / `base` / `lg` …，这一点由
 *     `tests/design-md-contract-sync.test.ts` 里那条「12px / 13px 只有一个名字」的
 *     反向断言钉着：默认档没了，归零判据会因为「这档不存在」而空绿）；
 *   · `src/app/globals.css` 的 `--text-*` —— 项目自己命名的档（`2xs` / `3xs`，
 *     以及 `section` / `page` / `stage` 三颗乘 `--font-scale` 的标题档）。
 *
 * **档名按来源分治**（见下方 `parseTextTiers`）：Tailwind 自带的名字全收，项目自加的
 * 只收 t-shirt 形状（调用方传 `TSHIRT_NAME` 那类正则）。后者那条限制的理由不是偷懒：
 * `cn()` 把不认识的 `text-<名字>` 归进**颜色**组，实测 `cn("text-ink-muted","text-stage")`
 * 会吃掉同行的状态色，所以 `section` / `page` / `stage` 这三颗**在 JSX 里根本不能用**
 * （`globals.css` 的注释自己写着「别在 JSX 里用它们」）。拿它们去要求调用点「改走类名」
 * 等于拿一条判据逼人去撞另一条已知的坑。它们该被治理的方式是先改成 t-shirt 档名，
 * 那一天到了，这条判据会自动把它们纳入射程。
 *
 * **只解常量形状的声明**：`--text-x: 11px` / `0.6875rem` 收，`calc(… * var(--font-scale))`
 * 那种**跳过** —— 乘了 `--font-scale` 的档没有单一渲染值，拿 scale=1 的读数当等式去要求
 * 调用点改类名是错的（今天被跳过的正是上面那三颗标题档，两条理由叠在同一批名字上）。
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** Tailwind 默认字阶的出处（依赖自带，不抄进仓库当第二本账）。 */
function tailwindThemeCss(): string {
  return require.resolve("tailwindcss/theme.css");
}

const TEXT_DECL_RE = /^\s*--text-([a-z0-9]+)\s*:\s*([0-9.]+)(rem|px)\s*;/gm;

/** 一条 `--text-*` 声明渲染成多少 px（rem 按 16 换算，与 Tailwind 的口径一致）。 */
function toPx(value: string, unit: string): number {
  const n = Number.parseFloat(value);
  return unit === "rem" ? n * 16 : n;
}

export interface TextTiers {
  /** 渲染 px → 档名（多个档同名值时保留第一个，仅用于报错话术）。 */
  byPx: Map<number, string>;
  /** 当前在用的全部档名（已按 t-shirt 形状筛过）。 */
  names: string[];
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
      if (!m[1] || !m[2] || !m[3]) continue;
      if (fromProject && !fromProjectIsUsable(m[1], tshirt, defaults)) continue;
      if (!fromProject) defaults.add(m[1]);
      collected.set(m[1], toPx(m[2], m[3]));
    }
  }

  const byPx = new Map<number, string>();
  const names: string[] = [];
  for (const [name, px] of [...collected].sort((a, b) => a[1] - b[1])) {
    names.push(name);
    if (!byPx.has(px)) byPx.set(px, name);
  }
  if (names.length === 0) {
    throw new Error(
      "一个字阶档位都没解出来 —— 依赖里的 Tailwind 默认表或 globals.css 的形状变了，" +
        "「调用点不许把档位值重抄成字面 px」那条判据会因此空转（永远绿）。",
    );
  }
  return { byPx, names };
}

/** 项目自加的档名：t-shirt 形状、或覆盖的是一个默认名（那 `cn` 本来就认识）才算可用。 */
function fromProjectIsUsable(
  name: string,
  tshirt: RegExp,
  defaults: Set<string>,
): boolean {
  return tshirt.test(name) || defaults.has(name);
}
