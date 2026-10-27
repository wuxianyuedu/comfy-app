/**
 * `scripts/ci-log.mjs` —— 门禁脚本一行判决出口的判断面（ISSUE #2506）。
 *
 * ## 它守的是什么
 *
 * 同一个跑批里并排放着的判据，说同一件事时长得完全不一样（四条当场读数写在
 * `scripts/ci-log.mjs` 的头注里：`✓ …` / `[format] OK` / `[cp936-glyph] …：没有 …`
 * / `[重档] … ok …`）。而**跳过与判过在那四条里逐字同形** —— 那是这一族最贵的形态
 * （判据在场、结论静默变成放行）。
 *
 * 所以这里判的不是「话写得好不好看」，只有三件：
 *
 *   ① **三态分得开**：绿 / 跳过 / 红 的前缀各不相同，且「没有判」的那一句不会
 *      长得像「判过了」；
 *   ② **降级是自动的**：判据的读数里带「这一轮没判」的固定说法时，`gatePass()`
 *      必须自己把它降成 `skip` —— 否则漏打一档的全部代价都落回「作者记不记得」；
 *   ③ **红的证据不静默截断**：截了就报「另有 N 条」，与 `ci-heavy-gates.mjs`
 *      那一段的取舍同一口径。
 *
 * ## 不能判什么
 *
 * **不判**某条判据有没有真的改用这个出口 —— 那是 `tests/ci-log-adoption.test.ts`
 * 的活（它按文本核 `scripts/**` 的结论行形状）。这条门禁改的是「读得出来」，
 * 不是「判得对」：判决、退出码、账本一件都没动。
 */
import { describe, expect, it } from "vitest";

import {
  SKIP_MARKERS,
  TAGS,
  gateFail,
  gatePass,
  gateSkip,
  indentItems,
  looksSkipped,
  renderVerdict,
  summarize,
} from "../scripts/ci-log.mjs";

describe("三条判决的形状", () => {
  it("绿：一行、带对象与读数，前缀是 [ok]", () => {
    const [head] = renderVerdict({
      gate: "函数长度",
      subject: "src/**",
      detail: "超过 400 行 0 个",
    });
    expect(head).toBe("[ok] 函数长度 · src/**（超过 400 行 0 个）");
  });

  it("跳过：前缀与绿不同，原因落在同一列", () => {
    const [head] = renderVerdict({
      state: "skip",
      gate: "生成态文档与源同步",
      detail: "暂存区是空的 ⇒ 没有要判的东西",
    });
    expect(head).toBe(
      "[skip] 生成态文档与源同步（暂存区是空的 ⇒ 没有要判的东西）",
    );
    expect(head?.startsWith(TAGS.ok)).toBe(false);
  });

  it("红：判决 + 下一动作 + 逐条证据，证据缩 4 格", () => {
    const lines = renderVerdict({
      gate: "跨文件重复块",
      subject: "src/**",
      items: ["a.ts ⇄ b.ts", "c.ts ⇄ d.ts"],
      hint: "抽共享模块，两边只留差异",
    });
    expect(lines[0]).toBe("[红] 跨文件重复块 · src/**（命中 2 条）");
    expect(lines[1]).toBe("      → 抽共享模块，两边只留差异");
    expect(lines.slice(2)).toEqual(["    a.ts ⇄ b.ts", "    c.ts ⇄ d.ts"]);
  });

  it("三态前缀互不相同（否则读者分不开「没判」与「判过了」）", () => {
    expect(new Set(Object.values(TAGS)).size).toBe(3);
  });

  it("没有任何对象 / 读数时不留悬空的分隔符", () => {
    expect(renderVerdict({ gate: "镜像身份", detail: " " })[0]).toBe(
      "[ok] 镜像身份",
    );
  });
});

describe("降级：读数里说「这一轮没判」的自动成 skip", () => {
  it.for(SKIP_MARKERS.map((m) => [m]))("「%s」触发降级", ([marker]) => {
    expect(looksSkipped(`[doc-mirror] ${marker} ⇒ 这一批没有要判的东西`)).toBe(
      true,
    );
    expect(gatePass("某判据", `${marker} ⇒ 这一批没有要判的东西`)).toBe("skip");
  });

  it("干净的读数不会被误降级（它说的是判过了）", () => {
    expect(gatePass("某判据", "扫描 214 个模块：命中 0 条")).toBe("ok");
  });

  it("降级后那一行带的是 [skip]，不是 [ok]", () => {
    const lines: string[] = [];
    gatePass("镜像同批", "暂存区是空的 ⇒ 没有要判的东西", {
      out: (line: string) => lines.push(line),
    });
    expect(lines[0]?.startsWith(TAGS.skip)).toBe(true);
  });
});

describe("红的证据：截断必须报数", () => {
  it("超出上限时明说另有几条，且总条数是真实的那一个", () => {
    const lines = renderVerdict({
      state: "red",
      gate: "文件结构硬规则",
      items: Array.from({ length: 7 }, (_, i) => `f${i}.ts:1 违规`),
      max: 3,
    });
    expect(lines.filter((l) => l.startsWith("    f"))).toHaveLength(3);
    expect(lines.at(-1)).toBe("    …另有 4 条未展开（共 7 条）");
  });

  it("max: 0 是「全部展开」，不是「一条都不打」", () => {
    const lines = renderVerdict({
      state: "red",
      gate: "x",
      items: ["a", "b"],
      max: 0,
    });
    expect(lines).toEqual(["[红] x（命中 2 条）", "    a", "    b"]);
  });

  it("空项与纯空白行不进证据（红的那一屏最怕排版噪声）", () => {
    expect(indentItems(["a", "", "   ", "b"])).toEqual(["    a", "    b"]);
  });

  it("读数默认是「命中 N 条」，条数按非空项算", () => {
    expect(summarize(["a", " "])).toBe("命中 1 条");
    expect(summarize([])).toBe("命中 0 条");
  });
});

describe("三个动词都只排版、不判", () => {
  it("返回值就是实际打出来的那一档（调用方不必自己记）", () => {
    expect(gatePass("a", "命中 0 条")).toBe("ok");
    expect(gateSkip("b", "暂存区是空的")).toBe("skip");
    expect(gateFail("c", ["x:1"])).toBe("red");
  });

  it("gateFail 的 detail 可以覆盖默认读数", () => {
    const lines: string[] = [];
    gateFail("函数长度", ["f:1"], {
      detail: "超过 400 行 2 个",
      out: (line: string) => lines.push(line),
    });
    expect(lines[0]).toBe("[红] 函数长度（超过 400 行 2 个）");
  });
});

describe("没有证据就不打红（屏幕上不许出现「命中 0 条」的红）", () => {
  it("gateFail 收到空清单时什么都不打，并如实回 ok", () => {
    const lines: string[] = [];
    expect(
      gateFail("文件结构硬规则", [], {
        out: (line: string) => lines.push(line),
      }),
    ).toBe("ok");
    expect(lines).toEqual([]);
  });

  it("只有空白项时按空清单算（它渲染出来也是一行空的）", () => {
    expect(gateFail("x", ["", "  "])).toBe("ok");
  });
});
