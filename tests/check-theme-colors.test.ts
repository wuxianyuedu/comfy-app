/**
 * 主题色扫描器自测（ISSUE #75「取消暗色优先」专项）。
 *
 * 这个门禁的价值全在「豁免」上：它必须**显式**放行规范 03 §3.6.1 的两类例外
 * （类型色例外、固定暗色清单），否则每轮扫描都会把同一批类型色再报一遍；
 * 又必须对「真正的漏改」（表面/文字语义的写死色值）保持拦截，否则豁免等于
 * 把门禁关掉。用「临时仓库 + 只放被测文件」跑真脚本，断言：
 *   · 成组常量表里的类型色被豁免（不报）；
 *   · 新写在常量表里的类型色同样被豁免（豁免随表走，不是逐行白名单）；
 *   · 组件里写着表面/文字语义的写死色值不被误放（进基线/被拦）；
 *   · 注释里的色值与 ISSUE 号（`#346`）不算命中；
 *   · **一条都不命中的豁免**是负债（它会静默放行该文件今后的写死色值），
 *     必须被点名并阻断 —— 实测清掉过 4 条这样的条目。
 *
 * 规范：docs/standards/03-样式与-tailwind.md §3.6.1
 */
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { stripComments } from "./helpers/strip-comments";

const SCRIPT = path.resolve(__dirname, "../scripts/check-theme-colors.cjs");
const tempDirs: string[] = [];

/**
 * 造一个临时仓库：脚本按自身位置解析仓库根，故必须把脚本与（可选的）基线
 * 一起复制进去，否则扫的还是真实仓库 —— 那样用例会「总是通过」，等于没测。
 */
