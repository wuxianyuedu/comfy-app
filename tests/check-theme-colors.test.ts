/**
 * 主题色扫描器自测（ISSUE #75「取消暗色优先」）：门禁价值全在「豁免」—— 必须显式放行规范 03 §3.6.1 的两类
 * 例外（类型色、固定暗色清单），又必须拦住表面/文字语义的写死色值，否则豁免等于关闸。用「临时仓库 + 只放被测
 * 文件」跑真脚本，断言：成组/新入表的类型色被豁免、组件写死色值被拦、注释色值与 `#346` 不算命中、零命中的
 * 死豁免必须点名阻断（实测清掉过 4 条）。规范：docs/standards/03-样式与-tailwind.md §3.6.1 */
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { copyGateDeps } from "./helpers/gate-repo";
import { stripComments } from "./helpers/strip-comments";

const SCRIPT = path.resolve(__dirname, "../scripts/check-theme-colors.cjs");
const tempDirs: Array<string> = [];

/**
 * 造一个临时仓库：脚本按自身位置解析仓库根，故必须把脚本复制进去，
 * 否则扫的还是真实仓库 —— 那样用例会「总是通过」，等于没测。
 */
function scanner(files: Record<string, string>) {
  const root = mkdtempSync(path.join(tmpdir(), "theme-colors-"));
  tempDirs.push(root);
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  const dest = path.join(root, "scripts", path.basename(SCRIPT));
  copyFileSync(SCRIPT, dest);
  /* 脚本被拆成「主文件 + 声明层模块」后，只拷主文件跑起来是 `MODULE_NOT_FOUND`
   * —— 那条红长得像「判据坏了」，实际是夹具少带一个文件（§12.5.3 迁移五查）。
   * `copyGateDeps` 沿 `require("./x.cjs")` 递归补齐同目录依赖。 */
  copyGateDeps(dest);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  /* stdout + stderr 都要拼进 output：告警走 console.warn（stderr），而成功分支
   * 只拿得到 stdout —— 不拼就等于「负债只提醒」那条判据永远测不到。 */
  const run = (args: Array<string> = []): { ok: boolean; output: string } => {
    const res = spawnSync(
      process.execPath,
      [path.join(root, "scripts", path.basename(SCRIPT)), ...args],
      { cwd: root, encoding: "utf8" },
    );
    return {
      ok: res.status === 0,
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- spawnSync 起不来时 stdout/stderr 实测为 undefined，@types/node 按非空标，空串兜底保留
      output: `${res.stdout ?? ""}${res.stderr ?? ""}`,
    };
  };
  return { root, run };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
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

  it("候选名里用 `_` 连接的函数色必须算命中（曾经被 `\\b` 整条放过）", () => {
    /* 这条是量具自验：Tailwind 候选名用 `_` 代替空格，`px_rgba(` 里 `rgba` 前是单词字符，带 `\b` 的正则
     * 当场匹配不到 —— 于是这类裸值既不进豁免也不进报告，「未豁免 0 处」绿得毫无意义（实测漏过 6 处，含两处
     * 退役品牌紫）。判据口径见规范 03 §3.6.2：认的是「源码里写了字面色值」。类名前缀故意用 `probe-shadow`
     * （不是真 utility）：`tests/**` 也在 Tailwind 源扫描范围内，写真候选名就往产物里发一条死规则；判据只看
     * 文本里有没有 `_rgba(`，不需要那条类存在。 */
    const { run } = scanner({
      "src/components/studio/Thing.tsx":
        'export const B = () => <button className="probe-shadow-[0_4px_12px_rgba(124,92,252,0.35)]" />;\n',
    });
    const { ok, output } = run();
    expect(ok).toBe(false);
    /* 这一档现在是**硬闸**（存量清零、无基线、无 `--update`），话术是「存在未豁免的
     * 写死色值 + 每处点名处数」，不再是棘轮时代的「基线外新增 0 → 1」。 */
    expect(output).toContain("存在未豁免的写死色值");
    expect(output).toContain("src/components/studio/Thing.tsx：1 处");
  });

  it("对照：同一行只把裸值换成 token 便通过（判据认字面量，不认 shadow 写法）", () => {
    const { run } = scanner({
      /* 带上 globals.css 的声明：这份夹具引用了 `--color-primary`，不给声明会
       * 撞上同脚本的「幽灵 token」硬闸 —— 那条红得对，但会把这条想测的东西盖住。 */
      "src/app/globals.css": "@theme {\n  --color-primary: #8557de;\n}\n",
      "src/components/studio/Thing.tsx":
        'export const B = () => <button className="shadow-[0_4px_12px_color-mix(in_srgb,var(--color-primary)_35%,transparent)]" />;\n',
    });
    const { ok, output } = run();
    expect(ok).toBe(true);
    expect(output).toContain("未豁免写死色值 0 处");
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

  /* 短写法（`#f00` / `#abc4`）与 ISSUE 引用（`#346`）字符集同形，判据只能靠「`#` 前有没有颜色属性名」分开。
   * 两侧都要钉：短色值漏收 = 门禁静默放过一整类写法；ISSUE 号被收 = 每处 `ISSUE #NNN` 都变假红。此前没有判据
   * 是因为失效形态特殊：删掉限制后长的 `HEX_RE`（`{3,8}` 贪婪）仍会收到那个短色值，于是「删限制」在唯一那条
   * 断言上照绿；同形状还留下过只声明不引用的 `SHORT_HEX_RE` —— 死的那半没人报，活的那半「看起来还在工作」。 */
  it("短色值收窄双侧钉死：`#f00` 必须红、ISSUE `#346` 必须绿", () => {
    const bad = scanner({
      "src/components/studio/Thing.tsx": 'export const a = { color: "#f00" };\n',
    });
    const badRun = bad.run();
    expect(badRun.ok).toBe(false);
    expect(badRun.output).toContain("存在未豁免的写死色值");

    const good = scanner({
      "src/components/studio/Thing.tsx": "// 设计稿引了 ISSUE #346 与 #262\nexport const x = 1;\n",
    });
    const goodRun = good.run();
    expect(goodRun.ok).toBe(true);
    expect(goodRun.output).toContain("未豁免写死色值 0 处");
  });

  /* 短写法那一侧还能被「两条路」绕过：把 `HEX_RE` 改回只 3~4 位、另起一条扫长写法 —— 两侧都收看似没问题；
   * 真正的坑是只留一条收窄的短写法正则（如历史上的 `SHORT_HEX_RE`）而长写法不认它。所以下一格走真脚本的
   * 可达行为：短色值写在无颜色语境处（`const x = "#f00"` 不含 color/fill）就该被跳过 —— 与上一格一起，把
   * 「语境」这个判据条件从两侧夹住。 */
  it("短色值的语境判据是有意为之：无颜色属性名上下文时不收", () => {
    const { run } = scanner({
      "src/components/studio/Thing.tsx": 'const x = "#f00";\n',
    });
    const { ok, output } = run();
    expect(ok).toBe(true);
    expect(output).toContain("未豁免写死色值 0 处");
  });

  it("--report 只出清单，不判失败", () => {
    const { run } = scanner({
      "src/components/studio/Thing.tsx": 'export const s = { color: "#ff0000" };\n',
    });
    const { ok, output } = run(["--report"]);
    expect(ok).toBe(true);
    expect(output).toContain("只出清单，不判失败");
  });

  it("硬闸：新增写死色值即被拦（无基线可登记）", () => {
    const { run } = scanner({
      "src/components/studio/Thing.tsx":
        'export const a = "#111111";\nexport const b = "#222222";\n',
    });
    const { ok, output } = run();
    expect(ok).toBe(false);
    expect(output).toContain("存在未豁免的写死色值");
  });

  it("硬闸：翻闸前遗留的基线文件不影响判定（只看未豁免是否为 0）", () => {
    const { root, run } = scanner({
      "src/components/studio/Thing.tsx": 'export const a = "#111111";\n',
    });
    writeFileSync(
      path.join(root, "scripts/.theme-color-baseline.json"),
      JSON.stringify({ total: 1, files: { "src/components/studio/Thing.tsx": 1 } }),
    );
    expect(run().ok).toBe(false);
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
      "src/lib/comfyui/types.ts": "// 类型色：MODEL #7C5CFF\nexport const x = 1;\n",
    });
    const { ok, output } = run(["--report"]);
    expect(ok).toBe(true);
    expect(output).toContain("豁免一处都没命中");
  });
});

