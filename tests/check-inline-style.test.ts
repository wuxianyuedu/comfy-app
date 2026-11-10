/**
 * 内联样式注入门禁的自测（规范 03 §3.5 / 反模式 T5）：须拦下渲染出的 `<style>`，同时不误伤
 * 注释里解释历史写法的引用（本仓有意保留那些「被否决的方案」注释）。用临时仓库跑真脚本，
 * 断言该拦的拦、该放的放，避免门禁自己变成误报源。
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { copyGateDeps } from "./helpers/gate-repo";
import { afterEach, describe, expect, it } from "vitest";

/**
 * 外来值（`execFileSync` 抛出的对象）先落 `unknown`，过这道守卫后逐字段 `typeof` 收窄才使用。
 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

const SCRIPT = path.resolve(__dirname, "../scripts/check-inline-style.cjs");
const tempDirs: Array<string> = [];

function scanner(files: Record<string, string>) {
  const root = mkdtempSync(path.join(tmpdir(), "inline-style-"));
  tempDirs.push(root);
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  /* 判据 `require("./gate-scan-read.cjs")`（`--staged` 的共享短路器）—— 临时仓库只放得下被测那一份脚本时，缺依赖的表现是可读性极差的 requireStack，所以按 `require("./x.cjs")` 递归补齐（同 `tests/helpers/gate-repo.ts` 的文件头）。 */
  copyFileSync(SCRIPT, path.join(root, "scripts", path.basename(SCRIPT)));
  copyGateDeps(path.join(root, "scripts", path.basename(SCRIPT)));
  for (const [file, content] of Object.entries(files)) {
    const abs = path.join(root, file);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  const run = (): { ok: boolean; output: string } => {
    try {
      return {
        ok: true,
        output: execFileSync(
          process.execPath,
          [path.join(root, "scripts", path.basename(SCRIPT))],
          { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        ),
      };
    } catch (error) {
      const fields = isRecord(error) ? error : null;
      const stdout = typeof fields?.stdout === "string" ? fields.stdout : "";
      const stderr = typeof fields?.stderr === "string" ? fields.stderr : "";
      return { ok: false, output: `${stdout}${stderr}` };
    }
  };
  return { run };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("check-inline-style", () => {
  it("渲染出的 <style> 阻断（CodeBlock 的旧形态）", () => {
    const { run } = scanner({
      "src/components/studio/ui/Thing.tsx": `const CSS = ".x { color: red }";
export function Thing() {
  return (
    <>
      <style>{CSS}</style>
      <div className="x" />
    </>
  );
}
`,
    });
    const r = run();
    expect(r.ok).toBe(false);
    expect(r.output).toContain("Thing.tsx");
  });

  it("带属性的 <style>（如 jsx 变体）同样阻断", () => {
    const { run } = scanner({
      "src/components/Foo.tsx": `export function Foo() {
  return <style jsx>{\`.a { color: red }\`}</style>;
}
`,
    });
    expect(run().ok).toBe(false);
  });

  it("注释里引用旧写法不误伤（本仓库有意保留这类说明）", () => {
    const { run } = scanner({
      "src/components/Foo.tsx": `export function Foo() {
  // 旧写法是 <style>{CSS}</style>，会随每次渲染重新注入；现已搬进 globals.css
  /* 同上：<style> 元素不要再用 */
  return <div className="x" />;
}
`,
    });
    expect(run().ok).toBe(true);
  });

  it("正确形态（类名 + globals.css）放行", () => {
    const { run } = scanner({
      "src/components/Foo.tsx": `export function Foo() {
  return <div className="cb-code-block" />;
}
`,
      "src/app/globals.css": `.cb-code-block { color: red }\n`,
    });
    expect(run().ok).toBe(true);
  });

  it("测试文件不参与扫描（用例里可能需要构造该形态）", () => {
    const { run } = scanner({
      "src/components/Foo.test.tsx": `it("x", () => {
  render(<style>{\`.a{}\`}</style>);
});
`,
    });
    expect(run().ok).toBe(true);
  });
});
