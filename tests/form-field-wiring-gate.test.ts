/**
 * 「`<FormField>` 标签 ⇄ 控件接线」门禁自测（规范 §16.2.4.26）。
 *
 * 本文件自己**不进扫描面**（`scripts/check-form-field-wiring.cjs` 的
 * `FIXTURE_SKIP`）：下面的被测字符串里有真的 plain-children 站点，判它等于
 * 判自己的量具（§11.14.2 的通用口径，同 `tests/test-sleep-gate.test.ts`）。
 *
 * 逐条钉判定口径：
 *   ① plain children（普通子节点）→ 站点，该拦
 *   ② render-prop（箭头 / 函数表达式）→ 接线成立，放行
 *   ③ `label={null}` / 不给 `label` / 自闭合 → 没有标签行，放行
 *   ④ 棘轮：不超过基线就放行
 *   ⑤ `--update` 拒绝把基线往上涨
 *   ⑥ 非 `FormField` 的同名子节点（如 `<FormFieldRow>`）不算站点
 */
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPTS_DIR = path.resolve(__dirname, "../scripts");
const SCRIPT = path.join(SCRIPTS_DIR, "check-form-field-wiring.cjs");

/**
 * 在临时仓库里跑真脚本。
 * @param files 相对路径 → 文件内容
 * @param args 命令行参数（如 `--report`）
 * @param baseline 预置的棘轮基线（不传则无基线文件 = 起点 0 处）
 */
function gate(
  files: Record<string, string>,
  args: string[] = [],
  baseline?: { total: number; files: Record<string, number> },
): { ok: boolean; output: string } {
  const root = mkdtempSync(path.join(tmpdir(), "form-field-wiring-"));
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  copyFileSync(SCRIPT, path.join(root, "scripts", path.basename(SCRIPT)));
  /* 判据 `require("typescript")` 走 TypeScript AST —— 临时仓库里没有解析链，
   * 把它指回本仓库那份（同 `check-non-null-assertions.cjs` 类判据的自测手法）。 */
  symlinkSync(
    path.resolve(__dirname, "../node_modules"),
    path.join(root, "node_modules"),
    "dir",
  );
  if (baseline) {
    writeFileSync(
      path.join(root, "scripts", ".form-field-wiring-baseline.json"),
      JSON.stringify(baseline),
    );
  }
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  const entry = path.join(root, "scripts", "check-form-field-wiring.cjs");
  try {
    return {
      ok: true,
      output: execFileSync(process.execPath, [entry, ...args], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string };
    return { ok: false, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

describe("FormField 接线门禁：该拦的形状（§16.2.4.26）", () => {
  it("① plain children（普通子节点）是站点 → 阻断，并点名站点与章节", () => {
    const r = gate({
      "src/a.tsx": `export function A() {
  return (
    <FormField label="镜头名称">
      <input value="x" onChange={() => {}} />
    </FormField>
  );
}
`,
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("plain-children 站点涨了：1 处");
    expect(r.output).toContain("src/a.tsx");
    expect(r.output).toContain("§16.2.4.26");
  });

  it("①′ 普通子节点是自定义组件同样算站点（不是只认小写标签）", () => {
    const r = gate({
      "src/a.tsx": `export function A() {
  return (
    <FormField label="模式">
      <SelectMenu value="a" options={[]} onChange={() => {}} />
    </FormField>
  );
}
`,
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("1 处");
  });

  it("①″ 子节点是「函数调用返回的节点」也拿不到 a11y → 算站点", () => {
    const r = gate({
      "src/a.tsx": `export function A() {
  return <FormField label="模式">{renderControl()}</FormField>;
}
`,
    });
    expect(r.ok).toBe(false);
  });
});

describe("FormField 接线门禁：该放的形状（§16.2.4.26）", () => {
  it("② render-prop（箭头函数）接线成立 → 放行", () => {
    const r = gate({
      "src/a.tsx": `export function A() {
  return (
    <FormField label="镜头名称">
      {(field) => <input {...field} value="x" onChange={() => {}} />}
    </FormField>
  );
}
`,
    });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("OK —— 0 处");
  });

  it("②′ render-prop 展开写法（带包裹元素）同样放行", () => {
    const r = gate({
      "src/a.tsx": `export function A() {
  return (
    <FormField label="API Key">
      {(a11y) => (
        <div className="flex gap-2">
          <input {...a11y} />
          <button>测试</button>
        </div>
      )}
    </FormField>
  );
}
`,
    });
    expect(r.ok).toBe(true);
  });

  it("②″ 函数表达式（非箭头）也算 render-prop", () => {
    const r = gate({
      "src/a.tsx": `export function A() {
  return (
    <FormField label="x">
      {function (field) {
        return <input {...field} />;
      }}
    </FormField>
  );
}
`,
    });
    expect(r.ok).toBe(true);
  });

  it("③ `label={null}`（不渲染标签行）→ 放行", () => {
    const r = gate({
      "src/a.tsx": `export function A() {
  return (
    <FormField label={null}>
      <input />
    </FormField>
  );
}
`,
    });
    expect(r.ok).toBe(true);
  });

  it("③′ 不给 `label` → 放行", () => {
    const r = gate({
      "src/a.tsx": `export function A() {
  return (
    <FormField id="x" error="必填">
      <input />
    </FormField>
  );
}
`,
    });
    expect(r.ok).toBe(true);
  });

  it("③″ 自闭合（没有子节点）→ 放行", () => {
    const r = gate({
      "src/a.tsx": `export function A() {
  return <FormField label="只读" hint="说明文字" />;
}
`,
    });
    expect(r.ok).toBe(true);
  });

  it("⑥ 其他组件名里含 FormField 前缀（`FormFieldRow`）不算站点", () => {
    const r = gate({
      "src/a.tsx": `export function A() {
  return (
    <FormFieldRow label="x">
      <input />
    </FormFieldRow>
  );
}
`,
    });
    expect(r.ok).toBe(true);
  });
});

describe("FormField 接线门禁：棘轮（§16.2.4.26）", () => {
  it("④ 站点数不超过基线 → 放行（并在收紧时给出提示）", () => {
    const src = `export function A() {
  return <FormField label="a"><input /></FormField>;
}
`;
    const r = gate({ "src/a.tsx": src, "src/b.tsx": src }, [], {
      total: 2,
      files: { "src/a.tsx": 1, "src/b.tsx": 1 },
    });
    expect(r.ok).toBe(true);
  });

  it("④′ 比基线少（已收口）→ 放行并提醒收紧", () => {
    const r = gate(
      {
        "src/a.tsx": `export function A() {\n  return <FormField label="a"><input /></FormField>;\n}\n`,
      },
      [],
      { total: 5, files: {} },
    );
    expect(r.ok).toBe(true);
    expect(r.output).toContain("--update");
  });

  it("⑤ `--update` 拒绝把基线往上涨", () => {
    const r = gate(
      {
        "src/a.tsx": `export function A() {\n  return <FormField label="a"><input /></FormField>;\n}\n`,
      },
      ["--update"],
      { total: 0, files: {} },
    );
    expect(r.ok).toBe(false);
    expect(r.output).toContain("拒绝把基线往上涨");
  });

  it("⑤′ `--update` 在净数不涨时直接收紧", () => {
    const r = gate(
      {
        "src/a.tsx": `export function A() {\n  return <FormField label="a"><input /></FormField>;\n}\n`,
      },
      ["--update"],
      { total: 3, files: {} },
    );
    expect(r.ok).toBe(true);
    expect(r.output).toContain("基线已收紧到 1 处");
  });
});
