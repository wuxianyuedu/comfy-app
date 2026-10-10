/**
 * 「参数化用例 `it.for` ⇄ `it.each`」门禁自测（规范 §11.15）。
 *
 * 本文件自己**不进扫描面**（`scripts/check-test-it-each.cjs` 的 `FIXTURE_SKIP`）：
 * 下面的被测字符串里就有真的 `it.each(...)`，判它等于判自己的量具
 * （§11.14.2 的通用口径，同 `tests/test-sleep-gate.test.ts` 的取舍）。
 *
 * 逐条钉判定口径：
 *   ① `it.each` / `describe.each` 都是站点（按名字收窄会漏）→ 该拦
 *   ② 棘轮：不超过基线就放行
 *   ③ 本地同名 helper（不是 vitest 导入的）→ 整文件不看
 *   ④ 夹具字符串 / 注释里的 `.each(` → 不算站点
 *   ⑤ 判据自己的夹具文件 → 跳过
 *   ⑥ `--update` 拒绝把基线往上涨
 */
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPTS_DIR = path.resolve(__dirname, "../scripts");
const SCRIPT = path.join(SCRIPTS_DIR, "check-test-it-each.cjs");
/** 判据复用 `check-test-concurrency.cjs` 导出的 `maskNonCode`，临时仓库要一起带上。 */
const DEP = path.join(SCRIPTS_DIR, "check-test-concurrency.cjs");

/**
 * 「文件在扫描期间消失」那一支只能在**进程内**判：它要的是 `scanFile` 对一份
 * 读不到的路径返回什么，而临时仓库 + 子进程那条路造不出「列到名字、读时已没」
 * 这个时刻（造得出就只能靠删文件，那是一次概率窗口，不是判据）。
 */
const { scanFile } = createRequire(import.meta.url)(SCRIPT) as {
  scanFile: (abs: string) => unknown[] | null;
};

const VITEST = 'import { describe, expect, it } from "vitest";\n';

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
): { ok: boolean; output: string; root: string } {
  const root = mkdtempSync(path.join(tmpdir(), "test-it-each-"));
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  for (const src of [SCRIPT, DEP]) {
    copyFileSync(src, path.join(root, "scripts", path.basename(src)));
  }
  if (baseline) {
    writeFileSync(
      path.join(root, "scripts", ".test-it-each-baseline.json"),
      JSON.stringify(baseline),
    );
  }
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  const entry = path.join(root, "scripts", "check-test-it-each.cjs");
  try {
    return {
      ok: true,
      output: execFileSync(process.execPath, [entry, ...args], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
      root,
    };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string };
    return { ok: false, output: `${e.stdout ?? ""}${e.stderr ?? ""}`, root };
  }
}

