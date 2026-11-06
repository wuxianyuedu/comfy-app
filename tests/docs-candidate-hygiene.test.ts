/** 文档正文与用例里写全一枚「产品面零消费者」的 arbitrary 候选名 ⇒ 产物里多一条死规则：Tailwind
 * 源扫描把 `docs/**`、`changelog.d/**`、`tests/**` 一起读，于是规范里照抄的 `prop-[值]` 会真的生成一条
 * CSS 规则，而按产物数硬编码/调用点的自查会读出不存在的消费者。判据不读现成产物也不读文本，而是读引擎
 * 在指定扫描面上的产出（`compiledCssPinnedTo`）：正文与用例面 ⇄ src 面的差集即「只有正文供给」的候选
 * （`changelog.d` 是账本不判，硬规则 14 / §13.10.5；登记表在测试里且受反向检查：没被引擎解出即红）。 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compiledCssPinnedTo, ruleSelectors } from "./helpers/theme-tokens";

const ROOT = path.resolve(import.meta.dirname, "..");
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "coverage", "__snapshots__"]);

/** 运行期拼候选名：源码里绝不留完整形状，否则这份测试自己就成了死规则的新出处。 */
function cand(prop: string, value: string): string {
  return `${prop}-[${value}]`;
}

/**
 * 逐字保留的示例（候选名 → 为什么不能改成带空格的形状）。
 * 全部来自代码块或检索式：改了示例就教错，改了正则就把正则写坏。
 */
const REGISTERED: Record<string, string> = {
  [cand("w", "var(--panel-right-width)")]:
    "03 §3.1 的 ❌ v3 写法示例 —— 演示的就是这个形状，加空格就不是那一枚了",
  [cand("-top", "20%")]: "03 §3.1 的 ❌ v3 写法示例（负值 + 百分比）",
  [cand("z", "99")]: "03 §3.1 的 ❌ 多余括号示例",
  /* 原先两条登记（DEV-QUERIES 的 codemod 示例、夹具里钉死的类名）删掉是**实测**：正文紧贴汉字写时
   * 引擎不抽候选，改用运行期拼后也不再供给 ⇒ 成了「有豁免权、没有实物」。别据此依赖「紧贴汉字」——
   * 挪一个分隔符就翻，稳的是方括号内侧留空格（口径见 docs/DESIGN.md 的扫描边界）。 */
  [cand("translate-y", "-1px")]: "DEV-QUERIES 列出的「不进文本 codemod」清单，逐字才有检索价值",
  [cand("aspect", "4/3")]: "同上",
  [cand("w", "360px")]: "02 §性能的示例代码（面板宽度就是这一枚 arbitrary）",
  [cand("min-h", "300px")]: "10 §错误处理的示例代码（虚线占位框）",
  [cand("bg", "#fff")]:
    "13 §13.6.4 的对抗性探针输入表 —— 那一格记的就是「按值形状收窄为什么是假的」",
  [cand("delay", "200ms")]: "同上",
  [cand("bg", "#1a1a24")]:
    "03 §3.6 那段按关注点分行的 className 示例 —— 演示的是「颜色那一段单独一行」，" +
    "方括号内侧加空格就不再是同一枚了",
  [cand("duration", "0-9")]:
    "DESIGN.md 里那是一条 grep 检索式（`[0-9]` 是字符组），加空格会把正则写坏",
};

function walk(rel: string, out: Array<string> = []): Array<string> {
  const abs = path.join(ROOT, rel);
  if (!existsSync(abs)) {
    return out;
  }
  for (const e of readdirSync(abs, { withFileTypes: true })) {
    const child = path.join(abs, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) {
        walk(path.relative(ROOT, child), out);
      }
    } else {
      out.push(path.relative(ROOT, child).split(path.sep).join("/"));
    }
  }
  return out;
}

const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/**
 * CSS 的转义还原：产物里 `.text-\\[10\\.5px\\]` 这类写法，去掉 `\\` 才是类名原文。
 * 选择器开头那个点也一起去掉（转义还原之后剩下的就是类名本身，只是这里刻意把内侧写成
 * 带空格的形状 —— 本文件也在扫描面里，写全一枚就多一条死规则，这条判据对自己同样生效）。
 */
function unescapeSelector(part: string): string {
  return part
    .trim()
    .replaceAll(/\\(?<escaped>.)/g, "$<escaped>")
    .replace(/^\./, "");
}

/**
 * 产物 → 「这一遍扫描面里被引擎解出来的 arbitrary 候选名」。变体前缀不用特殊处理（取值正则抓属性段
 * 那一片）。两处已知口径边界都不改结论方向：值里嵌 `]` 会被截断（本仓无此值）；带透明度修饰的
 * 归一成不带修饰的那一枚 —— 供给与消费两侧同样归一，一致才不会误判。
 */
