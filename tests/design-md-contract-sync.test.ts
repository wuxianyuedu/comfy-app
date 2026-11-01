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
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { parseRadiusScale, renderedRadiusValues } from "./helpers/radius-scale";
import { parseTextTiers, renderedLineHeightPx } from "./helpers/text-tiers";
import { stripComments } from "./helpers/strip-comments";
import { loadThemeTokens, type ThemeTokens } from "./helpers/theme-tokens";

const DOC_PATH = fileURLToPath(new URL("../docs/DESIGN.md", import.meta.url));
const ROOT_DIR = fileURLToPath(new URL("..", import.meta.url));
const COLOR_TOKEN = /^--color-[a-z0-9-]+$/;

/** 抽出「整个行内代码就是一颗 `--color-*`」的引用名（去重、排序）。 */
function collectBareTokenCitations(text: string): Array<string> {
  const names = new Set<string>();
  for (const match of text.matchAll(/`(--color-[a-z0-9-]+)`/g)) {
    if (match[1]) {
      names.add(match[1]);
    }
  }
  return [...names].sort();
}

/** ①的判决：引用了但产物里没有声明的名字。 */
function findUnknownTokens(cited: Array<string>, exists: (name: string) => boolean): Array<string> {
  return cited.filter((name) => !exists(name));
}

type HexRow = {
  dark?: string;
  /** 该态文档写的是单一 `#rrggbb`；否则为 undefined（跳过，不猜）。 */
  light?: string;
  token: string;
};

/** 单元格必须是**单独一颗**且**形如** `shape` 的行内代码。 */
function singleCodeSpan(cell: string, shape: RegExp): string | null {
  const match = /^`([^`]+)`$/.exec(cell);
  if (!match?.[1]) {
    return null;
  }
  return shape.test(match[1]) ? match[1] : null;
}

function parseHexCell(cell: string): string | null {
  return singleCodeSpan(cell, /^#[0-9a-fA-F]{6}$/)?.toLowerCase() ?? null;
}

/**
 * 解析 Colors 表的行。列序固定为「角色 | token | 浅色 | 深色 | 用在哪」。
 * 表头找不到就返回 null —— 让调用方判红，而不是「解析到 0 行」当成全绿空转。
 */
function collectHexRows(section: string): Array<HexRow> {
  const rows: Array<HexRow> = [];
  for (const line of section.split(/\r?\n/)) {
    if (!line.trimStart().startsWith("|")) {
      continue;
    }
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length < 5) {
      continue;
    }
    // slice(1, -1) 已去掉首尾两个空格子 ⇒ 列序是 0 角色 / 1 token / 2 浅色 / 3 深色 / 4 用途
    const token = singleCodeSpan(cells[1] ?? "", COLOR_TOKEN);
    if (!token) {
      continue;
    }
    const light = parseHexCell(cells[2] ?? "");
    const dark = (cells[3] ?? "").includes("同值") ? light : parseHexCell(cells[3] ?? "");
    if (!light && !dark) {
      continue;
    }
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
  if (start === -1) {
    return null;
  }
  const body = text.slice(start + heading.length);
  const end = body.search(/^###\s/m);
  return end < 0 ? body : body.slice(0, end);
}

/** 归一化产物值：只认 `#rrggbb` / `#rgb`，其余返回 null（该格不比）。 */
function normalizeCssHex(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const raw = value.trim().toLowerCase();
  const six = /^#([0-9a-f]{6})$/.exec(raw);
  if (six?.[1]) {
    return `#${six[1]}`;
  }
  const three = /^#([0-9a-f]{3})$/.exec(raw);
  if (three?.[1]) {
    return `#${[...three[1]].map((c) => c + c).join("")}`;
  }
  return null;
}

/** ②的判决：文档值与产物值不一致的格。 */
function findHexMismatch(
  rows: Array<HexRow>,
  resolve: (name: string, state: "light" | "dark") => string | undefined,
): Array<string> {
  const bad: Array<string> = [];
  for (const row of rows) {
    for (const state of /* SAFETY: 类型断言已复核 */ ["light", "dark"] as const) {
      const doc = row[state];
      if (!doc) {
        continue;
      }
      const actual = normalizeCssHex(resolve(row.token, state)) ?? "(产物里不是单一 hex)";
      if (actual !== doc) {
        bad.push(`${row.token} ${state}: 文档 ${doc} / 产物 ${actual}`);
      }
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
    expect(cited.length, "文档里一颗 token 都没引用到 —— 解析失效").toBeGreaterThan(20);
    const unknown = findUnknownTokens(cited, (name) => light.has(name) || dark.has(name));
    expect(
      unknown,
      `文档引用了产物里查无此名的 token（改名或删token 时这份契约不会响）：${unknown.join(", ")}`,
    ).toEqual([]);
  });

  it("负控制：引用一个不存在的名字必须被判出来（否则上一条绿得没有意义）", () => {
    const fixture = "底 `--color-canvas` 与假想的 `--color-zprobe-not-a-token`。";
    expect(
      findUnknownTokens(
        collectBareTokenCitations(fixture),
        (name) => light.has(name) || dark.has(name),
      ),
    ).toEqual(["--color-zprobe-not-a-token"]);
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

/* ── 调用侧：契约里的档位必须真的被用上 ──────────────────────────────
   上面两格判的是「文档说的值 = CSS 定义的值」。这一格补另一半：
   **调用点有没有真的用档位**。圆角这一刀落地后暴露出缺口 —— T4 只看
   `globals.css` 的定义，看不见 `className="rounded-[ 16px ]"` 这种「把档位
   当前渲染值重抄一遍」的写法：它此刻像素正确，但设置页改基数时不跟手，
   等于在总闸旁边开了个旁通。字号同理（契约 §Typography 明写不要写
   字面字号，而调用点还有几百处存量）。 */

const SRC_DIR = fileURLToPath(new URL("../src", import.meta.url));
const GLOBALS_PATH = fileURLToPath(new URL("../src/app/globals.css", import.meta.url));
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "coverage", "__snapshots__"]);

/** 产品代码面：`.stories.` 与 `.test.` 排除在外 —— 它们不是设计系统的消费者，
 *  拿像素契约绑住演示件与用例只会逼人往 story 里塞无意义的类名。 */
function collectProductFiles(dir: string, out: Array<string> = []): Array<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) {
        collectProductFiles(p, out);
      }
    } else if (
      /\.(ts|tsx)$/.test(e.name) &&
      !/\.stories\.tsx?$/.test(e.name) &&
      !/\.test\.tsx?$/.test(e.name)
    ) {
      out.push(p);
    }
  }
  return out;
}

/** 剥注释后扫一颗全局正则，返回每条命中的「相对路径 + 捕获组 1」。
 *  行号不报：`stripComments` 会把块注释整段拿掉、行号随之漂移（它自己的文件头
 *  就写明不是词法分析器）。行尾 `// …` 注释也不去 —— 那需要真词法分析，
 *  代价是「行尾注释里写字面 px」会被算进棘轮，方向是保守的（只多计不少计）。 */
function scanProduct(pattern: RegExp): Array<{ file: string; value: string }> {
  const hits: Array<{ file: string; value: string }> = [];
  for (const abs of collectProductFiles(SRC_DIR)) {
    const code = stripComments(readFileSync(abs, "utf8"));
    const rel = path.relative(ROOT_DIR, abs).split(path.sep).join("/");
    for (const m of code.matchAll(pattern)) {
      if (m[1]) {
        hits.push({ file: rel, value: m[1] });
      }
    }
  }
  return hits;
}

/**
 * 屏级副说明的**最低档**：`.u-title-page` 之后 4 行内的第一个 `<p>` 不许低于
 * `text-sm`(14px)。三枚候选就是 Tailwind 里低于默认正文（`text-sm`）的那些具名档。
 *
 * 为什么按「偏低」判而不是按「等于 text-xs」判：这一档**只需挡住写小的**，
 * 更大的档（`text-base` 及以上）不是这个判据要管的事 —— 它管的是「副说明被写成
 * 了小字」，也就是用户在「模式契约 / 模型适配」两屏上抱怨的那件事。
 */
const BELOW_BODY_TIERS = /\btext-(xs|2xs|3xs)\b/;

/**
 * 扫「屏级标题之下那行副说明」被写成小字的落点（ISSUE #1751）。
 *
 * 形状是两件在**同一段行邻域**内同现，缺一不算：
 *   ① 一枚 `.u-title-page` 的屏级标题（P83 已要求的那一档）；
 *   ② 它之后 **4 行内**出现的**第一个** `<p>` 开标签，且那枚 `<p>` 的 class
 *      里写着低于 `text-sm` 的档（`text-xs` / `text-2xs` / `text-3xs`）。
 *
 * ## 为什么这条与 P86 是互补而不是重复
 *
 * P86 锚的是「`.u-title-page` + 一行 `mt-1 text-sm` 副说明」**同现** ——
 * 它要 `text-sm` 才起跳。于是**把档写低反而绕过了它**：两屏此前是
 * `h3` + `.u-title` + `p.text-xs`，连 `.u-title-page` 都没有，P86 天然看不见。
 * 这条换一头锚：只认「标题档 + 后面那个 `<p>`」，**不看那枚 `<p>` 的间距档**
 * （`mt-1` / `mt-2` 都算），于是「档写低」这件事本身成了唯一的判据对象。
 *
 * ## 只认第一个 `<p>`
 *
 * 页头之后的第一枚 `<p>` 就是副说明那一行；再往后可能是正文段落（自有其档）。
 * 认「4 行内第一个」而不是「4 行内任意一个」，是为了不让屏头之后的第三、四行
 * 正文段落把这条判据叫响 —— 那正是 ISSUE 里点名的「宽判据会误伤一片」。
 */
