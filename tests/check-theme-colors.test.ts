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
 *   · 注释里的色值与 ISSUE 号（`#346`）不算命中。
 *
 * 规范：docs/standards/03-样式与-tailwind.md §3.6.1
 */
import { execFileSync } from "node:child_process";
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
  const run = (args: string[] = []): { ok: boolean; output: string } => {
    try {
      return {
        ok: true,
        output: execFileSync(
          process.execPath,
          [path.join(root, "scripts", path.basename(SCRIPT)), ...args],
          { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        ),
      };
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string };
      return { ok: false, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
    }
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