function arbitraryCandidates(css: string): Set<string> {
  const out = new Set<string>();
  for (const selector of ruleSelectors(css)) {
    if (!selector.includes("[")) {
      continue;
    }
    /* 逗号只在**未被转义**处分组：任意值里的逗号在产物里是「反斜杠加逗号」，
     * 在那里切开会把一枚候选名（比如网格列数那种重复函数）截成两半、凭空造出误报。 */
    for (const part of selector.split(/(?<!\\),/)) {
      const plain = unescapeSelector(part);
      for (const c of plain.matchAll(/[-\w]+-\[[^\]]*\]/g)) {
        out.add(c[0]);
      }
    }
  }
  return out;
}

/**
 * 「占位形状」判据用的取值检查：方括号里是**说明取值长什么样**的占位符。src **注释**里写一枚占位候选
 * 会同时出现在供给与消费两侧，差集判据看不见它。只认三种不可能出现在真取值里的形状（省略号/左尖
 * 括号；单独字母 N；含汉字），而不是「值里没数字就算占位」—— 后者实测误报三十多枚（属性名过渡、
 * 系统颜色关键字、aria/data 变体）。`>` **不算**信号：`has-[>svg]` 一族是选择器，第二版收 `>` 误报十七枚。 */
function placeholderCandidates(candidates: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const c of candidates) {
    const value = c.slice(c.indexOf("[") + 1, -1);
    if (/[…<]/.test(value) || /^-?N(?:px|rem|em|ex|ch|vh|vw|ms|s|%)?$/i.test(value)) {
      out.add(c);
      continue;
    }
    if (/[\u4e00-\u9fff]/.test(value)) {
      out.add(c);
    }
  }
  return out;
}

/** 文件归属用**带边界**的匹配，别拿子串：短属性名是那枚长候选名的子串，会被算成它的出处。 */
function spelledIn(text: string, candidate: string): boolean {
  const escaped = candidate.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  return new RegExp(`(^|[^\\w-])${escaped}(?![\\w-])`).test(text);
}

let proseCandidates = new Set<string>();
let srcCandidates = new Set<string>();
/** 正文与用例的文本，一次读入：归属与反向检查都要用。 */
let proseFiles: Array<[string, string]> = [];

beforeAll(async () => {
  const [proseCss, srcCss] = await Promise.all([
    compiledCssPinnedTo(["../../docs", "../../tests"]),
    compiledCssPinnedTo(["../../src"]),
  ]);
  proseCandidates = arbitraryCandidates(proseCss);
  srcCandidates = arbitraryCandidates(srcCss);

  /* SAFETY: 类型断言已复核 */
  proseFiles = [
    ...walk("docs").filter((f) => f.endsWith(".md")),
    ...walk("tests").filter((f) => /\.(?:ts|tsx)$/.test(f)),
  ].map((f) => [f, read(f)] as [string, string]);

  /* 空跑的形状先挡掉：扫描面钉错（比如把 ../../docs 写成 docs，那会被按 CSS 所在目录
   * 解析成 src/app/docs 而扫到零个文件）时，上面两遍编译会安静地什么也没解出来，
   * 下面的判据于是全绿 —— 那是「判据在空跑」而不是「存量已清零」。 */
  expect(
    proseCandidates.size,
    "把 docs+tests 钉成扫描面之后一条 arbitrary 都没解出来 —— 判据在空跑，" +
      "先查 compiledCssPinnedTo 的相对路径基准（相对 CSS 文件所在目录 src/app）",
  ).toBeGreaterThan(10);
  expect(
    srcCandidates.size,
    "把 src 钉成扫描面之后一条 arbitrary 都没解出来 —— 消费侧是空集，" +
      "供给侧差集那条判据会把所有正文候选都当成零消费者报错",
  ).toBeGreaterThan(50);
  expect(proseFiles.length, "没读到正文与用例文件 —— 归属与反向检查在对空集立法").toBeGreaterThan(
    20,
  );
});