function firstSubtitleViolation(text: string): Array<number> {
  const hits: Array<number> = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!/\bu-title-page\b/.test(lines[i] ?? "")) {
      continue;
    }
    /* 标题行之后 4 行内找第一个 `<p>` 开标签 —— 找到就判、判完就停。 */
    for (const line of lines.slice(i + 1, i + 5)) {
      if (!/<p[\s>]/.test(line)) {
        continue;
      }
      if (BELOW_BODY_TIERS.test(line)) {
        hits.push(i + 1);
      }
      break;
    }
  }
  return hits;
}

/** 判据与它的负控制共用这一个出口 —— 否则负控制测的是另一套逻辑，红了也证明不了判据。 */
function scanTitleSubtitleBelowBody(): Array<{ file: string; line: number }> {
  const hits: Array<{ file: string; line: number }> = [];
  for (const abs of collectProductFiles(SRC_DIR)) {
    const rel = path.relative(ROOT_DIR, abs).split(path.sep).join("/");
    for (const line of firstSubtitleViolation(stripComments(readFileSync(abs, "utf8")))) {
      hits.push({ file: rel, line });
    }
  }
  return hits;
}

/** 调用点的「字面圆角」形状：rounded- / rounded-b- / rounded-t- 都算。 */
const RADIUS_LITERAL = /\brounded(?:-[a-z]+)?-\[(\d+(?:\.\d+)?)px\]/g;
/** 调用点的「字面字号」形状（含 10.5px 这类小数档）。 */
const TEXT_LITERAL = /\btext-\[(\d+(?:\.\d+)?)px\]/g;
/** `@theme` 的档名允许的 t-shirt 形状（xs / sm / md / lg / xl 与 2xs…9xl）。 */
const TSHIRT_NAME = /^(?:xs|sm|md|lg|xl|[2-9](?:xs|sm|md|lg|xl))$/;

/**
 * 类型 chip 的形状标记 —— 六个标记**全命中**才算同一枚 chip。
 *
 * 为什么按标记集合、不按先后顺序：和序号圆那条同理（类名在源码里的排列是实现
 * 细节，`px-* py-*` 由 size 三元式给、就排在 `font-semibold` 之后）；也正因为
 * 要「全命中」，`ParamOwnerTag` 那枚带描边的 `px-1.5 py-px font-medium` 不会被
 * 误抓 —— 它本来就是一枚不同的东西，故意没并进来。
 */
const TYPE_CHIP_MARKS = [
  /inline-flex/,
  /items-center/,
  /shrink-0/,
  /rounded-\[3px\]/,
  /font-semibold/,
  /px-1\.5 py-0\.5/,
];

/**
 * 节点头部右侧胶囊的形状标记。`px-2` 后面带 `(?![\w.])` 是必需的：否则
 * `px-2.5` / `px-2rem` 也算命中（`\b` 在 `2` 与 `.` 之间就是边界，挡不住）。
 */
const NODE_PILL_MARKS = [
  /flex h-5/,
  /items-center/,
  /shrink-0/,
  /gap-1\.25/,
  /rounded-\[11px\]/,
  /px-2(?![\w.])/,
];

/**
 * 区头那一行的标记。刻意**不**单拿计数胶囊当判据：`WorkflowIOPreviewPanel.tsx:206`
 * 也有一枚同款计数，只是底色走 `bg-subtle`（它坐在 `bg-panel` 的浮层上）—— 那是
 * 「同一形状、不同表面」的合理分叉，不是要收的孪生。这四枚标记要**全命中**才认，
 * 于是只描述那一行，不误伤那一枚孤立的计数。
 */
const SECTION_HEADER_MARKS = [
  /size-2 shrink-0 rounded-full/,
  /text-3xs font-semibold tracking-wider uppercase/,
  /rounded-full px-1\.5 py-px font-mono/,
  /border-t border-dashed bg-transparent/,
];

/**
 * 面板里铺满居中的轻量占位（`EmptyState` 的第四档）。
 *
 * 这一族的标记**只许按单行判**（下面 `scope: "line"`），这是量出来的、不是洁癖：
 * 这七枚标记每一枚都很常见，按整文件全命中判会误抓三处无关文件
 * （实测整文件口径命中 9 个文件，其中 `HistoryPanel.tsx` 的 `flex h-full` 在第 69 行、
 * `justify-center` 在第 230 行；`ProjectGate.tsx` 命中的 `text-ink-fainter` 其实是
 * `placeholder:text-ink-fainter`；`ShellTabs.tsx` 那一处是页签诊断卡、不是空态）。
 * 收到「同一枚 class 字符串」上，实测严格同形正好 5 处、零误抓 —— 判据描述的形状
 * 与「一个人手抄会抄下的东西」同宽：手抄的人抄的就是这一整串。
 */
const PANEL_MARKS = [
  /\btext-ink-fainter\b/,
  /\bflex h-full\b/,
  /\bflex-col\b/,
  /\bitems-center\b/,
  /\bjustify-center\b/,
  /gap-2(?![\w.])/,
  /\btext-sm\b/,
];

/**
 * 段级小标题那一行（标题 + 同行 hint）的标记 —— 出口是
 * `~/components/ui/section-label` 的 `<SectionLabel>`。
 *
 * 三枚要**全命中**才认，而每一枚都常见，所以收窄靠的是「三枚同现」这件事本身：
 * 实测（`stripComments` 后按文件全命中）恰好只有实现自己一处 —— 另外几处看着
 * 像的都被挡在门外：
 *   · `ComfyuiStoragePaths` 那行有同样的 wrapper 与 hint 档，但标题是
 *     `font-medium`（不是 `font-semibold`）⇒ 它是另一档，**刻意不同形**；
 *   · `AppearanceSection` 的 wrapper 是 `gap-2`（不是 `gap-x-2`）；
 *   · `FinalComposer` / `WorkshopAside` 只有那枚 `text-ink text-sm font-semibold`
 *     的 `<span>`，没有段级小标题的 wrapper。
 */
const SECTION_LABEL_MARKS = [
  /mb-2 flex flex-wrap items-baseline gap-x-2/,
  /text-ink text-sm font-semibold/,
  /text-muted-foreground text-xs/,
];

/**
 * 节点底部那枚「▶ 用此工作流生成」（全宽渐变 + 跟品牌走的投影）。
 *
 * 收它的原因与前面几族不同：这不是「两个屏各抄一份」，而是**同一枚按钮在三处
 * 各写一套参数** —— 高度一枚写成 43px 的字面量、两枚写 `h-10.75`（同为 43px，但只有后者
 * 跟着 `--spacing` 走）；投影一枚进 class、一枚进 `style`（进 `style` 的那枚不吃
 * `color-mix` 的类内转义，改档要改两处）；hover 一档 95 一档 90；variant 一枚 `ghost`
 * 两枚 `primary-solid`。这些差异每一个都「看着无所谓」，合起来就是四处漂移。
 *
 * **只描同一行里的那份基础形状**（`scope: "line"`）：`corner` 那一档分叉刻意不进标记 ——
 * 它是「卡片裁切不裁切」的宿主差异，唯一出处里带两个形态是设计的一部分，把它写进标记
 * 等于要求判据去抓一个本来就该分叉的东西。
 */