/**
 * 「幽灵 token」硬闸（规范 03 §3.6.1）：治反方向漏改 —— 颜色改写成 `var(--color-x)`，却从未在任何 CSS 声明。
 * CSS 查无此变量不报错：`fill` 退黑初值、`stroke` 退 `none`，图标变黑块、描边整条消失。事故来源：
 * `ui/seed-mode-button.tsx` 四枚 seed 图标在一次目录归并里改成 `var(--color-seed-*)` 却没补 `globals.css`
 * 定义，静默失效若干轮；同期该文件的豁免一处不命中 = 上面那条死豁免判据，两面是同一件事。 */
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
      path.resolve(__dirname, "../src/components/studio/canvas/workflow-canvas-grid.ts"),
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
    const css = readFileSync(path.resolve(__dirname, "../src/app/globals.css"), "utf8");
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
 * ③「拼接 token 名」硬闸（规范 03 §3.6.1.1）：补幽灵判据唯一看不见的引用形态 —— `--color-${x}` 不是字面量，
 * 「引用了但没定义」无从比对；Tailwind v4 还会 tree-shake `@theme` 里没被引用的变量，判据看的是源码字面名。
 * 实测：塞一颗无人引用的 `--color-zprobe-unused` ⇒ 产物 0 次；111 颗里 24 颗被 shake 且名字在 src 从未出现；
 * 拼法命中处（`AuroraGlow` 的 `var(--color-aurora-${tone})`）靠 `AuroraBackground` 整名写过那三颗才保住 —— 重构掉那几行，光晕当场失色。 */
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
 * 「存量必须逐条定性」判据（ISSUE #672 / 规范 03 §3.6.1 末段）：存量清零后，零计数防不住把真漏改顺手登记进
 * `EXEMPT_TABLES` —— 豁免不计入基线，登记完就再也不会出现在报告里。所以钉两件事：豁免必须带理由（空理由
 * 等于模糊放行），且专项结束后未豁免计数为 0（翻硬闸后由判据本身守着，不是这份基线文件）。回归来源：本批把
 * 余量 115 处逐条定性时，「多加一条豁免」是唯一能不改代码就让数字变漂亮的动作 —— 正是规范里那句「模糊放行会让真正的漏改混在豁免里悄悄溜过」要防的。 */
