/**
 * CP936 字形归一化的契约（平台日志里「本来是符号」却显示成问号那一族）。
 *
 * ## 它守的是什么
 *
 * 平台抓 stage 输出那一跳读的是 **CP936**；CP936 只有两万多个字形，落在字表之外的
 * 字符会被 .NET 的编码器写成**一个问号**（单字节 `0x3F`），而那个问号与「原文里本来
 * 就有的问号」逐字同形。
 *
 * 被吃掉的往往不是装饰，是判决 —— vitest 的**绿色通过标记** `✓` 正在这一列
 * （红色失败标记 `×` 有字形、活得好好的），于是「这一条过了」在日志上打印成问号。
 *
 * `scripts/ci-cp936-glyphs.mjs` 是这一层的实现；本文件判它的**行为契约**。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  cp936EncodableSet,
  describeGlyphReplacements,
  GLYPH_DROPPED,
  GLYPH_KEPT,
  GLYPH_REPLACEMENTS,
  isCp936Encodable,
  normalizeCp936Glyphs,
} from "../scripts/ci-cp936-glyphs.mjs";

import { normalizeControlFlow } from "./helpers/source-shape";

const ROOT = path.resolve(import.meta.dirname, "..");
/* 读源断言的是**控制流**（谁先谁后、有没有这道守卫），不是括号形态：先过归一化，
 * oxlint `curly` 给单语句体补 `{}` 就不会把这些断言打成「形状变了」。 */
const read = (rel: string) => normalizeControlFlow(readFileSync(path.join(ROOT, rel), "utf8"), rel);

describe("字形归一化：等义替换", () => {
  it("绿色通过标记换成 CP936 里有的字形（这一格最要紧）", () => {
    /* `✓` 是 vitest 的通过标记，而 CP936 里没有它 ⇒ 平台日志里「过了」变问号。 */
    expect(normalizeCp936Glyphs("✓").text).toBe("√");
    expect(normalizeCp936Glyphs("✗").text).toBe("×");
    expect(normalizeCp936Glyphs("✔").text).toBe("√");
    expect(normalizeCp936Glyphs("✘").text).toBe("×");
  });

  it("箭头换成 CP936 里有的那一个（有一个有字形、另一个没有）", () => {
    /* 测试名**刻意不写那个没字形的箭头** —— 它会被归一化换成有字形的那一个，
     * 于是这句话会变成「同一个箭头有字形、又没有」。那句话是给读者看的，
     * 而读者看的正是归一化**之后**的日志。 */
    expect(normalizeCp936Glyphs("⇒").text).toBe("→");
    expect(normalizeCp936Glyphs("⇄").text).toBe("→");
  });

  it("路由表那个 dynamic 标记（U+0192）按登记走 `f`，并且**不再因此出声**（ISSUE #2346）", () => {
    /* 夹具是 `每日生产构建` 那一格里逐字出现过的一行：`ƒ`（long s）在 CP936 里没有字形，
     * 而 Next 用它标 dynamic 路由 ⇒ 一跑 51 条路由就是 51 个 `\u0192`。登记成 `f` 之后，
     * 这一行同时消失两样东西：字面兜底，和那句兜底读数（整批都在表里 ⇒ 出声条件不成立）。 */
    const got = normalizeCp936Glyphs("├ \u0192 /api/comfy/queue");
    expect(got.text).toBe("├ f /api/comfy/queue");
    expect(got.replaced).toEqual([{ from: "\u0192", to: "f", count: 1 }]);
    expect(describeGlyphReplacements(got.replaced)).toBe("");
    /* `├` 是制表符，CP936 里有字形 ⇒ 它本来就不该被动。 */
    expect(normalizeCp936Glyphs(got.text).replaced).toEqual([]);
  });

  it("替代物**全部**落在 CP936 里 —— 否则替换完还要再被吃一次", () => {
    for (const [from, to] of GLYPH_REPLACEMENTS) {
      for (const ch of to) {
        expect(isCp936Encodable(ch), `${from} 的替代写法里有 CP936 编不出来的字符：${ch}`).toBe(
          true,
        );
      }
    }
  });
});