const GENERATE_BUTTON_MARKS = [
  /from-primary to-accent/,
  /\bh-10\.75\b/,
  /bg-linear-to-r/,
  /text-sm font-bold/,
  /shadow-\[0_4px_12px_color-mix/,
];

/** 一族的标记在给定文本里是否算「同一枚形状」。`scope: "line"` 逐行判，其余整段判。
 *  判据与它的负控制共用这一个出口 —— 否则负控制测的是另一套逻辑，红了也证明不了判据。 */
function familyHits(fam: { marks: Array<RegExp>; scope?: "file" | "line" }, text: string): boolean {
  return fam.scope === "line"
    ? text.split(/\r?\n/).some((line) => fam.marks.every((re) => re.test(line)))
    : fam.marks.every((re) => re.test(text));
}

/** 光晕（halo）里的裸色。`0_0_` 前缀本身就是判据：光晕在几何上没有偏移也没有扩散，
 *  投影一定有 —— 所以这条**不收投影**。投影值位里的裸色由另一侧收：
 *  `scripts/check-theme-colors.cjs` 认「源码里写了字面色值」，含写进候选名值位的那些
 *  （口径与它的 `\b` 教训见规范 03 §3.6.2；这里不写全候选名，理由见该节那条「被扫正文
 *  写全一条候选名 = 产物里多一条死规则」）。 */
const HALO_RAW = /shadow-\[0_0_[0-9.]+px_rgba\(/;
/** 任何 shadow 候选名里写 hex（实测全库 0 处，所以也按归零判）。 */
const SHADOW_HEX = /shadow-\[[^\]]*#[0-9a-fA-F]{3,8}\b/;
/** 光晕档：四颗都必须**两态**（浅色 = 基准色、深色 = 400 档浅彩，理由见 globals.css）。 */
const GLOW_TOKENS = [
  "--color-glow-success",
  "--color-glow-warning",
  "--color-glow-danger",
  "--color-glow-brand",
];

describe("调用点必须走档位（§Shapes / §Typography 的实现侧）", () => {
  /** 棘轮基线：本轮清理后实测的存量，只许降不许升（要升得改用例并写理由）。
   *  21→12 是类型 chip 收进 `~/components/studio/TypeChip`（10 处调用点各写一份 →
   *  只剩实现里那一处 + `ParamOwnerTag` 那一枚异类）；12→10 是节点右侧胶囊的两处
   *  手写改走早已存在的 `WorkflowNodePill`（§12.18：有等价实现就先 import）；
   *  **10→7 是逐角色判定的收口**：两处 2px 并到 `rounded-xs`（实测产物里
   *  `--radius-xs: 0.125rem` ⇒ 逐字节同值、零像素），项目卡 18px 并到 `rounded-xl`
   *  （`studio/HomePage.tsx` 那一页本来就有 7 处用它）。剩下的 7 处每件都有自己的
   *  理由，枚举在契约 §Shapes，别当漏网清掉。
   *  字号 302→298 是同上的 `text-3xs` 归一；**298→201 是「同一个 12px 有两种行高」
   *  定档**：103 处 `text-[12px]`（12px + 继承的 1.5 ⇒ 18px）统一成 `text-xs`
   *  （12px + 16px，全库 289 处已在用的那一档）。那条归零判据见下面一条。
   *  **201→140 是同一条口径的第二半**：62 处 `text-[ 13px ]` 并入 `text-sm`（14px，
   *  契约认的「应用默认正文」档）。这一批**带着行高一起变**（19.5 → 16px），
   *  所以 `log-virtual.ts` 的行高常量与它的两处用例是同批改的，不是两件事。 */
  const RADIUS_BASELINE = 7;
  /**
   * **140→122 是同一条「一个尺寸一个名字」口径的第三半**：圆角那条「字面 px 等于某档
   * 当前渲染值就红」此前只判圆角，字号侧只归零了 12 / 13px —— 于是 17 处 14px 的字面量
   * （逐字等于 `text-sm` 的渲染值）与 1 处 18px 的字面量（等于 `text-lg`）长期合法。
   * 这一批**带着行高一起变**（字面量吃继承的 1.5 ⇒ 21px / 27px，档位自带 20px / 28px
   * ⇒ 实际 −1px / +1px；配对值由下面那条行高判据守着，别凭印象改这里），
   * 与 13px 那批同理：改动点所在行是否由文字定高，按结构判（同族最高兄弟元素 ≥ 新行盒），
   * 不靠眼睛。17px 那枚字面量不在射程内 —— 它等于 `--text-stage`，而标题那三颗
   * **根本不是档位**：它们住在 `:root`（不在 `@theme`，因此不生成 utility）、乘
   * `--font-scale` 所以没有单一渲染值，只经 `.u-title*` 使用（从前这里写的是
   * 「改名成 t-shirt 形状就会自动纳入射程」—— 那句不成立：读法只解常量声明，
   * `calc()` 形状它看不见；射程的真正边界是「有没有单一渲染值」，不是档名形状）。
   * 本注释刻意**不写完整的候选名**：被扫到的正文里每写全一枚，产物 CSS 就多一条
   * 没人用的规则（口径见规范 03 §3.6.2），而这一批刚被清零。
   * **122→67 是 10.5px 那一批**：52 处里只有 1 处落在 `h3` 上，其余全是 `<p>` / `<span>`
   * / `<div>` 的元信息行 —— 正是 `text-2xs`(11px) 登记的角色，所以整批并进去、并像
   * 12 / 13px 那样另签一条**归零等式**。方向取「并大」（ISSUE #1751 的结论是「档写低了」），
   * 逐处结构判与 +0.5px 的代价都在下面那条 `it` 里。
   * **67→49 是 9px 立档**（`--text-4xs: 9px`，t-shirt 刻度往下、单调：4xs < 3xs=10 < 2xs=11）。
   * 差的 4 枚是刻意的账：grep 层面这批 22 处里有 4 处在注释里（`ui/badge` 的 `xs` 档说明
   * 与 `ui/list-badge` 的分工表），而棘轮走的是**剥注释**的扫描 —— 注释本来就不计数，
   * 所以只降 18。改注释是为了让产物里那条 9px 规则真的没有出处（口径见契约 §Colors 的
   * 扫描边界：`docs/**` 与 `tests/**` 也一起被扫）。 */
  const TEXT_BASELINE = 49;

  it("没有一处把圆角档位值重抄成字面 px（抄了就脱离设置页的总闸）", () => {
    const scale = parseRadiusScale(readFileSync(GLOBALS_PATH, "utf8"));
    const tierPx = new Set(renderedRadiusValues(scale));
    const offenders = scanProduct(RADIUS_LITERAL).filter((h) =>
      tierPx.has(Number.parseFloat(h.value)),
    );
    expect(
      offenders,
      "这些调用点写的字面 px 正好等于某档的当前渲染值，应改用类名" +
        `（rounded-sm…4xl / rounded-node）：\n${offenders
          .map((o) => `  ${o.file}  rounded-[${o.value}px]`)
          .join("\n")}`,
    ).toEqual([]);
  });

  it("字面字号与字面圆角同一条对称判据：等于具名档渲染值就红", () => {
    /* 圆角那边早就有这条（上一条 `it`），字号此前只归零了 12px / 13px —— 于是
     * 「同一个尺寸两个名字」在 14px 上照样成立：`text-sm` 是契约认的默认正文档，
     * 而调用点还写着同值的字面量。两边共用同一份读法（`tests/helpers/text-tiers.ts`），
     * 值不写死在这里：Tailwind 默认表来自依赖、项目档来自 globals.css。 */
    const tiers = parseTextTiers(readFileSync(GLOBALS_PATH, "utf8"), TSHIRT_NAME);
    /* 先验量具：这条是「等式为 0」的判据，档表解空了会永远绿（比红更糟）。
     * 六颗都是本仓真实在用、且**必须**能被类名表达的档。 */
    for (const [px, name] of /* SAFETY: 类型断言已复核 */ [
      [9, "4xs"],
      [10, "3xs"],
      [11, "2xs"],
      [12, "xs"],
      [14, "sm"],
      [16, "base"],
    ] as const) {
      expect(tiers.byPx.get(px), `档表读空了或取错值：${px}px 应是 ${name}`).toBe(name);
    }
    /* 反向：三颗标题档（`section` / `page` / `stage`）**不在**射程内，两层理由：
     * 它们乘 `--font-scale`，**没有单一渲染值**（14px 的 `section` 在 125% 档下是
     * 17.5px —— 拿 scale=1 的读数去要求调用点改类名是错的）；而且它们的名字不是
     * t-shirt 形状，进 JSX 会撞 `cn()` 那个颜色组坑（`globals.css` 注释自己写着别用）。
     * 17px 那枚字面量今天就是这样一档 —— 别当漏网清掉。 */
    expect(
      tiers.byPx.has(17),
      "乘 --font-scale 的标题档进了射程：它的渲染值随设置页变，等式判据不成立",
    ).toBe(false);
    expect(
      tiers.names.filter((n) => n === "section" || n === "page" || n === "stage"),
      "同上：这三颗一颗都不该在档表里",
    ).toEqual([]);
    /* 那两条筛法各自验一次：`TEXT_DECL_RE` 只认常量形状（`calc()` 那种直接被跳过），
     * 而「非 t-shirt 的自造档名不进射程」这条在今天**筛不掉任何东西** —— 拿一份合成
     * 文本正面验它，否则它只是注释里的承诺，没有执行者。
     * 合成文本**每颗声明各起一行**：那条正则锚的是行首，全写在一行会得到一份空表，
     * 于是三条断言都「因为没解出来」而通过 —— 假绿（这一版就是这么红的）。 */
    const synthetic = parseTextTiers(
      [
        "@theme {",
        "  --text-hero: 34px;",
        "  --text-4xs: 9px;",
        "  --text-tight: calc(1rem * var(--font-scale, 1));",
        "}",
      ].join("\n"),
      TSHIRT_NAME,
    );
    expect(
      synthetic.names.includes("hero"),
      "非 t-shirt 的自造档名进了射程 —— 判据会逼调用点写一个被 `cn()` 当颜色处理的类名",
    ).toBe(false);
    expect(synthetic.names.includes("4xs"), "合法 t-shirt 名被筛掉了").toBe(true);
    expect(synthetic.names.includes("tight"), "乘 --font-scale 的 calc 档被解进了射程").toBe(false);
    expect(
      [..."probe-text-[14px] 与 probe-text-[18px]".matchAll(TEXT_LITERAL)].length,
      "字面字号的正则漂了（这条判据会静默全绿）。样本串带 `probe-` 前缀是刻意的：" +
        "写全一枚候选名，产物 CSS 里就多一条没人用的规则，见 03 §3.6.2",
    ).toBe(2);

    const isTierValue = (value: string) => tiers.byPx.has(Number.parseFloat(value));
    /* 变异：清零之后 offenders 是空集，而「空集 + 写漂的谓词」照样绿 —— 所以谓词
       自己喂两条：等于档位值的必须判违规，不在档表上的不许（9.5px 是还没命名的一档，
       本轮之后 10.5px 也不再是档 —— 它被并进了 2xs，见下面那条归零等式）。 */
    expect(isTierValue("14"), "谓词认不出 14px 就是 text-sm 的渲染值 —— 这条清零判据在空转").toBe(
      true,
    );
    expect(isTierValue("9.5"), "不在档表上的值被判成违规（判据越界了）").toBe(false);

    const offenders = scanProduct(TEXT_LITERAL).filter((h) => isTierValue(h.value));
    expect(
      offenders,
      "这些调用点写的字面 px 正好等于某档的当前渲染值，应改用具名档" +
        `（text-3xs/2xs/xs/sm/base/lg…）：\n${offenders
          .map(
            (o) =>
              `  ${o.file}  text-[${o.value}px] → text-${tiers.byPx.get(Number.parseFloat(o.value))}`,
          )
          .join("\n")}`,
    ).toEqual([]);
  });

  it("字面圆角与字面字号走棘轮：只许降不许升", () => {
    const radius = scanProduct(RADIUS_LITERAL);
    const text = scanProduct(TEXT_LITERAL);
    expect(
      radius.length,
      `调用点字面圆角从 ${RADIUS_BASELINE} 涨到 ${radius.length}；新增的要走档位，` +
        "确需另立一档的按 docs/DESIGN.md §Shapes 的派生式写法并同批改基线",
    ).toBeLessThanOrEqual(RADIUS_BASELINE);
    expect(
      text.length,
      `调用点字面字号从 ${TEXT_BASELINE} 涨到 ${text.length}；契约 §Typography ` +
        "要求先在 @theme 加具名档（档名还得是 t-shirt 形状，见下面那条）",
    ).toBeLessThanOrEqual(TEXT_BASELINE);
  });

  /**
   * 词汇表：住在 `@theme` 之外的每一枚字号，都要有一句「它是干什么的」。
   *
   * 判的是**形状**而不是处数（处数归上面那条 `TEXT_BASELINE` 棘轮）。理由是三处来路的机制
   * 各不相同 —— 调用点的 arbitrary、`globals.css` 里 `@theme` 之外的裸声明、markdown 渲染器
   * 拼的内联样式串 —— 而只有第一处被 Tailwind 的类名机制看得见。缺了这张表，第二、第三处
   * 就是「文档里两句旧话 + 没人数的剩下十几处」；本文上一版正是那个形状（只记了两条来路、
   * 三枚值）。
   *
   * ⚠️ 这里的键是**值的字面形式**（`"12.5"` 而不是任何完整类名）：本文件也在 Tailwind 的
   * 扫描面里，写全一枚就多一条死规则（口径见 `tests/docs-candidate-hygiene.test.ts`）。
   */
  const OUT_OF_THEME_SIZES: Record<string, string> = {
    "7.5": "uppercase 微标（workflow-library/SettingsParts）",
    "8.5": "圆点徽标里的计数（rounded-full 那种窄胶囊）",
    "9.5": "胶囊与角标内的文字（pick chip / owner tag / 参数注脚 / 错误列表的 mono 片段）",
    "10": "markdown 行内 code（与 text-3xs 同值，但走的是内联串）",
    "10.5": "markdown pre —— 全库唯一还在用 10.5px 的地方",
    "11": "json-view 主题类与 markdown 的 h6 / table（11px 本身是 text-2xs 的档值）",
    "11.5": "面板字段标签与次级说明行；同一枚值也是 cb-code-block 的密度",
    "12": "markdown h5",
    "12.5":
      "控制台与卡片的行密度（两处 pre 的等宽正文、表头行、面板条目标题）；同一枚值也是 markdown h4",
    "13.5": "工坊步骤条的标题（与 size-9 序号圆同排）",
    "14": "markdown h3",
    "15": "面板 / 抽屉 / 日志框的区块标题（也用在 size-9 的序号圆里）",
    "16": "markdown h2",
    "17": "--text-stage 的字面量抄本（HomePage 的「最近项目」h2）—— 第 8 刀后拿不到类名，而 stage 不是 t-shirt 形状，所以对称判据按来源分治不收它",
    "18": "markdown h1",
    "28": "水填图的百分比读数（leading-none + tabular-nums，图形内的数字不是排版）",
  };

  it("住在 `@theme` 之外的字号是一张词汇表：新值要先登记角色", () => {
    const MD_STYLES_PATH = fileURLToPath(new URL("../src/lib/markdown/styles.ts", import.meta.url));
    /** 值 → 出现的来路（报错时要能指出「是谁把它带进来的」）。 */
    const inUse = new Map<string, Set<string>>();
    const add = (value: string, source: string) => {
      if (!inUse.has(value)) {
        inUse.set(value, new Set());
      }
      inUse.get(value)!.add(source);
    };

    /* 来路 ①：调用点的 arbitrary 字面量 —— 与棘轮同一个面（产品文件、剥注释）。 */
    for (const hit of scanProduct(TEXT_LITERAL)) {
      add(hit.value, `调用点（如 ${hit.file}）`);
    }
    /* 来路 ②：globals.css 里 `@theme` 之外的裸 font-size 声明。
     * `@theme` 里那些是 `--text-*: 11px`，不带 `font-size:` 这个属性名，所以这条匹配
     * 天然只收声明侧 —— 不必再去切块。 */
    const css = readFileSync(GLOBALS_PATH, "utf8");
    for (const m of css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) {
      add(m[1]!, "globals.css 的裸声明");
    }
    /* 来路 ③：markdown 渲染器拼的内联样式串（既不是 token 也不是候选名）。 */
    const mdStyles = stripComments(readFileSync(MD_STYLES_PATH, "utf8"));
    for (const m of mdStyles.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) {
      add(m[1]!, "markdown 渲染器的内联串");
    }

    expect(
      inUse.size,
      "三处来路一枚字号都没收到 —— 判据在空跑（匹配式或路径写漂了）",
    ).toBeGreaterThanOrEqual(12);

    const unregistered = [...inUse.keys()]
      .filter((v) => !OUT_OF_THEME_SIZES[v])
      .sort((a, b) => Number(a) - Number(b));
    expect(
      unregistered,
      `这些字号活在 \`@theme\` 之外却没登记角色：${unregistered
        .map((v) => `${v}px ← ${[...inUse.get(v)!].join(" / ")}`)
        .join(
          "；",
        )} —— 先在 tests/design-md-contract-sync.test.ts 的 OUT_OF_THEME_SIZES 里写清它是干什么的，` +
        `再把它加进 docs/DESIGN.md §Typography「内容尺寸：住在 @theme 之外的那一片」那张表。`,
    ).toEqual([]);

    const stale = Object.keys(OUT_OF_THEME_SIZES)
      .filter((v) => !inUse.has(v))
      .sort((a, b) => Number(a) - Number(b));
    expect(
      stale,
      `这些登记过的值在三处来路里都已经不存在（还债把某一档并掉了？）—— 表里的行与 ` +
        `docs/DESIGN.md 那一节要一起删，留着就是文档在描述一个不存在的东西：${stale
          .map((v) => `${v}px`)
          .join("、")}`,
    ).toEqual([]);

    /* 文档侧：每个在册且仍在用的值，都要在那一节里以「Npx」的字面形式出现一次。
     * 按**词边界**匹配，别让 10px 靠 10.5px 那一行蒙过去（那是本仓判据反复栽过的子串坑）。 */
    const start = doc.indexOf("### 内容尺寸：住在 `@theme` 之外");
    expect(
      start,
      "docs/DESIGN.md 里找不到「内容尺寸：住在 @theme 之外的那一片」那一节 —— 词汇表的读者没了",
    ).toBeGreaterThan(-1);
    const section = doc.slice(start, doc.indexOf("## Layout", start));
    const undocumented = [...inUse.keys()]
      .sort((a, b) => Number(a) - Number(b))
      .filter((v) => !new RegExp(`(^|[^\\d.])${v.replace(".", String.raw`\.`)}px`).test(section));
    expect(
      undocumented,
      `这些字号在代码里用着、却没写进那一节（或写了但没有角色）：${undocumented
        .map((v) => `${v}px`)
        .join("、")}`,
    ).toEqual([]);
    expect(
      section.length,
      "那一节短得不像一张表 —— 读者侧空了，上面三条判据就只剩代码侧自说自话",
    ).toBeGreaterThan(1200);
  });

  it("12px / 13px 只有一个名字：调用点不许再写字面量档", () => {
    /* 这一档不是棘轮、是**归零等式**：`text-xs`(12) 与 `text-sm`(14) 是已存在的两档，
       而 `text-[ 12px ]` / `text-[ 13px ]` 字号贴着它们、行高却各走一套（字面量只出字号，
       行高吃继承的 1.5 ⇒ 18px / 19.5px；档位自带的配对值是 16px / 20px —— 所以 13px 那批
       并入 `text-sm` 的真实行盒变化是 19.5 → 20，不是 19.5 → 16（见下面那条行高判据）。「同一个字号
       两种行高」= 同一把尺上两个名字，所以两批字面量都签字归一（12px→text-xs 289 处那档、
       13px→text-sm 正文那档），再出现字面量就是重新分裂。要更松的行高请显式写 `leading-*`。
       13px 那 62 处并入时，`log-virtual.ts` 的 27/18 两个行高常量与两处用例是**同一批**改的
       —— 那对常量与 class 是同一件事的两面，漏一侧就是滚动位置与内容错位。 */
    const smallLiteral = /\btext-\[1[23]px\]/g;
    /* 自己先验一次量具：这条是「等式为 0」的判据，正则写漂了会永远绿。
       样本串**拆开拼**：一整条候选名出现在被扫正文里就会生成进产物，而这两档的调用点
       早已清零 —— 不拆开就是由这条负控制替它们各留一条「源码没有、产物却有」的死规则
       （口径见 03 §3.6.2）。 */
    const smallSample = "text-" + "[12px] 与 text-" + "[13px]";
    expect(
      [...smallSample.matchAll(smallLiteral)].length,
      "字面小字号的正则漂了（这条归零判据会静默全绿）",
    ).toBe(2);
    smallLiteral.lastIndex = 0;
    const offenders = scanProduct(smallLiteral);
    expect(
      offenders,
      "这些调用点又写了字面 12px / 13px —— 用 text-xs / text-sm（行高要不同就再加 leading-*）：\n" +
        `${[...new Set(offenders.map((o) => o.file))].map((f) => `  ${f}`).join("\n")}`,
    ).toEqual([]);
    /* 反向：两档真的都还是 Tailwind 默认的 12 / 14px（否则上面那条会因为「这档没了」
       而空绿，而下一轮的人会搞错每档到底多大）。 */
    const css = readFileSync(GLOBALS_PATH, "utf8");
    expect(
      ["--text-xs:", "--text-sm:"].filter((key) => css.includes(key)),
      "globals.css 覆盖了这两档之一？本判据与 §Typography 都假定它们用 Tailwind 默认字号",
    ).toEqual([]);
  });

  it("10.5px 不是一个档：调用点不许再写它（已并入 text-2xs）", () => {
    /* 也是**归零等式**，与上面那条同形。规范 03 §3.10 曾把「h2 / h3 保留 10.5–14px 的
       几档微排版」登记成例外，量下来对不上：52 处里只有 1 处落在 `h3` 上，主体是
       `<p>` / `<span>` / `<div>` 的元信息行 —— 那正是 `text-2xs`(11px) 登记的角色
       （副说明下的元信息、密集列表行）。所以它不是「第五个档」，而是「比 2xs 小半像素」
       的漂移值：t-shirt 刻度在 3xs(10) 与 2xs(11) 之间给不出名字，硬造一颗既过不了
       档名形状判据、又给「改一档全站跟手」多一个没人维护的落点。
       方向选**并大**不选并小：ISSUE #1751 量出来的结论是「档写低了」而不是「字太大」，
       而这一批全是说明性文字。+0.5px 逐处按结构判过 —— 52 处没有一处落在 `h-*` / `size-*`
       固定高度里（6 处自带 `h-auto`、2 处是 `max-h-32 overflow-y-auto` 可滚），
       宽度受限的 10 处本来就带 `min-w-0 truncate` / `max-w-*`：收不下是截断，不是溢出。 */
    const driftLiteral = /\btext-\[10\.5px\]/g;
    expect(
      [...("text-" + "[10.5px] 与 text-" + "[10.5px]").matchAll(driftLiteral)].length,
      "10.5px 的正则漂了（这条归零判据会静默全绿）",
    ).toBe(2);
    const offenders = scanProduct(driftLiteral);
    expect(
      offenders,
      "这些调用点又写了 10.5px —— 那是「比 2xs 小半像素」的漂移值，不是档；" +
        "要改密度请先在 @theme 动 --text-2xs（\n" +
        `${[...new Set(offenders.map((o) => o.file))].map((f) => `  ${f}`).join("\n")}`,
    ).toEqual([]);
    /* 反向：2xs 必须还是 11px —— 否则上面那条「并进来」的落点就变了，
       而这批调用点的像素变化量全靠这颗档的值来定（读法与判据共用同一份 helper）。 */
    const tiers = parseTextTiers(readFileSync(GLOBALS_PATH, "utf8"), TSHIRT_NAME);
    expect(tiers.byPx.get(11), "--text-2xs 不再是 11px？本判据的归一方向要重判").toBe("2xs");
  });

  it("档位的配对行高由这张表给：文档与推理都不许凭印象写数字", () => {
    /* §11.8 撤的是**页面级像素基线**；组件那一侧仍然有人管的两件里，这一件就是
     * 「具体的 token / 尺寸值对不对」（`getComputedStyle` 类断言）。行高恰好是
     * 第 3、4 刀全部推理的支点（「字面量吃继承的 1.5，档位自带配对值」），
     * 而它此前没有任何判据守着 —— 于是文档里一个错的配对值活了很久，
     * 还被写进两次提交的因果句：`text-sm` 的配对是 **20px**（依赖里
     * `--text-sm--line-height: calc(1.25 / 0.875)` × 14px），从前到处写的是 16px
     * （那是 `text-xs` 的）。真 Chromium 读数（Storybook 沙箱，加载的就是这份编译
     * 产物）：xs 12/16、sm 14/20、lg 18/28、2xs 11/16.5、3xs 10/15 —— 后两档的
     * 16.5 / 15 是**继承来的 1.5 倍**，不是配对。 */
    const tiers = parseTextTiers(readFileSync(GLOBALS_PATH, "utf8"), TSHIRT_NAME);
    for (const [name, px] of /* SAFETY: 类型断言已复核 */ [
      ["xs", 16],
      ["sm", 20],
      ["lg", 28],
    ] as const) {
      expect(
        renderedLineHeightPx(tiers, name),
        `--text-${name}--line-height 的渲染值变了？凡按行高推理的地方（第 3、4 刀的像素账）要重判`,
      ).toBe(px);
    }
    /* 两颗微标签刻意**不配对**（globals.css 注释自己写着「也不给 --text-*-line-height
     * 配对」）—— 这正是「10.5px 并进来只动字号、不动行高」的前提。哪天有人给它们
     * 配了行高，那 52 处的账要重算。 */
    for (const name of /* SAFETY: 类型断言已复核 */ ["2xs", "3xs"] as const) {
      expect(
        renderedLineHeightPx(tiers, name),
        `--text-${name} 被加了配对行高 —— 并入它的那批调用点行盒会变，像素账要重算`,
      ).toBeNull();
    }
    /* 文档侧钉住那个错值：只量代码、放着文档里的错数不管，等于让下一个人
     * 拿它当前提继续推。 */
    expect(
      /text-sm`?\s*出\s*16px/.test(doc),
      "DESIGN.md 又写「text-sm 出 16px」—— 真机读数是 20px（16px 是 text-xs 的）",
    ).toBe(false);
    expect(
      doc.includes("`text-sm` 出 20px"),
      "DESIGN.md 里 text-sm 的配对行高要按真机读数写成 20px",
    ).toBe(true);
  });

  it("标题那三颗 token 不是工具类：产品代码里不许出现同名 class", () => {
    /* 定义侧由 `tests/theme-token-single-source.test.ts` 的 T6 钉（不得住在 `@theme`）；
     * 这一条钉调用侧。从前「别在 JSX 里用 text-section / text-page」只写在注释里，
     * 而 P83 还把 `text-page` 列为合规出口之二 —— 等于判据自己给那个坑开了扇门：
     * `cn()` 把不认识的 `text-<名字>` 归进颜色组，挂了它的元素会**静默丢掉同行状态色**。
     * token 移到 `:root` 之后 Tailwind 不再为它们生成 utility（编译对账：产物里那三条
     * 从 3 条变 0 条），所以这条归零判据现在只是防「有人把 token 搬回 @theme 之后
     * 又照着旧写法调用点挂类名」。 */
    const titleClass = /\btext-(?:section|page|stage)\b/g;
    expect(
      [...("text-" + "page 与 text-" + "section").matchAll(titleClass)].length,
      "标题类名的正则漂了（这条归零判据会静默全绿）",
    ).toBe(2);
    const offenders = scanProduct(titleClass);
    expect(
      offenders,
      "这些调用点挂了标题档的同名 class —— 屏级标题走 `.u-title-page`、段级走 " +
        "`.u-title-stage`、卡片标题走 `.u-title`（它们不是 utility，是 components 层的类）：\n" +
        `${[...new Set(offenders.map((o) => o.file))].map((f) => `  ${f}`).join("\n")}`,
    ).toEqual([]);
  });

  it("浮层上限只许走那两档常量；行内图标的 align-[ -Npx ] 只许留在文本流那一处", () => {
    /* 两条都是**归零等式 + 具名出处白名单**（形状与光晕那条同：按 owner 放行）。
       浮层侧：85vh 是量出来的事实档（6 处：居中模态、图片看全、弹层面板），
       `78vh` / `90vh` 各 1 处是同一角色上的漂移值 —— 差那 5–7 个百分点没有任何一处
       文档说过为什么；`70vh`（3 处）是**另一个角色**：页面里自滚动的卡片区，上限要留
       出周围内容的呼吸。两档收进 `ui/overlay-max-height.ts`，调用点一律 import。
       为什么不做成 `@theme` 的 `--max-height-*`：实测 `cn("max-h-[85vh]", "max-h-overlay")`
       **两条都留** —— tailwind-merge 认不出自定义名字属于哪一族，于是「谁覆写谁」变成
       看 Tailwind 的输出顺序，正是 `dialog-width.ts` 文件头记着的那类静默失效；存 class
       串则同族冲突照常生效（实测两条 arbitrary 只留后一条）。
       图标侧：11 处 `inline align-[ -Npx ]` 里有 10 处坐在 `Button` / `flex` 容器里，而
       `vertical-align` 对 flex item 不起作用 —— 真 Chromium 实测：带与不带，图标的行内
       偏移都是 4.5px；同一份声明放进 inline 文本流才有效（12px 图标 5px→6px）。
       那 10 处是抄来的零效果声明，删；只剩文本流那一枚，理由写在那一处的注释里。 */
    /* 两条正则都必须带**捕获组 1**（数值本身）：`scanProduct` 只收 `m[1]` 有值的命中，
     * 没有捕获组它会一条都不记 —— 于是白名单与调用点一起「扫不到」，判据对着空集绿着。
     * 上面那两条「owner 在册必须扫得到」的断言就是抓这个的。 */
    const vhCap = /\bmax-h-\[(\d+(?:\.\d+)?)vh\]/g;
    const iconAlign = /\balign-\[-(\d+(?:\.\d+)?)px\]/g;
    /* 量具自验：等式为 0 的判据若正则写漂会永远绿。样本串**拆开拼** —— 写全一枚候选名，
       产物里就多一条没人用的规则（`tests/**` 也在源扫描面内，口径见契约 §Colors）。 */
    expect(
      [...("max-h-" + "[85vh] 与 max-h-" + "[70vh]").matchAll(vhCap)].length,
      "浮层上限的正则漂了（这条归零判据会静默全绿）",
    ).toBe(2);
    expect(
      [...("align-" + "[-2px] 与 align-" + "[-1px]").matchAll(iconAlign)].length,
      "行内图标对齐的正则漂了（这条归零判据会静默全绿）",
    ).toBe(2);

    const VH_OWNERS = new Set([
      /* 两档常量的定义处，以及一处**逐处判定过**的例外：贴边 JSON 面板的 60vh 只有它一个
       * 消费者，为它立一档就是「为以后可能用得上」留在库里（同 `--text-hero` 退役的理由）。
       * 另有 `ConsoleView` 左栏的 `max-h-[45%]` 不进这条 —— 百分比相对父容器而非视口，
       * 量的不是同一件事，正则也刻意不收它。 */
      "src/components/ui/overlay-max-height.ts",
      "src/components/studio/WorkflowNodeJsonPopover.tsx",
    ]);
    const vhHits = scanProduct(vhCap);
    /* 白名单不许是「对着空集立的法」：两处 owner 必须真被扫到 —— 否则这条判据是在看不见
     * 代码的状态下绿着，而下一轮有人把常量搬走，白名单就只剩豁免权、没有实物。 */
    for (const owner of VH_OWNERS) {
      expect(
        vhHits.some((h) => h.file === owner),
        `${owner} 在册却扫不到任何浮层上限 —— 白名单该跟着删`,
      ).toBe(true);
    }
    const vhOffenders = vhHits.filter((h) => !VH_OWNERS.has(h.file));
    expect(
      vhOffenders,
      "这些调用点又写了浮层上限的字面量 —— 用 ui/overlay-max-height 的 " +
        "OVERLAY_MAX_HEIGHT / EMBEDDED_SCROLL_MAX_HEIGHT：\n" +
        `${vhOffenders.map((o) => `  ${o.file}  max-h-[${o.value}vh]`).join("\n")}`,
    ).toEqual([]);

    const ALIGN_OWNERS = new Set(["src/components/studio/project-canvas/EmptyCanvasHint.tsx"]);
    const alignHits = scanProduct(iconAlign);
    expect(
      alignHits.filter((h) => h.file === "src/components/studio/project-canvas/EmptyCanvasHint.tsx")
        .length,
      "唯一保留的那一枚文本流图标对齐扫不到 —— 这条判据在对空集立法",
    ).toBeGreaterThan(0);
    const alignOffenders = alignHits.filter((h) => !ALIGN_OWNERS.has(h.file));
    expect(
      alignOffenders,
      "这些调用点又抄了一枚 `align-[ -Npx ]` —— 先确认父级是不是 flex：是的话它零效果；" +
        "真要基线微调就写进 EmptyCanvasHint 那一处的形态并补理由：\n" +
        `${alignOffenders.map((o) => `  ${o.file}  align-[-${o.value}px]`).join("\n")}`,
    ).toEqual([]);
  });

  it("屏级标题之下那行副说明（`.u-title-page` 后 4 行内第一个 `<p>`）不许低于 text-sm", () => {
    /* **归零等式**（ISSUE #1751）：P86 要 `text-sm` 才起跳，所以「把档写低」反而
       绕过了它 —— 两屏此前正是 `h3` + `.u-title` + `p.text-xs`。这条补的就是
       那一格：标题档在后 4 行内有第一个 `<p>`、而那枚 `<p>` 写着 `text-xs` /
       `text-2xs` / `text-3xs` 就算违规，**不看间距档**（`mt-1` / `mt-2` 都算）。

       三向自证在下面（正例必抓 / `text-sm` 不抓 / `titleSuffix` 那枚 `<span>`
       不抓）—— 等式为 0 的判据若正则写漂会永远绿，量具必须先自证能抓。 */
    const offenders = scanTitleSubtitleBelowBody();
    expect(
      offenders,
      `这些屏的副说明被写成了小字 —— 屏级副说明走 \`text-sm\`(14px)，` +
        `转 \`ui/page-header\` 的 \`<PageHeader description=…>\` 也归这一档：\n${offenders
          .map((o) => `  ${o.file}:${o.line}`)
          .join("\n")}`,
    ).toEqual([]);

    /* 自己先验一次量具：真实代码面上过一遍，确认扫描器不是「因为解不出东西而全绿」。
       屏级标题的现存量实测十几处（`page-header` 实现 + 各工具条页头），若解出 0 就说明
       正则漂了。 */
    let titleHits = 0;
    for (const abs of collectProductFiles(SRC_DIR)) {
      if (/\bu-title-page\b/.test(stripComments(readFileSync(abs, "utf8")))) {
        titleHits++;
      }
    }
    expect(
      titleHits,
      "在真实代码面上一个 `.u-title-page` 都没解出来（扫描器漂了，这条会静默全绿）",
    ).toBeGreaterThan(3);
  });

  it("负控制：屏级副说明档这条判据真的能被抓（正例 / text-sm / titleSuffix 三向）", () => {
    /* ① 正例必抓：收口前的真实形状（`h3` 档的标题 + `text-xs` 副说明的等价物，
       这里换成页面级标题档喂进去）—— 判据的核心是「标题档 + 后面那枚小字 `<p>`」。 */
    const positive = [
      '<h1 className="font-title u-title-page min-w-0 truncate">模式契约</h1>',
      '<p className="text-muted-foreground mt-1 text-xs">每种模式的统一输入 / 输出。</p>',
    ].join("\n");
    const scanText = firstSubtitleViolation;
    expect(scanText(positive), "副说明写成 `text-xs` 没被抓住（这条判据空转）").toEqual([1]);
    for (const tier of ["text-2xs", "text-3xs"]) {
      expect(
        scanText(positive.replace("text-xs", tier)),
        `副说明写成 \`${tier}\` 没被抓住`,
      ).toEqual([1]);
    }

    /* ② 正档不抓：`text-sm` 是这档副说明该在的地方（`ui/page-header` 的实现、
       `ProjectHomePage` / `SettingsShell` 的真实现都是它）。 */
    expect(
      scanText(
        [
          '<h1 className="font-title u-title-page min-w-0 truncate">设置</h1>',
          '<p className="text-ink-muted min-w-0 flex-1 text-sm">全部设置在一页里。</p>',
        ].join("\n"),
      ),
      "`text-sm` 的副说明被误抓（判据越界了）",
    ).toEqual([]);

    /* ③ `titleSuffix` 那枚 `<span>` 不抓：`ui/page-header` 的标题右边跟着一枚
       `text-ink-fainter text-xs` 的补充件（项目名 / 视图名那类），它是**标题行的
       成员**、不是副说明 —— 判据只认 `<p>`，这枚 `<span>` 恰好挡住「顺手把标题
       行里第一个小字元素当副说明」这个误判。 */
    expect(
      scanText(
        [
          '<h1 className="font-title u-title-page min-w-0 truncate">成片</h1>',
          '<span className="text-ink-fainter shrink-0 text-xs">{titleSuffix}</span>',
        ].join("\n"),
      ),
      "标题行里那枚 `<span>` 补充件被当成副说明误抓（判据只该认 `<p>`）",
    ).toEqual([]);

    /* ④ 第一个 `<p>` 之后的段落不算：屏头之后第三、四行可能是正文段落（自有其档），
       「只认 4 行内第一个 `<p>`」正是为了不把它们叫响。 */
    expect(
      scanText(
        [
          '<h1 className="font-title u-title-page">历史</h1>',
          '<p className="text-ink-muted mt-1 text-sm">运行记录。</p>',
          '<p className="text-muted-foreground text-2xs">共 12 条</p>',
        ].join("\n"),
      ),
      "第一个 `<p>` 之后的段落被误抓（判据该收在第一个 `<p>` 上）",
    ).toEqual([]);
  });

  it("@theme 的 --text-* 档名必须是 t-shirt 尺寸（否则 cn() 把它当颜色吃掉）", () => {
    /* 实测：cn("text-ink-muted", "text-micro") 只剩 text-micro —— 不认识的
       `text-<名字>` 被归进颜色组，同行的语义文字色被静默合并掉（这条是钩子
       红了 4 条 StatusBadge 用例才暴露的）。t-shirt 形状才落在 font-size 组。
       豁免那三颗是历史形态：它们只经 `.u-title-*` 在 CSS 里用，从没进过 JSX。
       （从前还有第四颗 `hero` —— 首页欢迎区撤掉时它连同 `--text-hero` 一起退役，
       豁免名单跟着撤：留一个不存在的名字，等于给「以后又加回这一档」预先放行。） */
    const EXEMPT = new Set(["section", "page", "stage"]);
    const names = [
      ...readFileSync(GLOBALS_PATH, "utf8").matchAll(/^\s*--text-([a-z0-9]+)\s*:/gm),
    ].flatMap((m) => (m[1] ? [m[1]] : []));
    expect(names.length, "一颗 --text-* 都没解出来（正则漂了，这条会静默全绿）").toBeGreaterThan(4);
    const bad = names.filter((n) => !TSHIRT_NAME.test(n) && !EXEMPT.has(n));
    expect(
      bad,
      `这些档名会让 cn() 把字号当颜色合并掉，改成 t-shirt 形状：${bad.join(", ")}`,
    ).toEqual([]);
  });

  /* 「只许有一个出处」判据：抽成基元的那些形状，其类名标记只许出现在实现文件里。
     各族共用一次目录遍历（923 个文件 × 每族一遍太贵），新增一族只加一行。
     每族的 `sample` 是**一份手抄**：负控制拿它证明这组标记真的能抓到来抄的人 ——
     否则标记写漂了就永远全绿，那是比红更糟的失效形态。
     `scope: "line"` 的族把命中收窄到**同一枚 class 字符串**上（理由见下面那一族的注释）。 */
  const FAMILIES: Array<{
    marks: Array<RegExp>;
    name: string;
    owner: string;
    sample: string;
    scope?: "file" | "line";
    use: string;
  }> = [
    {
      name: "序号圆",
      owner: "src/components/workshop/IndexDot.tsx",
      use: "~/components/workshop/IndexDot",
      marks: [
        /bg-primary-soft/,
        /place-items-center/,
        /rounded-full/,
        /text-xs font-semibold/,
        /\bsize-[67]\b/,
      ],
      sample:
        'className="bg-primary-soft text-primary grid size-6 place-items-center rounded-full text-xs font-semibold"',
    },
    {
      name: "类型 chip",
      owner: "src/components/studio/TypeChip.tsx",
      use: "~/components/studio/TypeChip",
      marks: TYPE_CHIP_MARKS,
      sample:
        'className="bg-border-strong text-ink-muted inline-flex shrink-0 items-center rounded-[3px] px-1.5 py-0.5 font-semibold"',
    },
    {
      name: "节点右侧胶囊",
      owner: "src/components/studio/workflow-form/WorkflowNodeParts.tsx",
      use: "WorkflowNodeParts 的 WorkflowNodePill",
      marks: NODE_PILL_MARKS,
      sample:
        'className="bg-node-accent flex h-5 shrink-0 items-center gap-1.25 rounded-[11px] px-2"',
    },
    {
      name: "区头（强调圆点 + 大写标签 + 计数胶囊 + 虚线）",
      owner: "src/components/studio/workflow-form/DynamicWorkflowForm/SectionHeader.tsx",
      use: "~/components/studio/workflow-form/DynamicWorkflowForm/SectionHeader",
      marks: SECTION_HEADER_MARKS,
      sample:
        '<div className="border-border-strong mt-1 flex items-center gap-2 border-t pt-2.5">' +
        '<span className="size-2 shrink-0 rounded-full" style={{ background: ACCENT }} />' +
        '<span className="text-ink-muted text-3xs font-semibold tracking-wider uppercase">' +
        '<span className="bg-surface-2 text-ink-soft text-3xs rounded-full px-1.5 py-px font-mono">' +
        '<Separator className="border-border-strong h-0 flex-1 border-t border-dashed bg-transparent" />',
    },
    {
      name: "面板内铺满居中的占位",
      owner: "src/components/ui/empty-state.tsx",
      use: '~/components/ui/empty-state 的 <EmptyState variant="panel">',
      marks: PANEL_MARKS,
      scope: "line",
      sample:
        'className="text-ink-fainter flex h-full flex-col items-center justify-center gap-2 text-sm"',
    },
    {
      /* 段级小标题那一行：**这一族是「消手抄对」才开的**。「模式契约」与
         「模型适配」两屏此前各抄一份同样的实现（连注释都写着「与另一屏同一形态」），
         于是同一个角色在两屏是两个形状、改一处不会跟手 —— 抽成
         `ui/section-label` 之后由这一族守「只许有一个出处」。 */
      name: "段级小标题（标题 + 同行 hint）",
      owner: "src/components/ui/section-label.tsx",
      use: "~/components/ui/section-label 的 <SectionLabel>",
      marks: SECTION_LABEL_MARKS,
      sample:
        '<div className="mb-2 flex flex-wrap items-baseline gap-x-2">' +
        '<h4 className="text-ink text-sm font-semibold">{children}</h4>' +
        '<span className="text-muted-foreground text-xs">{hint}</span>',
    },
    {
      /* 节点底部那枚生成按钮：画布功能版、画布视觉稿、库内卡片预览与「实际使用」
         面板此前各写一份（四组漂移的理由见上面那枚标记的注释）。 */
      name: "生成按钮（全宽渐变 + 跟品牌走的投影）",
      owner: "src/components/studio/workflow-form/WorkflowNodeParts.tsx",
      use: "WorkflowNodeParts 的 WorkflowNodeActionButton",
      marks: GENERATE_BUTTON_MARKS,
      scope: "line",
      sample:
        'className="from-primary to-accent nodrag nopan flex h-10.75 w-full items-center justify-center gap-2 bg-linear-to-r text-sm font-bold text-white shadow-[0_4px_12px_color-mix(in_srgb,var(--color-primary)_35%,transparent)] hover:opacity-95"',
    },
  ];

  it(`被抽走的 ${FAMILIES.length} 族形状只许有一个出处`, () => {
    const files = collectProductFiles(SRC_DIR);
    for (const fam of FAMILIES) {
      const owners: Array<string> = [];
      for (const abs of files) {
        const code = stripComments(readFileSync(abs, "utf8"));
        /* 全部标记**全命中**才算同一枚 —— 少一个都不算。类名在源码里的先后
           顺序不进判据：`IndexDot` 的 `size-*` 由三元式给、排在 `rounded-full`
           之后，顺序判据会漏掉实现自己。 */
        if (familyHits(fam, code)) {
          owners.push(path.relative(ROOT_DIR, abs).split(path.sep).join("/"));
        }
      }
      expect(owners, `${fam.name}的类名组合又出现了第二份出处 —— 用 ${fam.use}`).toEqual([
        fam.owner,
      ]);
    }
  });

  it("光晕只许走 --color-glow-*：候选名里不许出现裸色", () => {
    /* #1514 落地上线、#1523 之后补齐的那条配方：**色相走 `--color-glow-*`（四颗、
       两态），强度由调用处 `color-mix(… N%)` 决定**。按**归零**判而不是棘轮 —— 这个
       形状今天在恰好用的是 0 处，留棘轮等于允许它长回去。 */
    const offenders: Array<string> = [];
    for (const abs of collectProductFiles(SRC_DIR)) {
      const code = stripComments(readFileSync(abs, "utf8"));
      if (HALO_RAW.test(code) || SHADOW_HEX.test(code)) {
        offenders.push(path.relative(ROOT_DIR, abs).split(path.sep).join("/"));
      }
    }
    expect(
      offenders,
      `光晕又写成裸色了 —— 色相用 var(--color-glow-*)、强度走 color-mix：\n${offenders
        .map((o) => `  ${o}`)
        .join("\n")}`,
    ).toEqual([]);
    /* 四颗都必须**两态**：每颗在 `@theme`（浅色档）与 `.dark` 各声明一次。这里刻意
       只数声明次数、不抄 hex —— 抄了取值就会和 CSS 各自漂移（取值由 Colors 表那条
       判编译产物，两件事不重复）。 */
    const css = readFileSync(GLOBALS_PATH, "utf8");
    for (const name of GLOW_TOKENS) {
      const n = [...css.matchAll(new RegExp(`^[ \\t]*${name}:`, "gm"))].length;
      expect(n, `${name} 必须两态（浅色 + .dark），实测声明 ${n} 次`).toBe(2);
    }
  });

  it("负控制：上面每条判据都真的能被抓（否则它们绿得没意义）", () => {
    const tierPx = renderedRadiusValues(parseRadiusScale(readFileSync(GLOBALS_PATH, "utf8")));
    const biggest = Math.max(...tierPx);
    expect("border rounded-" + `[${biggest}px] h-5`).toMatch(RADIUS_LITERAL);
    /* 样本串**拆开拼**：一整条 `text-[ … ]` 形状的候选名出现在被扫正文里就会生成进产物，
     * 而 10.5px 这一档本轮已从调用点清零 —— 不拆开就等于由这条负控制替它保留一条
     * 「源码没有、产物却有」的死规则（口径见 03 §3.6.2）。 */
    expect("text-" + "[10.5px]").toMatch(TEXT_LITERAL);
    /* 量具的射程按**扫到多少文件**判，不按「解出多少条违规」判：后者正是还债要往下压的
     * 那个数，拿它的某一轮量级（从前写的是 100）当下界，等于让判据在每一次成功还债时
     * 撞墙 —— 存量归上面那条棘轮管，这里只证「扫描面真的看得见代码」。文件数今天实测 955。 */
    expect(
      collectProductFiles(SRC_DIR).length,
      "扫描面只剩很少文件 —— 上面每条判据都会「因为看不见代码」而恒绿",
    ).toBeGreaterThan(500);
    expect(
      scanProduct(TEXT_LITERAL).length,
      "扫描面有文件却解不出任何字面字号：正则或剥注释漂了",
    ).toBeGreaterThan(0);
    expect(TSHIRT_NAME.test("micro"), "非法档名没被识破（形状判据空转）").toBe(false);
    expect(TSHIRT_NAME.test("3xs"), "合法 t-shirt 名被误判").toBe(true);
    for (const fam of FAMILIES) {
      expect(
        familyHits(fam, fam.sample),
        `${fam.name}的手抄样本没被自己的标记抓出（这条判据会静默全绿）`,
      ).toBe(true);
    }
    /* 光晕那条：喂回旧写法必须被抓，正确的 token 形态与**投影**都不许被抓。
       样本一律拆开拼（`arbitrary()`）—— Tailwind 的默认源扫描连测试文件与 `.md`
       一起读，一整条 `prop-[值]` 候选名出现在源文本里就**真的被生成进产物**，
       于是造出一个「源码没有、产物却有」的死类（契约 §Colors 记了这条实测）。 */
    const arbitrary = (prop: string, value: string) => `${prop}-[${value}]`;
    expect(
      arbitrary("shadow", "0_0_6px_rgba(52,211,153,0.8)"),
      "回到裸值的光晕没被抓住（这条判据空转）",
    ).toMatch(HALO_RAW);
    expect(arbitrary("shadow", "0_0_6px_#34d399"), "光晕写成 hex 没被抓住").toMatch(SHADOW_HEX);
    expect(
      arbitrary("shadow", "0_0_6px_var(--color-glow-success)"),
      "正确的 token 形态被误判成裸色",
    ).not.toMatch(HALO_RAW);
    /* 范围钉两条：① 投影一定有偏移或扩散，`0_0_` 判据不能顺手把它们收了
       （仓里现有 6 处 `shadow-[ 0_18px_40px_rgba(0,0,0,…) ]` 一类）；
       ② 同一档浅彩在别处是合法的角色色（节点/项目类别色写 `#34D399`），
       上一版的判据就是这么误报了三个无关文件。 */
    expect(
      arbitrary("shadow", "0_18px_40px_rgba(0,0,0,0.55)"),
      "投影被光晕判据误抓（判据越界了）",
    ).not.toMatch(HALO_RAW);
    expect(arbitrary("bg", "#34D399"), "类别色被光晕判据误抓（判据越界了）").not.toMatch(
      SHADOW_HEX,
    );
    /* 反向：异类不许被同族标记抓到。`ParamOwnerTag` 那枚带描边的类型标签
       （`py-px` + `font-medium`）与胶囊那枚 11px 的图标方块（`grid size-9`、
       没有 h-5 / gap-1.25）各是其主自己的形状 —— 抓到了说明标记写得太松，
       判据就成了「拦下了一切」。 */
    const lookalikes: Array<[string, (typeof FAMILIES)[number]["name"]]> = [
      [
        'className="border-primary/30 bg-primary/10 text-primary-strong shrink-0 rounded-[3px] border px-1.5 py-px text-[9.5px] font-medium"',
        "类型 chip",
      ],
      [
        'className="grid size-9 place-items-center rounded-[11px] text-[15px] font-bold"',
        "节点右侧胶囊",
      ],
      /* 生成按钮的反向样本：一枚「同样是全宽渐变 CTA」但**不是这一枚**的形状 ——
         高度走 `h-11`（不跟 `--spacing` 的 43px 那档）、投影没跟品牌走。它被抓到
         就说明标记写得太松（那会把别的渐变按钮一律要求收进唯一出处）。 */
      [
        'className="from-primary to-accent flex h-11 w-full items-center justify-center gap-2 bg-linear-to-r text-sm font-bold text-white hover:opacity-90"',
        "生成按钮（全宽渐变 + 跟品牌走的投影）",
      ],
      [
        '<div className="border-border-strong flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">' +
          '<span className="size-2 shrink-0 rounded-full bg-sky-400" />' +
          '<span className="text-ink-bright truncate text-xs font-semibold">' +
          '<span className="bg-subtle text-ink-soft text-3xs rounded-full px-1.5 py-px font-mono">',
        "区头（强调圆点 + 大写标签 + 计数胶囊 + 虚线）",
      ],
      /* 面板占位那一族的三个「看着像」：`ProjectGate` 那处是整页容器（自带
         `bg-canvas` / `p-6`，里面坐的是一张卡）、`ShellTabs` 那处是**页签诊断卡**
         （标题 + 原因 + 地址行 + 按钮，不是「这里是空的」），消息中心那处是同族
         但自带更松的间距（`gap-3`，迁移后走 `className` 覆写）——
         三者都不该被这套标记抓到，否则判据就成了「拦下了一切」。 */
      [
        'className="bg-canvas text-ink flex h-full w-full items-center justify-center p-6"',
        "面板内铺满居中的占位",
      ],
      [
        'className="flex h-full flex-col items-center justify-center gap-4 p-8"',
        "面板内铺满居中的占位",
      ],
      [
        'className="text-ink-fainter flex h-full flex-col items-center justify-center gap-3"',
        "面板内铺满居中的占位",
      ],
      /* 段级小标题那一族的两个反向样本 —— 都是「同屏相邻、看着像」的东西：
         ① **屏级页头**（`ui/page-header`）走的是另一档（`.u-title-page` 24px +
         `mt-1 text-sm` 副说明），不是段级那一行，不许被这组标记抓到；
         ② **段头胶囊**（`DynamicWorkflowForm/SectionHeader`）是「圆点 + 大写标签
         + 计数胶囊 + 虚线」那一族，连字号档都不同（`text-3xs` 大写标签）。
         两者被抓到就说明这组标记太松、判据成了「拦下了一切」。 */
      [
        '<h1 className="font-title u-title-page min-w-0 truncate">{title}</h1>' +
          '<p className="text-ink-muted mt-1 text-sm">{description}</p>',
        "段级小标题（标题 + 同行 hint）",
      ],
      [
        '<div className="border-border-strong mt-1 flex items-center gap-2 border-t pt-2.5">' +
          '<span className="size-2 shrink-0 rounded-full" />' +
          '<span className="text-ink-muted text-3xs font-semibold tracking-wider uppercase">',
        "段级小标题（标题 + 同行 hint）",
      ],
    ];
    for (const [src, famName] of lookalikes) {
      const fam = FAMILIES.find((f) => f.name === famName)!;
      expect(
        familyHits(fam, src),
        `异类「${src.slice(0, 46)}…」被${famName}的标记误抓（标记集合太松）`,
      ).toBe(false);
    }
  });
});
