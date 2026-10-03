/**
 * `docs/DESIGN.md` 与 `src/app/globals.css` 的同步判据 —— 设计契约的执行者。
 *
 * 为什么这条必须有执行者：契约正文引用了上百颗 token 名和一串具体取值，而
 * `docs/` 根级的 `.md` **不在** `doc:check` 的遍历面上（`doc-facts.cjs` 的
 * `SCOPED_DOC_DIRS` 只含 `docs/standards` 与 `docs/guides`）。也就是说「改了
 * token 的名字或值、忘了改文档」不会让任何东西变红 —— 那是零执行者判据那一族
 * （规范 §13.5.8），表现不是红，而是**文档又开始说谎而全绿**。
 *
 * 两格各管一件事：
 * ① **引用面**：文档里「整个行内代码就是一颗裸 token 名」的写法，必须在编译产物
 *    里有声明。这是规范 §3.6.1.1②「幽灵 token」判据的反方向 —— 那条管代码引用
 *    查无此名，这条管**文档**引用查无此名。
 * ② **取值面**：Colors 表里「单元格正好是一颗 `#rrggbb`」的那些行，两态取值必须
 *    等于产物解析出来的值。`同值` 表示该态等于浅色档。
 *
 * 刻意**不**管的边界（写成判据会误报一片，或本身就是另一条路的断言）：
 * - frontmatter 的 `colors` / `components` 值。它们的名字是**角色名**
 *   （`hairline`）、不是 CSS 名（`--color-border`），且透明档 `/15` 压成 `rgba`、
 *   oklch 压成 sRGB 都只近似 —— 拿近似值做等值断言等于造一台假红机。
 * - 一格单元格里并列多颗 token（`--color-surface` / `--color-card`）或写成
 *   `oklch(…) ⇒ #hex` 的行：解析不到单一形态就跳过，不猜。
 * - `docs/standards/**` 的样式章节由 `doc:check` 管，这里不重复。
 *
 * 取值口径：复用 `tests/helpers/theme-tokens.ts`（真编译 `globals.css` + 自己解析
 * `var()` 链）。**不要改回 `getComputedStyle`，也不要正则读源码**：jsdom 不解析
 * `var()`，而源码正则看不见 Tailwind 的 tree-shake 与层叠胜负（理由见该文件头部）。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { loadThemeTokens, type ThemeTokens } from "./helpers/theme-tokens";

const DOC_PATH = fileURLToPath(new URL("../docs/DESIGN.md", import.meta.url));
const COLOR_TOKEN = /^--color-[a-z0-9-]+$/;

/** 抽出「整个行内代码就是一颗 `--color-*`」的引用名（去重、排序）。 */
function collectBareTokenCitations(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(/`(--color-[a-z0-9-]+)`/g)) {
    if (match[1]) names.add(match[1]);
  }
  return [...names].sort();
}

/** ①的判决：引用了但产物里没有声明的名字。 */
function findUnknownTokens(
  cited: string[],
  exists: (name: string) => boolean,
): string[] {
  return cited.filter((name) => !exists(name));
}

type HexRow = {
  token: string;
  /** 该态文档写的是单一 `#rrggbb`；否则为 undefined（跳过，不猜）。 */
  light?: string;
  dark?: string;
};

/** 单元格必须是**单独一颗**且**形如** `shape` 的行内代码。 */
function singleCodeSpan(cell: string, shape: RegExp): string | null {
  const match = /^`([^`]+)`$/.exec(cell);
  if (!match?.[1]) return null;
  return shape.test(match[1]) ? match[1] : null;
}

function parseHexCell(cell: string): string | null {
  return singleCodeSpan(cell, /^#[0-9a-fA-F]{6}$/)?.toLowerCase() ?? null;
}

/**
 * 解析 Colors 表的行。列序固定为「角色 | token | 浅色 | 深色 | 用在哪」。
 * 表头找不到就返回 null —— 让调用方判红，而不是「解析到 0 行」当成全绿空转。
 */
function collectHexRows(section: string): HexRow[] {
  const rows: HexRow[] = [];
  for (const line of section.split(/\r?\n/)) {
    if (!line.trimStart().startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 5) continue;
    // slice(1, -1) 已去掉首尾两个空格子 ⇒ 列序是 0 角色 / 1 token / 2 浅色 / 3 深色 / 4 用途
    const token = singleCodeSpan(cells[1] ?? "", COLOR_TOKEN);
    if (!token) continue;
    const light = parseHexCell(cells[2] ?? "");
    const dark = (cells[3] ?? "").includes("同值") ? light : parseHexCell(cells[3] ?? "");
    if (!light && !dark) continue;
    rows.push({
      token,
      ...(light ? { light } : {}),
      ...(dark ? { dark } : {}),
    });
  }
  return rows;
}

function sectionBetween(text: string, heading: string): string | null {
  const start = text.indexOf(heading);
  if (start < 0) return null;
  const body = text.slice(start + heading.length);
  const end = body.search(/^###\s/m);
  return end < 0 ? body : body.slice(0, end);
}

/** 归一化产物值：只认 `#rrggbb` / `#rgb`，其余返回 null（该格不比）。 */
function normalizeCssHex(value: string | undefined): string | null {
  if (!value) return null;
  const raw = value.trim().toLowerCase();
  const six = /^#([0-9a-f]{6})$/.exec(raw);
  if (six?.[1]) return `#${six[1]}`;
  const three = /^#([0-9a-f]{3})$/.exec(raw);
  if (three?.[1]) {
    return `#${[...three[1]].map((c) => c + c).join("")}`;
  }
  return null;
}