describe("字形归一化：不动不该动的东西", () => {
  it("中文与 ASCII 原样不动", () => {
    const text = "中文还是中文 ASCII 123 !@#";
    expect(normalizeCp936Glyphs(text).text).toBe(text);
  });

  it("原文里本来就有的问号**不动**（它与被替换出来的问号同形，却不是一回事）", () => {
    const text = "这一句本来就有一个问号 ?";
    const out = normalizeCp936Glyphs(text);
    expect(out.text).toBe(text);
    expect(out.replaced).toEqual([]);
  });

  it("明确保留的那两个字符不动（.NET 能编，Node 那张表判不出来）", () => {
    for (const ch of GLYPH_KEPT) {
      expect(normalizeCp936Glyphs(`a${ch}b`).text).toBe(`a${ch}b`);
    }
  });

  it("零宽类被删掉（它们本来就不占地方）", () => {
    for (const ch of GLYPH_DROPPED) {
      const out = normalizeCp936Glyphs(`a${ch}b`);
      expect(out.text, `${ch} 应当被删掉`).toBe("ab");
    }
  });
});

describe("字形归一化：emoji 与代理对", () => {
  it("emoji 走 `\\uXXXX` 兜底（CP936 没有四字节区，emoji 同样会变问号）", () => {
    const out = normalizeCp936Glyphs("📂");
    expect(out.text).toBe(String.raw`\u1F4C2`);
  });

  it("代理对**不拆**：一个 emoji 出来是一个码位，不是两截", () => {
    /* 拆开的话会得到两个 `\\uD83C` / `\\uDF42` —— 那是半个字符，读不出来。 */
    const out = normalizeCp936Glyphs("📂");
    expect(out.text).not.toContain(String.raw`\uD83C`);
    expect(out.text).not.toContain(String.raw`\uDF42`);
    expect(out.replaced).toHaveLength(1);
  });
});

describe("字形归一化：幂等与读数", () => {
  it("归一化过一次的内容再归一化，结果不变", () => {
    const once = normalizeCp936Glyphs("✓ ⇒ ⚠ ✗ ⌘ 📂");
    const twice = normalizeCp936Glyphs(once.text);
    expect(twice.text).toBe(once.text);
    expect(twice.replaced).toEqual([]);
  });

  it("读数里的字符**全是 CP936 编得出来的**（读数自己不许变成问号）", () => {
    /* 这条是本文件最要紧的不变式：读数走的是同一条转码链，它自己带一个编不出来的
     * 字符，就等于「换掉了别人的问号、自己又造了一个」。 */
    const out = normalizeCp936Glyphs("✓ ⇒ ⚠ 🐧");
    const line = describeGlyphReplacements(out.replaced);
    expect(line.length).toBeGreaterThan(0);
    for (const ch of line) {
      if (ch.codePointAt(0)! < 0x80) {
        continue;
      }
      expect(
        isCp936Encodable(ch),
        `读数里有 CP936 编不出来的字符：${ch}（U+${(ch.codePointAt(0) ?? 0)
          .toString(16)
          .toUpperCase()}）`,
      ).toBe(true);
    }
  });

  /**
   * 出声的条件（ISSUE #2326，业主口径）：**登记表里有的那些不再逐次报**。
   *
   * 这一条钉的不是措辞，是「谁需要看这行日志」：登记过的替换在日志里本来就读得出来
   * （`✓→√`、`⇒→→`、零宽类删掉），每跑念一次只会教读者忽略它 —— 而它唯一的对象是
   * 「只能记成 `\uXXXX`、需要人去看一眼」那一类。
   */
  it("全批都在登记表里 ⇒ 这一行整条不发（不是发一行「按设计办完了」）", () => {
    const out = normalizeCp936Glyphs("✓✓ ✓ ⇒ ⚠ ✗ ​");
    expect(out.replaced.length, "夹具该产生几条替换").toBeGreaterThan(0);
    expect(describeGlyphReplacements(out.replaced)).toBe("");
  });

  it("只有落了 `\\uXXXX` 兜底的才点名，并把「另有多少按表换过」说成一个数", () => {
    const out = normalizeCp936Glyphs("✓ ⇒ 🐧");
    const line = describeGlyphReplacements(out.replaced);
    expect(line).toContain("U+1F427");
    expect(line).toContain(String.raw`\u1F427`);
    expect(line).toContain("有 1 个字符");
    // 兜底那一个单独点名；登记过的两个只留总数，不逐字念出来。
    expect(line).toContain("另有 2 处按登记表换成读得出来的写法");
    expect(line).not.toContain("U+2713");
    expect(line).not.toContain("U+21D2");
  });

  it("收尾那条同一判据：全是登记过的 ⇒ 也不发", () => {
    const out = normalizeCp936Glyphs("✓ ⇒");
    expect(
      describeGlyphReplacements(out.replaced, "这一跑"),
      "「这一跑」那条不许成为唯一还在吵的那一处",
    ).toBe("");
  });
});