describe("主题色豁免台账", () => {
  it("每一条豁免都有文件、理由，且不留下空的 exports 占位", () => {
    /* 台账随声明层一起搬到了 theme-color-exemptions.cjs（ISSUE #1811 拆表）：
     * 主脚本只剩「读表 + 判定」，表体不再住在那里。 */
    const exemptions = readFileSync(
      path.resolve(__dirname, "../scripts/theme-color-exemptions.cjs"),
      "utf8",
    );
    /* 取到 `module.exports` 为止 —— 那一份里 `EXEMPT_TABLES` 就是表体本身，
     * 后面紧跟 `module.exports`（旧实现里跟在后面的是主脚本的豁免索引构建）。 */
    const block = exemptions.slice(
      exemptions.indexOf("const EXEMPT_TABLES"),
      exemptions.indexOf("module.exports"),
    );
    const entries = block.match(/\{\s*\n\s*file:[\s\S]*?\n {2}\},/g) ?? [];
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      const file = /file:\s*"([^"]+)"/.exec(entry)?.[1];
      expect(file, `豁免条目缺 file：${entry.slice(0, 40)}`).toBeTruthy();
      const reason = /reason:\s*([\s\S]*?),\n {2}\},$/.exec(entry)?.[1] ?? "";
      // 理由必须说清「为什么这行色值是内容自己的颜色」，不能是一句「类型色」了事。
      expect(
        reason.replaceAll(/\s+/g, "").length,
        `豁免理由过短（等于没写）：${file}`,
      ).toBeGreaterThan(20);
    }
  });

  it("翻闸后不再有基线文件（未豁免须为 0，由判据本身守）", () => {
    expect(existsSync(path.resolve(__dirname, "../scripts/.theme-color-baseline.json"))).toBe(
      false,
    );
  });
});

