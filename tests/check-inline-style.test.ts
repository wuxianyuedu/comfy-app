/**
 * 内联样式注入门禁的自测（规范 03 §3.5 / 反模式 T5）。
 *
 * 为什么要自测：这条门禁的价值全在**判定口径**上——它必须能拦下「渲染出的
 * `<style>`」，同时不误伤注释里解释历史写法的引用（本仓库有意识地保留了那些
 * 注释：写清「被否决的方案」比删掉更有价值）。用临时仓库跑真脚本，断言该拦的
 * 拦、该放的放，避免门禁自己变成误报源。
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = path.resolve(__dirname, "../scripts/check-inline-style.cjs");
const tempDirs: string[] = [];

function scanner(files: Record<string, string>) {
  const root = mkdtempSync(path.join(tmpdir(), "inline-style-"));
  tempDirs.push(root);
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  copyFileSync(SCRIPT, path.join(root, "scripts", path.basename(SCRIPT)));
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
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string };
      return { ok: false, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
    }
  };
  return { run };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
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