describe("it.each 门禁：该拦的形状（§11.15）", () => {
  it("① `it.each` 是站点 → 阻断，并点名站点与章节", () => {
    const r = gate({
      "src/a.test.ts": `${VITEST}it.each([[1, "a"]])("%s %s", (n, s) => {
  expect(n).toBe(1);
});
`,
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("存量涨了：1 处");
    expect(r.output).toContain("src/a.test.ts");
    expect(r.output).toContain("§11.15");
  });

  it("①′ `describe.each` 同样是站点（按名字收窄会漏）", () => {
    const r = gate({
      "src/a.test.ts": `${VITEST}describe.each([["x"]])("%s", (v) => {
  it("t", () => expect(v).toBe("x"));
});
`,
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("存量涨了：1 处");
  });

  it("①″ `test.each` 同样是站点", () => {
    const r = gate({
      "src/a.test.ts": `import { expect, test } from "vitest";
test.each([[1]])("%s", (n) => expect(n).toBe(1));
`,
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("存量涨了：1 处");
  });
});

describe("it.each 门禁：该放的形状（§11.15）", () => {
  it("② 棘轮：不超过基线就放行", () => {
    const r = gate(
      {
        "src/a.test.ts": `${VITEST}it.each([[1]])("%s", (n) => expect(n).toBe(1));
`,
      },
      [],
      { total: 1, files: { "src/a.test.ts": 1 } },
    );
    expect(r.ok).toBe(true);
    expect(r.output).toContain("OK");
  });

  it("②′ 收口后比基线少 → 放行并提示收紧", () => {
    const r = gate({ "src/a.test.ts": `${VITEST}it("x", () => {});\n` }, [], {
      total: 2,
      files: { "src/a.test.ts": 2 },
    });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("跑 `--update` 把基线收紧");
  });

  it("③ 本地同名 helper（不是 vitest 导入的）→ 整文件不看", () => {
    const r = gate({
      "src/a.test.ts": `function it(_a: unknown, _b: unknown) {
  return undefined as never;
}
it.each([[1]])("x", () => {});
`,
    });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("OK");
  });

  it("④ 夹具字符串与注释里的 `.each(` → 不算站点（maskNonCode）", () => {
    const r = gate({
      "src/a.test.ts": `${VITEST}const FIXTURE = \`it.each([[1]])\`;
it("夹具字符串不算站点", () => {
  // describe.each 写在注释里也不算
  expect(FIXTURE).toContain("each");
});
`,
    });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("OK");
  });

  it("⑤ 判据自己的夹具文件 → 跳过（FIXTURE_SKIP）", () => {
    const r = gate({
      "tests/test-it-each-gate.test.ts": `${VITEST}it.each([[1]])("%s", (n) => expect(n).toBe(1));
`,
    });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("OK");
  });
});

describe("it.each 门禁：基线收紧档（§11.15）", () => {
  it("⑥ `--update` 拒绝把基线往上涨", () => {
    const r = gate(
      {
        "src/a.test.ts": `${VITEST}it.each([[1]])("%s", (n) => expect(n).toBe(1));
it.each([[2]])("%s", (n) => expect(n).toBe(2));
`,
      },
      ["--update"],
      { total: 1, files: { "src/a.test.ts": 1 } },
    );
    expect(r.ok).toBe(false);
    expect(r.output).toContain("--update 拒绝把基线往上涨");
  });

  it("⑥′ `--update` 把基线收紧到实测值", () => {
    const r = gate(
      { "src/a.test.ts": `${VITEST}it("x", () => {});\n` },
      ["--update"],
      { total: 3, files: { "src/a.test.ts": 3 } },
    );
    expect(r.ok).toBe(true);
    expect(r.output).toContain("基线已收紧到 0 处");
  });
});

describe("it.each 门禁：扫描期间文件消失（并发探针）", () => {
  it("读不到的文件返回 null，而不是把整个 D 组带崩", () => {
    /* 现场：`tests/global-setup-cleanup.test.ts` 会在 `tests/` 下临时造
       `.setup-cleanup-probe-<pid>-<ts>.test.tsx` 再删掉。同一份工作树里有两个
       vitest 在跑时（并行会话，或本钩子的 C 组还没退干净），本判据就会
       **「列到名字、读时已经没了」** —— 于是 D 组不是报出站点，而是带着一个
       Node 栈崩掉（`ENOENT … .setup-cleanup-probe-….test.tsx`），表现成
       「提交被拦下、报错里没有一个字指向改动」。
       一个已经不存在的文件没有站点可言 ⇒ 返回 null 让调用方计数；
       计数必须进结论行（`collect` 的 `vanished` 与 OK 那行的「另有 N 份未读」），
       静默跳过就是 §13.5.12 那一族「判据自称在跑、实际没跑」。 */
    const gone = path.resolve(
      __dirname,
      "..",
      "tests",
      `.setup-cleanup-probe-0-0.test.tsx`,
    );
    expect(existsSync(gone), "夹具路径本身不该存在").toBe(false);
    expect(scanFile(gone)).toBeNull();
  });
});
