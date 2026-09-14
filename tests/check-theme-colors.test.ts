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
