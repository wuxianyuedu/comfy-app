/** 按钮 / 可点元素的悬停底色必须**加深**非悬停态底色（ISSUE #4074）的回归判据：
 *  同一 class 字面量里，「非悬停态的 bg-」与「hover 的 bg-」按主题分组比较，两条：
 *  ① 同一有效 token（muted/secondary 视为 subtle 的别名，globals.css 把它们转发到
 *     var(--color-subtle)）：hover 的 α 必须严格大于非悬停态的 α（不写 α 视为 100）；
 *  ② 双方都在表面阶梯档（bg/canvas < panel-deep < card/surface/panel < surface-1 <
 *     subtle/surface-row < surface-2）：hover 的档位序号不得小于非悬停态。
 *  豁免：① hover 带状态前缀（aria-checked、data-checked、group 等「选中档悬停与常态同值」
 *  的钉法，理由见 ui/select-chip.tsx 文件头）；② 字面量含 plain 同值钉法的
 *  「选中态」例外，逐个登记在 EXCEPTIONS 里并写明理由。
 *  判不了的跨色相对（如 bg-card → hover:bg-danger/15 的删除预告）刻意不判 —— 那个
 *  维度没有机器可判的「加深」定义，误报一片比漏报更坏。
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_ROOT = fileURLToPath(new URL("../src", import.meta.url));

/* 表面阶梯：序号 = 离页面底的距离（浅色更深、深色更亮），hover 不得小于非悬停态。 */
const SURFACE_RANK = new Map<string, number>([
  ["bg", 0],
  ["background", 0],
  ["canvas", 0],
  ["panel-deep", 1],
  ["card", 2],
  ["surface", 2],
  ["panel", 2],
  ["surface-0", 2],
  ["surface-1", 3],
  ["subtle", 4],
  ["surface-row", 4],
  ["surface-2", 5],
]);

/* globals.css 把 muted / secondary 转发到 var(--color-subtle)：同值别名。 */
const ALIAS = new Map<string, string>([
  ["muted", "subtle"],
  ["secondary", "subtle"],
]);

/** 选中态 plain 同值钉法的登记处：[文件（相对 src 的 posix 路径）, 理由]。 */
const EXCEPTIONS: ReadonlyArray<readonly [string, string]> = [
  [
    "components/settings/SettingsShell.tsx",
    "选中导航项悬停钉住 primary-soft：ghost 自带的 hover 会把已选中那枚翻成未选中档（同 select-chip 文件头那条注释）",
  ],
  [
    "components/ui/seed-mode-button.tsx",
    "选中项悬停钉住 node-accent（aria-selected 选中行不翻底色），与 select-chip 同族钉法",
  ],
  [
    "components/studio/assets/AssetFolderTree.tsx",
    "资产目录分类根节点选中态悬停钉住 primary-soft：ghost 自带的 hover 会把已选中那枚翻成未选中档（同 select-chip 文件头那条注释）",
  ],
  [
    "components/workshop/ModelTestTree.tsx",
    "模型树单选叶子的选中态悬停钉住 primary-soft：role=radio 的已选中档不翻底色，同 select-chip 钉法",
  ],
];

/** 拆一个 Tailwind 工具 token 为 { theme, modifiers, utility }。 */
function splitToken(token: string) {
  const parts = token.split(":");
  const utility = parts.at(-1) ?? "";
  const modifiers = parts.slice(0, -1);
  const theme = modifiers.includes("dark") ? "dark" : "light";
  return { theme, modifiers, utility };
}

/** 解析 bg-<color>[/<alpha>]；解析不了返回 null。 */
function parseBg(utility: string): { alpha: number; color: string } | null {
  const m = /^bg-(?<color>[\w-]+)(?:\/(?<alpha>\d+))?$/.exec(utility);
  if (m?.groups === undefined) {
    return null;
  }
  const color = ALIAS.get(m.groups.color ?? "") ?? m.groups.color ?? "";
  const alpha = m.groups.alpha === undefined ? 100 : Number(m.groups.alpha);
  return { alpha, color };
}