/** ②的判决：文档值与产物值不一致的格。 */
function findHexMismatch(
  rows: HexRow[],
  resolve: (name: string, state: "light" | "dark") => string | undefined,
): string[] {
  const bad: string[] = [];
  for (const row of rows) {
    for (const state of ["light", "dark"] as const) {
      const doc = row[state];
      if (!doc) continue;
      const actual = normalizeCssHex(resolve(row.token, state)) ?? "(产物里不是单一 hex)";
      if (actual !== doc) bad.push(`${row.token} ${state}: 文档 ${doc} / 产物 ${actual}`);
    }
  }
  return bad;
}

let doc = "";
let light: ThemeTokens;
let dark: ThemeTokens;

beforeAll(async () => {
  doc = readFileSync(DOC_PATH, "utf8");
  ({ light, dark } = await loadThemeTokens());
});

describe("docs/DESIGN.md 的 token 引用面（幽灵 token 的文档方向）", () => {
  it("引用到的每一颗 --color-* 在编译产物里有声明", () => {
    const cited = collectBareTokenCitations(doc);
    // 取到 0 条 = 判据在空转（同「按 marker 定位再解析」那一族的红法）
    expect(cited.length, "文档里一颗 token 都没引用到 —— 解析失效").toBeGreaterThan(
      20,
    );
    const unknown = findUnknownTokens(cited, (name) => light.has(name) || dark.has(name));
    expect(
      unknown,
      `文档引用了产物里查无此名的 token（改名或删token 时这份契约不会响）：${unknown.join(", ")}`,
    ).toEqual([]);
  });

  it("负控制：引用一个不存在的名字必须被判出来（否则上一条绿得没有意义）", () => {
    const fixture = "底 `--color-canvas` 与假想的 `--color-zprobe-not-a-token`。";
    expect(findUnknownTokens(collectBareTokenCitations(fixture), (name) =>
      light.has(name) || dark.has(name),
    )).toEqual(["--color-zprobe-not-a-token"]);
    // 而真存在的名字不许被误报
    expect(findUnknownTokens(["--color-canvas"], (name) => light.has(name))).toEqual([]);
  });
});

describe("docs/DESIGN.md 的 Colors 表与两态取值", () => {
  it("表在、行解析得到（表头漂了要当场响）", () => {
    const section = sectionBetween(doc, "### 语义角色表");
    expect(section, "找不到「语义角色表」小节 —— 文档结构变了要同步这里的锚点").not.toBeNull();
    const rows = collectHexRows(section ?? "");
    expect(rows.length, "Colors 表解析到 0 行 —— 判据在空转").toBeGreaterThan(5);
  });

  it("单一 hex 的格子等于编译产物里该态的取值", () => {
    const section = sectionBetween(doc, "### 语义角色表") ?? "";
    const mismatch = findHexMismatch(collectHexRows(section), (name, state) =>
      (state === "light" ? light : dark).get(name),
    );
    expect(
      mismatch,
      `契约里的取值与 globals.css 对不上（以 CSS 为准，改文档）：\n${mismatch.join("\n")}`,
    ).toEqual([]);
  });

  it("负控制：浅档写对、深档写错时只报深档那一格", () => {
    const fixture =
      "| 弱文字 | `--color-ink-muted` | `#6b6b76` | `#000000` | x |\n" +
      "| 表头 | -- | -- | -- | -- |\n";
    const rows = collectHexRows(fixture);
    expect(rows).toEqual([{ token: "--color-ink-muted", light: "#6b6b76", dark: "#000000" }]);
    const bad = findHexMismatch(rows, (name, state) =>
      (state === "light" ? light : dark).get(name),
    );
    expect(bad.length, "深档写错必须被报出来").toBe(1);
    expect(bad[0]).toContain("dark");
  });

  it("多形态单元格一律跳过、不猜", () => {
    const skip = collectHexRows(
      [
        "| 品牌实心档 | `--color-primary-500` / `--color-primary-600` | `#8b5cf6` / `#7c3aed` | 同值 | x |",
        "| 危险 | `--color-destructive` | `oklch(0.577 0.245 27.325)` ⇒ `#e7000b` | y |",
      ].join("\n"),
    );
    expect(skip, "一格并列两颗 token / 值不是单一 hex 时不许产生断言").toEqual([]);
  });
});