function scanner(
  files: Record<string, string>,
  baseline?: Record<string, number>,
) {
  const root = mkdtempSync(path.join(tmpdir(), "theme-colors-"));
  tempDirs.push(root);
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  copyFileSync(SCRIPT, path.join(root, "scripts", path.basename(SCRIPT)));
  writeFileSync(
    path.join(root, "scripts/.theme-color-baseline.json"),
    JSON.stringify({
      generatedAt: "2026-01-01",
      total: Object.values(baseline ?? {}).reduce((a, b) => a + b, 0),
      files: baseline ?? {},
    }),
  );
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  /* stdout + stderr 都要拼进 output：告警走 console.warn（stderr），而成功分支
   * 只拿得到 stdout —— 不拼就等于「负债只提醒」那条判据永远测不到。 */
  const run = (args: string[] = []): { ok: boolean; output: string } => {
    const res = spawnSync(
      process.execPath,
      [path.join(root, "scripts", path.basename(SCRIPT)), ...args],
      { cwd: root, encoding: "utf8" },
    );
    return {
      ok: res.status === 0,
      output: `${res.stdout ?? ""}${res.stderr ?? ""}`,
    };
  };
  return { root, run };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("check-theme-colors", () => {
  it("豁免成组常量表里的类型色", () => {
    const { run } = scanner({
      "src/lib/comfyui/types.ts":
        'export const PORT_COLORS = { MODEL: "#7C5CFF", IMAGE: "#3FBF7F" };\n',
    });
    const { ok, output } = run();
    expect(ok).toBe(true);
    expect(output).toContain("显式豁免");
    expect(output).toContain("src/lib/comfyui/types.ts");
  });

  it("豁免随表走：新增的类型色不被拦", () => {
    const { run } = scanner({
      "src/lib/comfyui/types.ts":
        'export const PORT_COLORS = { MODEL: "#7C5CFF", NEW_TYPE: "#ABCDEF" };\n',
    });
    expect(run().ok).toBe(true);
  });

  it("按顶层标识符划定作用域：同一文件里表外的写死色值仍会被拦", () => {
    const { run } = scanner({
      "src/lib/comfyui/types.ts":
        'export const PORT_COLORS = { MODEL: "#7C5CFF" };\nexport const SURFACE = { bg: "#101014" };\n',
    });
    const { ok, output } = run();
    expect(ok).toBe(false);
    expect(output).toContain("SURFACE");
  });

  it("不误伤：注释里的色值与 ISSUE 号不算命中", () => {
    const { run } = scanner({
      "src/components/studio/Thing.tsx":
        "// 设计稿：Card #16161C / border #26262E\n/* 见 ISSUE #346 与 #442 */\nexport const x = 1;\n",
    });
    const { ok, output } = run();
    expect(ok).toBe(true);
    expect(output).toContain("未豁免写死色值 0 处");
  });

  it("--report 只出清单，不判失败", () => {
    const { run } = scanner({
      "src/components/studio/Thing.tsx":
        'export const s = { color: "#ff0000" };\n',
    });
    const { ok, output } = run(["--report"]);
    expect(ok).toBe(true);
    expect(output).toContain("只出清单，不判失败");
  });

  it("棘轮：超过基线的新增写死色值被拦", () => {
    const { run } = scanner({
      "src/components/studio/Thing.tsx":
        'export const a = "#111111";\nexport const b = "#222222";\n',
    });
    const { ok, output } = run();
    expect(ok).toBe(false);
    expect(output).toContain("基线外新增写死色值");
  });

  it("棘轮：与基线持平时通过", () => {
    const { run } = scanner(
      { "src/components/studio/Thing.tsx": 'export const a = "#111111";\n' },
      { "src/components/studio/Thing.tsx": 1 },
    );
    expect(run().ok).toBe(true);
  });

  /* 豁免登记之后还会「过期」：文件被 token 化了、或色值只剩在注释里（判据
   * 本来就不数注释），条目却还留在表上。它不报错，只会把该文件**今后**新写的
   * 死色值一并静默放行 —— 所以一条命不中的豁免是负债，本轮实测清掉 4 条。
   * 按文件判（不是按条目判），否则「被前一条遮蔽」会被误报成死条目。 */
  it("豁免一条都没命中 = 负债，阻断并点名该删哪条", () => {
    const { run } = scanner({
      "src/lib/comfyui/types.ts":
        "// 设计稿给的类型色：MODEL #7C5CFF / IMAGE #3FBF7F\nexport const x = 1;\n",
    });
    const { ok, output } = run();
    expect(ok).toBe(false);
    expect(output).toContain("不再命中任何东西");
    expect(output).toContain("src/lib/comfyui/types.ts");
  });

  it("对照：同一份文件的色值回到代码里，豁免正常命中便不报负债", () => {
    const { run } = scanner({
      "src/lib/comfyui/types.ts":
        'export const PORT_COLORS = { MODEL: "#7C5CFF", IMAGE: "#3FBF7F" };\n',
    });
    const { ok, output } = run();
    expect(ok).toBe(true);
    expect(output).not.toContain("不再命中任何东西");
  });

  it("--report 下负债只提醒，不判失败", () => {
    const { run } = scanner({
      "src/lib/comfyui/types.ts":
        "// 类型色：MODEL #7C5CFF\nexport const x = 1;\n",
    });
    const { ok, output } = run(["--report"]);
    expect(ok).toBe(true);
    expect(output).toContain("豁免一处都没命中");
  });
});

/**
 * 「幽灵 token」硬闸（规范 03 §3.6.1）。
 *
 * 这条治的是**反方向**的漏改：颜色不再写死、改成 `var(--color-x)`，但 `--color-x`
 * 从来没在任何 CSS 里声明过。CSS 变量查无此名时不报错，`fill` 退成黑色初值、
 * `stroke` 退成 `none` —— 图标变黑块、描边图形整条消失。
 *
 * 回归来源是实测事故：`ui/seed-mode-button.tsx` 的四枚 seed 图标在一次目录归并里
 * 从写死色值改成了 `var(--color-seed-*)`，`globals.css` 却没补定义，从此静默失效
 * 若干轮；同期该文件的主题色豁免一处都不再命中（= 上面那条死豁免判据），
 * 两面是同一件事。
 */
describe("幽灵 token（引用了从未定义的 --color-*）", () => {
  it("fill 引用的 token 全仓无定义 → 阻断并点名行号", () => {
    const { run } = scanner({
      "src/components/ui/GhostIcon.tsx":
        'export const I = () => <svg><path fill="var(--color-nope)" /></svg>;\n',
    });
    const { ok, output } = run();
    expect(ok).toBe(false);
    expect(output).toContain("--color-nope");
    expect(output).toContain("src/components/ui/GhostIcon.tsx:1");
  });

  it("同名 token 在 globals.css 的 @theme 里有定义 → 通过", () => {
    const { run } = scanner({
      "src/app/globals.css": "@theme {\n  --color-real: #ff6b6b;\n}\n",
      "src/components/ui/RealIcon.tsx":
        'export const I = () => <svg><path fill="var(--color-real)" /></svg>;\n',
    });
    expect(run().ok).toBe(true);
  });

  it("被注释掉的声明不算定义（幽灵 token 的形态就是「引用还在、定义没了」）", () => {
    const { run } = scanner({
      "src/app/globals.css": "@theme {\n  /* --color-real: #ff6b6b; */\n}\n",
      "src/components/ui/RealIcon.tsx":
        'export const I = () => <svg><path fill="var(--color-real)" /></svg>;\n',
    });
    const { ok, output } = run();
    expect(ok).toBe(false);
    expect(output).toContain("--color-real");
  });

  /* 带兜底的引用：名字**已声明**才合法。兜底让渲染结果确定，所以它不是「看不见」
   * 那类失效，而是装饰性 indirection —— 一行硬编码值挂着 token 的名字，读代码的人
   * 以为它随主题。`--color-canvas-grid-line` 就是靠这条豁免活了好几轮的，故收回。
   * 仍然不判的形态：Tailwind 裸变量 `text-(--x)` 与运行期注入的变量 —— 实测那种
   * 形态里「CSS 查无此名」是常态（base-ui 注入 --transform-origin 等），硬判会误报一片。 */
  it("带兜底但名字从未定义 → 阻断（装饰性 indirection）", () => {
    const { run } = scanner({
      "src/components/ui/OkIcon.tsx":
        'export const I = () => <svg><path stroke="var(--color-nope, currentColor)" /></svg>;\n',
    });
    const { ok, output } = run();
    expect(ok).toBe(false);
    expect(output).toContain("--color-nope");
    expect(output).toContain("装饰性 indirection");
  });

  it("带兜底且名字已声明 → 通过（兜底只是防御性写法）", () => {
    const { run } = scanner({
      "src/app/globals.css": "@theme {\n  --color-real: #ff6b6b;\n}\n",
      "src/components/ui/OkIcon.tsx":
        'export const I = () => <svg><path stroke="var(--color-real, currentColor)" /></svg>;\n',
    });
    expect(run().ok).toBe(true);
  });

  /* 判据认的是「字面量 + 带 `--color-` 前缀」这两个条件（带不带兜底都算），
   * 回归来源：把三处画布网格线收进一个出口函数之后，引用变成了出口里的模板串，
   * 只按属性形态判的判据会因为「集中化」这个正确动作而失明 ——
   * 泛化就是为了不让收口反而制造盲区。 */
  it("非属性形态（出口函数里的模板串）同样抓到", () => {
    const { run } = scanner({
      "src/components/studio/canvas/grid.ts":
        "export const line = (a: number): string =>\n" +
        "  `color-mix(in srgb, var(--color-nope-helper) ${a}%, transparent)`;\n",
    });
    const { ok, output } = run();
    expect(ok).toBe(false);
    expect(output).toContain("--color-nope-helper");
  });

  /* 收口的锚点：色相只许在 globals.css 定义一次，任何调用处再写回 rgba 都算退化。 */
  it("真实仓库：网格线三处画布共用同一个 token", () => {
    const grid = readFileSync(
      path.resolve(
        __dirname,
        "../src/components/studio/canvas/workflow-canvas-grid.ts",
      ),
      "utf8",
    );
    expect(grid).toContain("var(--color-canvas-grid-line)");
    for (const rel of [
      "../src/components/studio/WorkflowCanvasDecorations.tsx",
      "../src/components/studio/workflow-library/WorkflowLibraryCanvas.tsx",
    ]) {
      /* 只判代码：注释里正当地会出现被禁的叙述本身（「此前这里写的是 rgba…」），
       * 拿原文匹配就是自打自 —— 判据会红在一行文档上。 */
      expect(
        stripComments(readFileSync(path.resolve(__dirname, rel), "utf8")),
        `${rel} 又写回了网格线色相`,
      ).not.toMatch(/148\s*,\s*163\s*,\s*184/);
    }
  });

  it("真实仓库：seed 图标的 5 颗 token 有定义（事故不复发的锚点）", () => {
    const css = readFileSync(
      path.resolve(__dirname, "../src/app/globals.css"),
      "utf8",
    );
    for (const name of [
      "--color-seed-fixed",
      "--color-seed-step",
      "--color-seed-dice-bg",
      "--color-seed-dice-stroke",
      "--color-seed-dice-pip",
    ]) {
      expect(css, `globals.css 缺 ${name}：图标会静默变黑/消失`).toMatch(
        new RegExp(`^\\s*${name}\\s*:`, "m"),
      );
    }
  });
});

/**
 * ③「拼接 token 名」硬闸（规范 03 §3.6.1.1）。
 *
 * 这条补的是幽灵 token 判据**唯一看不见的引用形态**：`--color-${x}` 拼出来的名字
 * 不是字面量，「引用了但没定义」无从比对。它同时踩中第二个坑 —— Tailwind v4 会
 * tree-shake 掉 `@theme` 里**没被引用**的变量，而它判断「有没有被引用」看的也是
 * 源码里的**字面名**。实测（把 `globals.css` 真编译一次）：
 *   · 往 `@theme` 塞一颗谁都不引用的 `--color-zprobe-unused` → 产物里出现 **0 次**；
 *   · `globals.css` 声明的 111 颗 `--color-*` 里 **24 颗被 shake**，
 *     而这 24 颗在 `src/**` 里连名字都没出现过（= 被 shake 的全是零引用的，判据成立）；
 *   · 拼法命中的那一处（`AuroraGlow` 的 `var(--color-aurora-${tone})`）**今天还在渲染**，
 *     纯属侥幸 —— 那三颗的名字在 `AuroraBackground` 上半段与 `TrainingStudio` 的
 *     `stroke=` 里恰好被整名写过，是别人替它保住了变量。重构掉那几行，光晕当场失色。
 */
describe("拼接 token 名（幽灵判据的补集）", () => {
  it("模板插值拼出 --color- 名字 → 阻断", () => {
    const { run } = scanner({
      "src/components/ui/Composed.tsx":
        "export const G = ({ tone }: { tone: string }) => {\n" +
        "  const stop = `color-mix(in srgb, var(--color-aurora-${tone}) 40%, transparent)`;\n" +
        "  return <div style={{ background: stop }} />;\n" +
        "};\n",
    });
    const { ok, output } = run();
    expect(ok).toBe(false);
    expect(output).toContain("拼出来的");
    expect(output).toContain("src/components/ui/Composed.tsx:2");
  });

  it("字符串相加拼名 → 同样阻断", () => {
    const { run } = scanner({
      "src/components/ui/Concat.tsx": 'export const n = "--color-" + name;\n',
    });
    const { ok, output } = run();
    expect(ok).toBe(false);
    expect(output).toContain("拼出来的");
  });

  it("整名写成字面量的表 → 通过（规定的修法）", () => {
    const { run } = scanner({
      "src/app/globals.css": "@theme {\n  --color-aurora-cyan: #22d3ee;\n}\n",
      "src/components/ui/Table.tsx":
        'const MAP = { cyan: "var(--color-aurora-cyan)" } as const;\n' +
        "export const G = ({ tone }: { tone: keyof typeof MAP }) =>\n" +
        "  <div style={{ background: `color-mix(in srgb, ${MAP[tone]} 40%, transparent)` }} />;\n",
    });
    expect(run().ok).toBe(true);
  });

  /* 判据只认「名字里有插值或相加」两种形态。反引号里出现 `--color-` 前缀**不判** ——
   * 那种宽形态会在说明注释里命中上百处散文引用（globals.css 实测 103 处），
   * 而那些名字恰恰是「没人用、活该被 shake」的正确形态。 */
  it("注释里提到拼法不算违规（去注释后才判）", () => {
    const { run } = scanner({
      "src/components/ui/DocOnly.tsx":
        "// 别写成 `var(--color-aurora-${tone})`，名字要写全。\nexport const x = 1;\n",
    });
    expect(run().ok).toBe(true);
  });
});

/**
 * 「存量必须逐条定性」的判据（ISSUE #672 / 规范 03 §3.6.1 末段）。
 *
 * 清完之后棘轮是 **0**，而**零基线本身防不住两件事**：
 *   ① 新写一处「表面/文字语义」的写死色值 —— 这条棘轮管得住（基线不容抬高）；
 *   ② 把一处**真漏改**顺手登记进 `EXEMPT_TABLES` —— 棘轮对此完全无感：
 *      豁免不计入基线，登记完就再也不会出现在报告里。
 *
 * 所以这里钉两件事：豁免**必须带理由**（空理由等于模糊放行），且
 * 专项结束时基线为 0（否则说明又回到了「既不是豁免、也不是待治理项」）。
 *
 * 回归来源：本批把余量 115 处逐条定性时，「多加一条豁免」是唯一能让数字
 * 变漂亮又不改代码的动作 —— 这正是规范里那句「模糊放行会让真正的漏改
 * 混在豁免里悄悄溜过」要防的。
 */
describe("主题色豁免台账", () => {
  it("每一条豁免都有文件、理由，且不留下空的 exports 占位", () => {
    const src = readFileSync(SCRIPT, "utf8");
    const block = src.slice(
      src.indexOf("const EXEMPT_TABLES"),
      src.indexOf("/** 全部豁免落点索引"),
    );
    const entries = block.match(/\{\s*\n\s*file:[\s\S]*?\n {2}\},/g) ?? [];
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      const file = /file:\s*"([^"]+)"/.exec(entry)?.[1];
      expect(file, `豁免条目缺 file：${entry.slice(0, 40)}`).toBeTruthy();
      const reason = /reason:\s*([\s\S]*?),\n {2}\},$/.exec(entry)?.[1] ?? "";
      // 理由必须说清「为什么这行色值是内容自己的颜色」，不能是一句「类型色」了事。
      expect(
        reason.replace(/\s+/g, "").length,
        `豁免理由过短（等于没写）：${file}`,
      ).toBeGreaterThan(20);
    }
  });

  it("专项收口后基线为 0（没有「既不是豁免、也不是待治理项」的余量）", () => {
    const baseline = JSON.parse(
      readFileSync(
        path.resolve(__dirname, "../scripts/.theme-color-baseline.json"),
        "utf8",
      ),
    ) as { total: number; files: Record<string, number> };
    expect(baseline.total).toBe(0);
    expect(Object.keys(baseline.files)).toEqual([]);
  });
});