/**
 * 「跨面相等主张」硬闸（ISSUE #1717）：治的是说出去的话 —— 用「与 `--color-primary` / `--color-accent` 同值」
 * 这类句子给裸色值背书。token 一改句子不会红：实测品牌紫 `#7C5CFC` 深化成 `#8557de` 时四处主张（三条豁免
 * 登记理由 + 一处代码注释）同时变成假话，而门禁只数裸值、不读理由，仍报「未豁免 0 处 ✓」。判据是禁止这种
 * 写法，不是校验它成立（后者每次改 token 都要重算 = §12.18 明写不要的「扫豁免理由的启发式」）；反控制同样重要：`var(--color-primary)` 与非品牌散文（`与 --color-subtle 是同一个值`）都不许被误抓，否则变误报机。 */
describe("跨面相等主张（给裸色值背书的「与品牌 token 同值」）", () => {
  it("注释里写「与 --color-primary 同值」→ 阻断并点名是哪一行", () => {
    /* 夹具路径挑一份**真在豁免表上、且按整文件放行**的（water-fill-progress：
     * exports 为空 = 文件级作用域），这样那颗裸值本身不红，红的只可能是新闸 ——
     * 否则「棘轮新增」与「主张」两种红在这一条里分不开。 */
    const { run } = scanner({
      "src/components/ui/water-fill-progress.tsx":
        'export const S = { outline: "2px solid #7C5CFC" }; // 与 --color-primary 同值\n',
      "src/app/globals.css": "@theme {\n  --color-primary: #8557de;\n}\n",
    });
    const { ok, output } = run();
    expect(ok).toBe(false);
    expect(output).toContain("背书");
    expect(output).toContain("src/components/ui/water-fill-progress.tsx:1");
  });

  it("豁免登记理由里写同样的话也算命中（判据扫 src，也扫它自己）", () => {
    /* 这次的四处过期主张里有三处长在 `EXEMPT_TABLES` 的 reason 里，而遍历 src 看不见它 ——
     * 这一条就是为「只覆盖了一半」那格补的：往副本脚本里注一条带主张的豁免，必须红。 */
    const root = mkdtempSync(path.join(tmpdir(), "theme-claim-reason-"));
    tempDirs.push(root);
    mkdirSync(path.join(root, "scripts"), { recursive: true });
    /* 注入点随声明层一起搬家：`EXEMPT_TABLES` 现在住在同目录的
     * theme-color-exemptions.cjs 里，往主脚本里替换字符串会一处都不命中。 */
    const dest = path.join(root, "scripts", path.basename(SCRIPT));
    copyFileSync(SCRIPT, dest);
    copyGateDeps(dest);
    const exemptionsPath = path.join(root, "scripts", "theme-color-exemptions.cjs");
    const exemptions = readFileSync(exemptionsPath, "utf8").replace(
      "const EXEMPT_TABLES = [",
      "const EXEMPT_TABLES = [\n" +
        "  {\n" +
        '    file: "src/components/studio/Reason.tsx",\n' +
        "    exports: [],\n" +
        '    reason: "W 徽标渐变（品牌双色，与 --color-primary 同值但需两色渐变）",\n' +
        "  },\n",
    );
    writeFileSync(exemptionsPath, exemptions);
    /* 夹具里那颗裸值正好被这条豁免吸收 ⇒ 不是死豁免，红的只可能是新闸。 */
    const fixture = path.join(root, "src/components/studio/Reason.tsx");
    mkdirSync(path.dirname(fixture), { recursive: true });
    writeFileSync(
      fixture,
      'export const G = "linear-gradient(135deg, #7C5CFC 0%, #FF5CA8 100%)";\n',
    );
    const res = spawnSync(process.execPath, [dest], {
      cwd: root,
      encoding: "utf8",
    });
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- spawnSync 起不来时 stdout/stderr 实测为 undefined，@types/node 按非空标，空串兜底保留
    const output = `${res.stdout ?? ""}${res.stderr ?? ""}`;
    expect(res.status).toBe(1);
    expect(output).toContain("背书");
    expect(output).toContain("豁免理由");
  });

  it("对照：同一份夹具只删那句主张，裸值走正常豁免便不再红", () => {
    const { run } = scanner({
      "src/components/ui/water-fill-progress.tsx":
        'export const S = { outline: "2px solid #7C5CFC" }; // 独立的内容类型色\n',
      "src/app/globals.css": "@theme {\n  --color-primary: #8557de;\n}\n",
    });
    expect(run().ok).toBe(true);
  });

  it("不误伤正确写法：直接取 var(--color-primary) 就不需要主张", () => {
    const { run } = scanner({
      "src/components/studio/Follow.tsx":
        'export const S = { outline: "2px solid var(--color-primary)" };\n',
      "src/app/globals.css": "@theme {\n  --color-primary: #8557de;\n  --color-node: #2b2b36;\n}\n",
    });
    expect(run().ok).toBe(true);
  });

  it("不判宽形态：非品牌家族的 token 散文不算（否则会在注释里命中一片）", () => {
    const { run } = scanner({
      "src/components/ui/Toggleish.tsx":
        "export const A = 1;\n" +
        "/* 这里的 `bg-surface-1` 与 `--color-subtle` 在浅色主题下是同一个值。 */\n" +
        "/* `--color-muted` 与 `--color-ink-muted` 逐字节同值，已删。 */\n",
      "src/app/globals.css": "@theme {\n  --color-primary: #8557de;\n}\n",
    });
    expect(run().ok).toBe(true);
  });

  it("`#609` 这种行号/ISSUE 号不与主张混为一谈（判据认的是句子，不是井号）", () => {
    const { run } = scanner({
      "src/components/ui/IssueRef.tsx":
        "export const A = 1;\n" + "/* 见 #609：这颗紫与 `--color-node` 无关，只是历史遗留。 */\n",
      "src/app/globals.css": "@theme {\n  --color-primary: #8557de;\n}\n",
    });
    expect(run().ok).toBe(true);
  });
});