describe("正文与用例不许成为死规则的唯一出处", () => {
  it("只有正文在供给的 arbitrary 候选名，只能留在登记表里", () => {
    const offenders: Array<string> = [];
    for (const candidate of proseCandidates) {
      if (srcCandidates.has(candidate)) {
        continue;
      } // src 自己也在供给，不是正文造成的死规则
      if (REGISTERED[candidate] !== undefined && REGISTERED[candidate] !== "") {
        continue;
      } // 逐字示例 / 检索式，已给理由
      const where = proseFiles.filter(([, text]) => spelledIn(text, candidate)).map(([f]) => f);
      offenders.push(`${candidate}  ← ${where.join(" | ") || "(归属未命中)"}`);
    }
    expect(
      offenders,
      `这些 arbitrary 候选名只有正文/用例在供给 ⇒ 每次构建多一条没人用的规则。` +
        `改法：方括号内侧各留一个空格（读者看到的仍是同一个类名，扫描器读不出候选名）；` +
        `确实是逐字示例或检索式的，登记进本文件的 REGISTERED 并写理由：\n${offenders
          .sort()
          .map((o) => `  ${o}`)
          .join("\n")}`,
    ).toEqual([]);
  });

  it("登记表不留「有豁免权、没有实物」的条目", () => {
    const stale = Object.keys(REGISTERED).filter((candidate) => !proseCandidates.has(candidate));
    expect(
      stale,
      "这些登记条目指向的候选名并没有被引擎解出来（示例被改写、或那一枚本来就成不了形）—— " +
        "条目要一起删，否则它只剩「放行下一枚死规则」这一种作用",
    ).toEqual([]);
  });

  it("占位形状的候选名不进产物（注释里写「禁止长这样」也算供给）", () => {
    const placeholders = [...srcCandidates, ...proseCandidates];
    const hits = [...placeholderCandidates(placeholders)].sort();
    expect(
      hits,
      `这些候选名的方括号值不是任何一段 CSS 取值 —— 它是「拿 N / … / <数字> 当占位符」的` +
        `说明性写法，被扫描面读到就进产物、且永远不会有人用。改法与上一条同：` +
        `内侧留空格，或直接用文字描述那一枚的形状：\n${hits.map((h) => `  ${h}`).join("\n")}`,
    ).toEqual([]);
  });
});

/**
 * ## 量具自证：临时目录放合成正文、把扫描面钉到那个目录（`@source` 绝对路径实测可行，0.2s），三种
 * 形状各写一枚，看产物出现哪几条。上一版把「内侧留空格 → 不生成」当已知事实写进注释，而它同时是
 * 判据的推荐改法 ⇒ 必须当场问引擎，不能引用文档；临时目录不碰仓库，路径按 CSS 口径转斜杠。
 */
describe("量具本身：候选形状会不会进产物，当场问引擎", () => {
  const dir = path.join(tmpdir(), `cand-shape-probe-${process.pid}`);
  /** 钉给 Tailwind 的绝对路径（CSS 字符串里用正斜杠，Windows 反斜杠会被当转义）。 */
  let source = "";

  beforeAll(() => {
    mkdirSync(dir, { recursive: true });
    /* 三种形状之间必须用 ASCII 空白隔开：实测把候选名紧贴在全角冒号后面时，
     * 引擎的取值器根本抽不出这枚候选 —— 那会让这一格「假绿」。所以这里刻意写
     * `A … B … C …` 这种纯 ASCII 分隔的正文，把「分隔符」这个变量固定住。 */
    const body = [
      "A",
      cand("text", "9px"),
      "B",
      cand("text", " 9px "),
      "C",
      cand("text", "Npx"),
      "",
    ].join(" ");
    writeFileSync(path.join(dir, "prose.md"), body, { encoding: "utf8" });
    source = dir.split(path.sep).join("/");
    expect(
      readFileSync(path.join(dir, "prose.md"), "utf8"),
      "合成正文没写进去（编码或路径问题）—— 后面三格会在空输入上全绿",
    ).toContain("text-");
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("完整候选名进产物；内侧带空格的替代写法不进", async () => {
    const css = await compiledCssPinnedTo([source]);
    const got = arbitraryCandidates(css);
    expect(
      got.has(cand("text", "9px")),
      "引擎没为写全的那一枚生成规则 —— 那「正文写全 = 多一条死规则」这个前提就不成立，" +
        "上面三条判据全部失去依据",
    ).toBe(true);
    expect(
      [...got].some((c) => c.includes(" 9px ")),
      "带空格的替代写法被引擎解出来了 ⇒ 本文件推荐的改法（方括号内侧各留一个空格）根本不成立，" +
        "登记表与存量改写都得重来",
    ).toBe(false);
  });

  it("占位形状照样进产物 —— 所以占位判据不是凭空收紧", async () => {
    const css = await compiledCssPinnedTo([source]);
    const got = arbitraryCandidates(css);
    const ph = placeholderCandidates(got);
    expect(
      ph.has(cand("text", "Npx")),
      "值里一个数字都没有的占位候选没被认出来 ⇒ 那条占位判据在空跑",
    ).toBe(true);
    expect(
      [...ph].some((c) => c.includes("9px")),
      "带数字的字面尺寸被当成占位了 ⇒ 占位判据会误伤真取值写法",
    ).toBe(false);
  });
});