describe("CP936 码表：与 .NET 的判定同源", () => {
  it("抽样对账：已知「有字形」的那些确实有", () => {
    /* 这一组是实测过的：`.NET` 的 `GetEncoding(936)` 能编出来。 */
    for (const ch of ["中", "文", "·", "—", "→", "×", "√", "▼", "※", "④", "…"]) {
      expect(isCp936Encodable(ch), `${ch} 应当有 CP936 字形`).toBe(true);
    }
  });

  it("抽样对账：已知「没字形」的那些确实没有", () => {
    /* 这一组是实测过的：`.NET` 会把它们各写成**一个问号**。 */
    for (const ch of ["✓", "⇒", "⚠", "✗", "✅", "❌", "⌘", "↔", "⇄", "▾", "•"]) {
      expect(isCp936Encodable(ch), `${ch} 不该有 CP936 字形`).toBe(false);
    }
  });

  it("登记表里**没有死条目**（每一条登记项都确实编不出来）", () => {
    /* 死条目 = 那个字符本来就能编 ⇒ 那条替代永远不会触发 ⇒ 表会虚胖，
     * 而「表里每一项都活着」是这张表唯一的不变式。 */
    for (const key of GLYPH_REPLACEMENTS.keys()) {
      expect(
        isCp936Encodable(key),
        `登记表里的 ${key}（U+${(key.codePointAt(0) ?? 0).toString(16).toUpperCase()}）` +
          "其实编得出来 —— 那是一条死条目",
      ).toBe(false);
    }
  });

  it("码表本身不是空的（判据在空表上会假绿）", () => {
    expect(cp936EncodableSet().size).toBeGreaterThan(20_000);
  });
});

describe("转码外壳：接上了归一化", () => {
  it("`ci-cp936-exit.mjs` 在转码**之前**做了归一化", () => {
    /* 形状判据：归一化必须发生在交给转码之前 —— 放在之后已经晚了
     * （.NET 那一步在编码时就把字符写成问号了）。 */
    const source = read("scripts/ci-cp936-exit.mjs");
    expect(source).toContain("normalizeCp936Glyphs");
    const normalizeAt = source.indexOf("normalizeCp936Glyphs(text)");
    const writeAt = source.indexOf("write(normalized.text");
    expect(normalizeAt).toBeGreaterThan(-1);
    expect(writeAt).toBeGreaterThan(-1);
    expect(normalizeAt).toBeLessThan(writeAt);
  });

  it("两处读数都走转码那条路（`write`），且**空串就整行不发**", () => {
    /* `emit` 写的是 UTF-8 字节，而平台按 CP936 解一切 ⇒ 走 `emit` 的中文会变乱码，
     * 那正是这一层要治的病。
     * 而「空串不发」是 ISSUE #2326 那一刀的落点：判据在 `describeGlyphReplacements` 里，
     * **两处调用点都得尊重它** —— 只改一处会出现「逐块安静、收尾照吵」，
     * 那种半静默比原来更糟（读者以为它不报了）。 */
    const source = read("scripts/ci-cp936-exit.mjs");
    expect(source).toContain("describeGlyphReplacements");
    const guards = source.match(/if \(said !== ""\)/g) ?? [];
    expect(guards.length, "两处调用点各要有一个「空串就不发」").toBe(2);
    /* 收尾那条调用的**两种形态**都认：参数只有一个且短时格式化器会把它收成一行，
     * 而这里读的已经是归一化后的文本。钉住的是「收尾那处也走 describeGlyphReplacements」
     * 这层结构，不是换行在哪 —— 只认 `(\n` 会随格式化器的排版飘。 */
    const summaryAt = source.indexOf("describeGlyphReplacements([");
    expect(summaryAt, "认不出收尾那条调用；它的形状变了要同批改这里").toBeGreaterThan(-1);
    const summaryChunk = source.slice(summaryAt, summaryAt + 320);
    expect(summaryChunk).toContain("write(summary");
  });
});