describe("属性前缀 + 裸 CSS 变量（bg-(--color-…) 这一族，规范 §3.1.1）", () => {
  it("代码行里写 bg-(--color-node) → 阻断并点出是哪一行", () => {
    const { run } = scanner({
      "src/components/studio/BareVar.tsx":
        'export const cls = "flex bg-(--color-node) text-ink";\n',
      "src/app/globals.css": "@theme {\n  --color-node: #2b2b36;\n  --color-ink: #ededf2;\n}\n",
    });
    const { ok, output } = run();
    expect(ok).toBe(false);
    expect(output).toContain("裸 CSS 变量");
    expect(output).toContain("src/components/studio/BareVar.tsx:1");
  });

  it("对照：同一行改成类名便不再红（这条闸只挡「越过语义层」那一族写法）", () => {
    const { run } = scanner({
      "src/components/studio/BareVar.tsx": 'export const cls = "flex bg-node text-ink";\n',
      "src/app/globals.css": "@theme {\n  --color-node: #2b2b36;\n  --color-ink: #ededf2;\n}\n",
    });
    expect(run().ok).toBe(true);
  });

  it("不误伤 arbitrary 值里的 var() —— 那是 calc 的一部分，不是「属性前缀吃裸变量」", () => {
    /* 夹具里的类名**运行期拼**：本文件在 Tailwind 的扫描语义里属于「正文侧」，
     * 写全一枚 square-bracket 候选名就会被 docs-candidate-hygiene 那条差集判据点名。 */
    const varName = "canvas";
    const { run } = scanner({
      "src/components/studio/Calcish.tsx": `export const cls = "w-[calc(100%-var(--color-${varName}))]";\n`,
      "src/app/globals.css": `@theme {\n  --color-${varName}: #0a0a0f;\n}\n`,
    });
    expect(run().ok).toBe(true);
  });

  it("注释里讲这一族（globals.css 反例清单那种）不判 —— 「只看代码行」这条口径在承重", () => {
    const { run } = scanner({
      "src/components/studio/DocOnly.tsx":
        "export const A = 1;\n" +
        "/* 原写法是 `border-(--color-canvas)` 拿画布色当描边，已 token 化，勿回退。 */\n",
      "src/app/globals.css":
        "@theme {\n  --color-canvas: #0a0a0f;\n  --color-port-surface: #2b2b36;\n}\n",
    });
    expect(run().ok).toBe(true);
  });

  it("说清不覆盖：CSS 侧的 @apply 也写得出同一族，而这一条的面上没有 CSS", () => {
    /* 这一格钉的是**射程**，不是修法：把它写成「应该红」等于替 CSS 扩面，而扩面要先回答
     * `stripComments`（按 JS/TS 写的那份）在 CSS 上怎么算注释。所以今天它是**已知不覆盖**，
     * 规范 03 §3.1.1 与脚本注释都点名了这一条 —— 真要补那一面，这条会红得正是时候：
     * 那是改口径的动作，不是漏改。 */
    const { run } = scanner({
      "src/app/globals.css":
        "@theme {\n  --color-node: #2b2b36;\n}\n" +
        ".u-probe {\n  @apply bg-(--color-node);\n" +
        "  color: var(--color-node, #ffffff);\n}\n",
    });
    expect(run().ok).toBe(true);
  });
});

