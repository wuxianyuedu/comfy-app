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
import { stripComments } from "./helpers/strip-comments";
import { loadThemeTokens, type ThemeTokens } from "./helpers/theme-tokens";

const DOC_PATH = fileURLToPath(new URL("../docs/DESIGN.md", import.meta.url));
const ROOT_DIR = fileURLToPath(new URL("..", import.meta.url));
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
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length < 5) continue;
    // slice(1, -1) 已去掉首尾两个空格子 ⇒ 列序是 0 角色 / 1 token / 2 浅色 / 3 深色 / 4 用途
    const token = singleCodeSpan(cells[1] ?? "", COLOR_TOKEN);
    if (!token) continue;
    const light = parseHexCell(cells[2] ?? "");
    const dark = (cells[3] ?? "").includes("同值")
      ? light
      : parseHexCell(cells[3] ?? "");
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
      const actual =
        normalizeCssHex(resolve(row.token, state)) ?? "(产物里不是单一 hex)";
      if (actual !== doc)
        bad.push(`${row.token} ${state}: 文档 ${doc} / 产物 ${actual}`);
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
    expect(
      cited.length,
      "文档里一颗 token 都没引用到 —— 解析失效",
    ).toBeGreaterThan(20);
    const unknown = findUnknownTokens(
      cited,
      (name) => light.has(name) || dark.has(name),
    );
    expect(
      unknown,
      `文档引用了产物里查无此名的 token（改名或删token 时这份契约不会响）：${unknown.join(", ")}`,
    ).toEqual([]);
  });

  it("负控制：引用一个不存在的名字必须被判出来（否则上一条绿得没有意义）", () => {
    const fixture =
      "底 `--color-canvas` 与假想的 `--color-zprobe-not-a-token`。";
    expect(
      findUnknownTokens(
        collectBareTokenCitations(fixture),
        (name) => light.has(name) || dark.has(name),
      ),
    ).toEqual(["--color-zprobe-not-a-token"]);
    // 而真存在的名字不许被误报
    expect(
      findUnknownTokens(["--color-canvas"], (name) => light.has(name)),
    ).toEqual([]);
  });
});

describe("docs/DESIGN.md 的 Colors 表与两态取值", () => {
  it("表在、行解析得到（表头漂了要当场响）", () => {
    const section = sectionBetween(doc, "### 语义角色表");
    expect(
      section,
      "找不到「语义角色表」小节 —— 文档结构变了要同步这里的锚点",
    ).not.toBeNull();
    const rows = collectHexRows(section ?? "");
    expect(rows.length, "Colors 表解析到 0 行 —— 判据在空转").toBeGreaterThan(
      5,
    );
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
    expect(rows).toEqual([
      { token: "--color-ink-muted", light: "#6b6b76", dark: "#000000" },
    ]);
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
    expect(skip, "一格并列两颗 token / 值不是单一 hex 时不许产生断言").toEqual(
      [],
    );
  });
});

/* ── 调用侧：契约里的档位必须真的被用上 ──────────────────────────────
   上面两格判的是「文档说的值 = CSS 定义的值」。这一格补另一半：
   **调用点有没有真的用档位**。圆角这一刀落地后暴露出缺口 —— T4 只看
   `globals.css` 的定义，看不见 `className="rounded-[16px]"` 这种「把档位
   当前渲染值重抄一遍」的写法：它此刻像素正确，但设置页改基数时不跟手，
   等于在总闸旁边开了个旁通。字号同理（契约 §Typography 明写不要写
   字面字号，而调用点还有几百处存量）。 */

const SRC_DIR = fileURLToPath(new URL("../src", import.meta.url));
const GLOBALS_PATH = fileURLToPath(
  new URL("../src/app/globals.css", import.meta.url),
);
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  "dist",
  "coverage",
  "__snapshots__",
]);

/** 产品代码面：`.stories.` 与 `.test.` 排除在外 —— 它们不是设计系统的消费者，
 *  拿像素契约绑住演示件与用例只会逼人往 story 里塞无意义的类名。 */
function collectProductFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) collectProductFiles(p, out);
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
function scanProduct(pattern: RegExp): { file: string; value: string }[] {
  const hits: { file: string; value: string }[] = [];
  for (const abs of collectProductFiles(SRC_DIR)) {
    const code = stripComments(readFileSync(abs, "utf8"));
    const rel = path.relative(ROOT_DIR, abs).split(path.sep).join("/");
    for (const m of code.matchAll(pattern)) {
      if (m[1]) hits.push({ file: rel, value: m[1] });
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

/** 状态发光的浅彩裸值（emerald-400 / rose-400）—— 只能经 `--color-glow-*` 取。
 *  **不带 `g`**：这里只 `.test()`，而带 `g` 的正则会把 `lastIndex` 留在上一次调用上，
 *  同一份文件里第二次出现就静默漏判（判据自己变成一台会漏的工具）。
 *  ⚠️ 判据**只认 `rgba(52,211,153…)` 这一种裸形态**：同一档浅彩还合法地存在于
 *  别的位置（`canvas-types.ts` 的节点类别色、`HomePage.tsx` 的项目类别色就写着
 *  `#34D399` / `#FB7185`），第一版把 hex 一并禁掉，当场误报三份与发光无关的文件。
 *  hex 那种写法只在「被包进 shadow 候选名」时算违规（见 GLOW_HEX_IN_SHADOW）。 */
const GLOW_RAW =
  /rgba\(\s*(?:52\s*,\s*211\s*,\s*153|251\s*,\s*113\s*,\s*133)\s*[,/]/;
/** `shadow-[…#34d399…]`：发光位置直接写 hex 也算回潮。 */
const GLOW_HEX_IN_SHADOW = /shadow-\[[^\]]*(?:34d399|fb7185)/i;

describe("调用点必须走档位（§Shapes / §Typography 的实现侧）", () => {
  /** 棘轮基线：本轮清理后实测的存量，只许降不许升（要升得改用例并写理由）。
   *  21→12 是类型 chip 收进 `~/components/studio/TypeChip`（10 处调用点各写一份 →
   *  只剩实现里那一处 + `ParamOwnerTag` 那一枚异类）；12→10 是节点右侧胶囊的两处
   *  手写改走早已存在的 `WorkflowNodePill`（§12.18：有等价实现就先 import）。 */
  const RADIUS_BASELINE = 10;
  const TEXT_BASELINE = 298;

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

  it("@theme 的 --text-* 档名必须是 t-shirt 尺寸（否则 cn() 把它当颜色吃掉）", () => {
    /* 实测：cn("text-ink-muted", "text-micro") 只剩 text-micro —— 不认识的
       `text-<名字>` 被归进颜色组，同行的语义文字色被静默合并掉（这条是钩子
       红了 4 条 StatusBadge 用例才暴露的）。t-shirt 形状才落在 font-size 组。
       豁免那四颗是历史形态：它们只经 `.u-title-*` 在 CSS 里用，从没进过 JSX。 */
    const EXEMPT = new Set(["section", "page", "stage", "hero"]);
    const names = [
      ...readFileSync(GLOBALS_PATH, "utf8").matchAll(
        /^\s*--text-([a-z0-9]+)\s*:/gm,
      ),
    ].flatMap((m) => (m[1] ? [m[1]] : []));
    expect(
      names.length,
      "一颗 --text-* 都没解出来（正则漂了，这条会静默全绿）",
    ).toBeGreaterThan(4);
    const bad = names.filter((n) => !TSHIRT_NAME.test(n) && !EXEMPT.has(n));
    expect(
      bad,
      `这些档名会让 cn() 把字号当颜色合并掉，改成 t-shirt 形状：${bad.join(", ")}`,
    ).toEqual([]);
  });

  /* 「只许有一个出处」判据：抽成基元的那些形状，其类名标记只许出现在实现文件里。
     三族共用一次目录遍历（923 个文件 × 每族一遍太贵），新增一族只加一行。
     每族的 `sample` 是**一份手抄**：负控制拿它证明这组标记真的能抓到来抄的人 ——
     否则标记写漂了就永远全绿，那是比红更糟的失效形态。 */
  const FAMILIES = [
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
      owner:
        "src/components/studio/workflow-form/DynamicWorkflowForm/SectionHeader.tsx",
      use: "~/components/studio/workflow-form/DynamicWorkflowForm/SectionHeader",
      marks: SECTION_HEADER_MARKS,
      sample:
        '<div className="border-border-strong mt-1 flex items-center gap-2 border-t pt-2.5">' +
        '<span className="size-2 shrink-0 rounded-full" style={{ background: ACCENT }} />' +
        '<span className="text-ink-muted text-3xs font-semibold tracking-wider uppercase">' +
        '<span className="bg-surface-2 text-ink-soft text-3xs rounded-full px-1.5 py-px font-mono">' +
        '<Separator className="border-border-strong h-0 flex-1 border-t border-dashed bg-transparent" />',
    },
  ];

  it(`被抽走的 ${FAMILIES.length} 族形状只许有一个出处`, () => {
    const files = collectProductFiles(SRC_DIR);
    for (const fam of FAMILIES) {
      const owners: string[] = [];
      for (const abs of files) {
        const code = stripComments(readFileSync(abs, "utf8"));
        /* 全部标记**全命中**才算同一枚 —— 少一个都不算。类名在源码里的先后
           顺序不进判据：`IndexDot` 的 `size-*` 由三元式给、排在 `rounded-full`
           之后，顺序判据会漏掉实现自己。 */
        if (fam.marks.every((re) => re.test(code))) {
          owners.push(path.relative(ROOT_DIR, abs).split(path.sep).join("/"));
        }
      }
      expect(
        owners,
        `${fam.name}的类名组合又出现了第二份出处 —— 用 ${fam.use}`,
      ).toEqual([fam.owner]);
    }
  });

  it("状态发光的浅彩只有 token 一个出处，调用点不许再写回裸值", () => {
    /* #1508 那格 needs-design-decision 签完之后落地的防回潮半边：`#34d399` /
       `#fb7185` 这两档浅彩与基准色 `--color-success` / `--color-destructive`
       不是同一个颜色，此前以裸值散在三处、看起来像「忘了用 token」。现在的
       口径是色相走 `--color-glow-*`、强度由调用处 `color-mix(… N%)` 决定，
       所以**裸值回来就是红**（强度可以各站不同，色相不行）。 */
    const offenders: string[] = [];
    for (const abs of collectProductFiles(SRC_DIR)) {
      const code = stripComments(readFileSync(abs, "utf8"));
      /* `globals.css` 是 token 的**定义处**，那两颗 hex 只许在那里；
         其余文件只许经 `var(--color-glow-*)` 取值。 */
      const rel = path.relative(ROOT_DIR, abs).split(path.sep).join("/");
      if (rel === "src/app/globals.css") continue;
      if (GLOW_RAW.test(code) || GLOW_HEX_IN_SHADOW.test(code)) {
        offenders.push(rel);
      }
    }
    expect(
      offenders,
      "状态发光的浅彩又写成裸值了 —— 用 var(--color-glow-success) / " +
        `var(--color-glow-danger)，强度走 color-mix：\n${offenders
          .map((o) => `  ${o}`)
          .join("\n")}`,
    ).toEqual([]);
    /* 定义处真的在（否则上面那条会因为「谁都没有」而空绿）。 */
    const css = readFileSync(GLOBALS_PATH, "utf8");
    const declValue = (name: string) =>
      new RegExp(`^\\s*${name}:\\s*([^;]+);`, "m").exec(css)?.[1]?.trim();
    expect(
      [declValue("--color-glow-success"), declValue("--color-glow-danger")],
      "两颗发光 token 不在 globals.css 里（判据的锚没了）",
    ).toEqual(["#34d399", "#fb7185"]);
  });

  it("负控制：上面每条判据都真的能被抓（否则它们绿得没意义）", () => {
    const tierPx = renderedRadiusValues(
      parseRadiusScale(readFileSync(GLOBALS_PATH, "utf8")),
    );
    const biggest = Math.max(...tierPx);
    expect("border rounded-" + `[${biggest}px] h-5`).toMatch(RADIUS_LITERAL);
    expect("text-[10.5px]").toMatch(TEXT_LITERAL);
    expect(
      scanProduct(TEXT_LITERAL).length,
      "扫描函数在真实代码面上解不出东西",
    ).toBeGreaterThan(100);
    expect(TSHIRT_NAME.test("micro"), "非法档名没被识破（形状判据空转）").toBe(
      false,
    );
    expect(TSHIRT_NAME.test("3xs"), "合法 t-shirt 名被误判").toBe(true);
    for (const fam of FAMILIES) {
      expect(
        fam.marks.every((re) => re.test(fam.sample)),
        `${fam.name}的手抄样本没被自己的标记抓出（这条判据会静默全绿）`,
      ).toBe(true);
    }
    /* 发光裸值那条：喂回一个旧写法必须被抓，而现在的 token 形态不许被抓。
       样本一律**拆开拼**（`arbitrary()`）—— Tailwind 的默认源扫描连测试文件与 `.md`
       一起读，一整条 `prop-[值]` 候选名出现在源文本里就**真的被生成进产物**，
       于是造出一个「源码没有、产物却有」的死类（契约 §Colors 记了这条实测）。 */
    const arbitrary = (prop: string, value: string) => `${prop}-[${value}]`;
    expect(
      "0 0 6px rgba(52,211,153,0.8)",
      "回到裸值的发光没被抓住（这条判据空转）",
    ).toMatch(GLOW_RAW);
    expect(
      arbitrary("shadow", "0_0_6px_#34d399"),
      "发光位置写成 hex 没被抓住",
    ).toMatch(GLOW_HEX_IN_SHADOW);
    expect(
      GLOW_HEX_IN_SHADOW.test(
        arbitrary("shadow", "0_0_6px_var(--color-glow-success)"),
      ),
      "正确的 token 形态被误判成 hex 回潮",
    ).toBe(false);
    /* 反向钉住**范围**：这一档浅彩在别处是合法的角色色（节点/项目类别色），
       判据不许把它们一起抓走 —— 第一版就是这么误报了三个无关文件。 */
    expect(GLOW_RAW.test(arbitrary("bg", "#34d399"))).toBe(false);
    expect(
      GLOW_HEX_IN_SHADOW.test(arbitrary("bg", "#34D399")),
      "类别色被发光判据误抓（判据越界了）",
    ).toBe(false);
    expect(
      GLOW_RAW.test(
        arbitrary(
          "shadow",
          "0_0_6px_color-mix(in_srgb,var(--color-glow-success)_80%,transparent)",
        ),
      ),
      "正确的 token 形态被误判成裸值（判据太松）",
    ).toBe(false);
    /* 反向：异类不许被同族标记抓到。`ParamOwnerTag` 那枚带描边的类型标签
       （`py-px` + `font-medium`）与胶囊那枚 11px 的图标方块（`grid size-9`、
       没有 h-5 / gap-1.25）各是其主自己的形状 —— 抓到了说明标记写得太松，
       判据就成了「拦下了一切」。 */
    const lookalikes: [string, (typeof FAMILIES)[number]["name"]][] = [
      [
        'className="border-primary/30 bg-primary/10 text-primary-strong shrink-0 rounded-[3px] border px-1.5 py-px text-[9.5px] font-medium"',
        "类型 chip",
      ],
      [
        'className="grid size-9 place-items-center rounded-[11px] text-[15px] font-bold"',
        "节点右侧胶囊",
      ],
      [
        '<div className="border-border-strong flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">' +
          '<span className="size-2 shrink-0 rounded-full bg-sky-400" />' +
          '<span className="text-ink-bright truncate text-[12px] font-semibold">' +
          '<span className="bg-subtle text-ink-soft text-3xs rounded-full px-1.5 py-px font-mono">',
        "区头（强调圆点 + 大写标签 + 计数胶囊 + 虚线）",
      ],
    ];
    for (const [src, famName] of lookalikes) {
      const fam = FAMILIES.find((f) => f.name === famName)!;
      expect(
        fam.marks.every((re) => re.test(src)),
        `异类「${src.slice(0, 46)}…」被${famName}的标记误抓（标记集合太松）`,
      ).toBe(false);
    }
  });
});