function collectClassLiterals(src: string) {
  const out: Array<{ line: number; literal: string }> = [];
  const push = (literal: string, index: number) => {
    out.push({ literal, line: src.slice(0, index).split("\n").length });
  };
  const re =
    /"(?<dquote>[^"\n]*hover:bg-[^"\n]*)"|'(?<squote>[^'\n]*hover:bg-[^'\n]*)'|`(?<btick>[^`]*hover:bg-[^`]*)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const quoted = m.groups?.dquote ?? m.groups?.squote;
    if (quoted !== undefined) {
      push(quoted, m.index);
      continue;
    }
    /* 反引号字面量里可能是跨行 JSX：先剥掉 ${...} 插值体（内部的引号串会被各支
       分支自行扫到），再按 JSX 标记边界切碎，避免把相邻元素的类并进一组配对。 */
    const raw = (m.groups?.btick ?? "").replaceAll(/\$\{[^}]*\}/gs, " ");
    for (const fragment of raw.split(/[<>{}()]/)) {
      if (fragment.includes("hover:bg-")) {
        push(fragment, m.index);
      }
    }
  }
  return out;
}

function* walkTsx(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkTsx(full);
    } else if (entry.name.endsWith(".tsx")) {
      yield full;
    }
  }
}

describe("按钮悬停态必须加深非悬停态（#4074）", () => {
  const findings: Array<string> = [];
  for (const file of walkTsx(SRC_ROOT)) {
    const rel = relative(SRC_ROOT, file).split(sep).join("/");
    const src = readFileSync(file, "utf8");
    for (const { literal, line } of collectClassLiterals(src)) {
      const tokens = literal.split(/\s+/).filter(Boolean);
      const sets = new Map<
        string,
        {
          bases: Array<{ alpha: number; color: string }>;
          hovers: Array<{ alpha: number; color: string }>;
        }
      >();
      for (const token of tokens) {
        const { theme, modifiers, utility } = splitToken(token);
        const bg = parseBg(utility);
        if (bg === null) {
          continue;
        }
        /* 只有「无状态前缀（仅 dark:）」才是常态/悬停配对面：active-/data-/aria-
           开头的都是条件态，与 plain hover 配对会得到假命中。 */
        if (modifiers.some((mod) => mod !== "hover" && mod !== "dark")) {
          continue;
        }
        const set = sets.get(theme) ?? { bases: [], hovers: [] };
        if (modifiers.includes("hover")) {
          set.hovers.push(bg);
        } else {
          set.bases.push(bg);
        }
        sets.set(theme, set);
      }
      for (const [theme, set] of sets) {
        for (const hover of set.hovers) {
          for (const base of set.bases) {
            const excepted = EXCEPTIONS.some(([path]) => rel === path);
            /* ① 同一有效 token：hover 的 α 必须更大。 */
            if (hover.color === base.color && hover.alpha <= base.alpha) {
              if (!excepted) {
                findings.push(
                  `${rel}:${line} [${theme}] bg-${base.color}/${base.alpha} → hover:bg-${hover.color}/${hover.alpha}（同值或更浅）\n    ${literal.trim().slice(0, 160)}`,
                );
              }
              continue;
            }
            /* ② 表面阶梯：hover 档位不得更浅。 */
            const baseRank = SURFACE_RANK.get(base.color);
            const hoverRank = SURFACE_RANK.get(hover.color);
            if (baseRank !== undefined && hoverRank !== undefined && hoverRank < baseRank) {
              findings.push(
                `${rel}:${line} [${theme}] bg-${base.color} → hover:bg-${hover.color}（悬停比常态更浅）\n    ${literal.trim().slice(0, 160)}`,
              );
            }
          }
        }
      }
    }
  }

  it("src/**/*.tsx 没有「悬停不加深」的 bg 对", () => {
    expect(findings, findings.join("\n\n")).toEqual([]);
  });

  it("豁免登记的文件确实存在且还在用到同值钉法（防豁免过期）", () => {
    for (const [path] of EXCEPTIONS) {
      const full = join(SRC_ROOT, ...path.split("/"));
      const text = readFileSync(full, "utf8");
      expect(
        text.includes("hover:bg-"),
        `${path} 已不再有同值钉法，把 EXCEPTIONS 里的豁免删掉`,
      ).toBe(true);
    }
  });
});