describe("已定义 token 上的装饰性兜底（var(--color-x, #hex)，§3.6.1.1）", () => {
  const FIXTURE_CSS = "@theme {\n  --color-canvas: #0a0a0f;\n  --color-ink: #ededf2;\n}\n";

  it("token 有定义却带色值兜底 → 阻断，且**豁免文件里也照判**（「未豁免写死色值」在那儿是闭嘴的）", () => {
    /* 夹具挑一份**整文件豁免**的类型色表（water-fill-progress）：第一行那颗裸 hex 由豁免层放行
     * （顺带让这条豁免保持「活着」，否则先红的是死豁免负债），第二行的兜底那条写死色值
     * 判据同样不看 —— 红的只可能是新闸，而这正是它相对那条判据的唯一覆盖。 */
    const { run } = scanner({
      "src/components/ui/water-fill-progress.tsx":
        'export const SEED = "#7C5CFC";\n' +
        'export const S = { edge: "var(--color-ink, #EDEDF2)" };\n',
      "src/app/globals.css": FIXTURE_CSS,
    });
    const { ok, output } = run();
    expect(ok).toBe(false);
    expect(output).toContain("兜底永远取不到");
    expect(output).toContain("src/components/ui/water-fill-progress.tsx:2");
    /* 同一条夹具不该 ALSO 报「未豁免写死色值」—— 报了就是这条闸与判定层的职责边界没守住，
     * 而「不看豁免表」恰恰是它存在的理由。 */
    expect(output).not.toContain("未豁免的写死色值");
  });

  it("不收紧到关键字兜底：currentColor 那类是已放行的防御性写法", () => {
    /* 上面那条决定长在「幽灵 token」一节的用例里（stroke="var(--color-real, currentColor)"
     * → 通过）。这一条把它钉在**新闸旁边**：把这条兜底闸收成「任何兜底」就会翻掉它，
     * 那是改口径，不是补执行者。 */
    const { run } = scanner({
      "src/components/ui/KeywordFallback.tsx":
        'export const I = () => <svg><path stroke="var(--color-ink, currentColor)" /></svg>;\n',
      "src/app/globals.css": FIXTURE_CSS,
    });
    expect(run().ok).toBe(true);
  });

  it("对照：删掉兜底就绿 —— 这条闸判的是那个取不到的第二来源，不是 var() 本身", () => {
    const { run } = scanner({
      "src/components/studio/Fallback.tsx": 'export const S = { color: "var(--color-ink)" };\n',
      "src/app/globals.css": FIXTURE_CSS,
    });
    expect(run().ok).toBe(true);
  });

  it("规定的 JS 出口不抓：useCssColorToken(整名, 兜底) 形态不同，那条要的就是兜底", () => {
    const { run } = scanner({
      "src/components/studio/Outlet.tsx":
        "export function C() {\n" +
        '  return useCssColorToken("--color-canvas", "#ffffff");\n' +
        "}\n",
      "src/app/globals.css": FIXTURE_CSS,
    });
    /* 这里**允许**整体不通过：那颗 `#ffffff` 属于「未豁免写死色值」那条的口径（真实调用点靠豁免层放行 ——
     * 见 theme-color-exemptions 里「混色种子值，不参与渲染」那条）。本条断言的是兜底闸不抓它：
     * 否则等于把规定的出口判成违规，而那条出口要的恰恰是一个兜底参数。 */
    const { output } = run();
    expect(output).not.toContain("兜底永远取不到");
  });

  it("与幽灵判据不重不漏：token **没**定义时红在幽灵那一条，不是这一条", () => {
    const { run } = scanner({
      "src/components/studio/BothRules.tsx":
        'export const S = { color: "var(--color-nowhere, #EDEDF2)" };\n',
      "src/app/globals.css": FIXTURE_CSS,
    });
    const { ok, output } = run();
    expect(ok).toBe(false);
    expect(output).toContain("--color-nowhere");
    expect(output).toContain("从未定义");
    expect(output).not.toContain("兜底永远取不到");
  });
});
