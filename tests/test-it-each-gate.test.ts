/**
 * 「参数化用例 `it.for` ⇄ `it.each`」门禁自测（规范 §11.15）。
 *
 * 本文件自己**不进扫描面**（`scripts/check-test-it-each.cjs` 的 `FIXTURE_SKIP`）：
 * 下面的被测字符串里就有真的 `it.each(...)`，判它等于判自己的量具
 * （§11.14.2 的通用口径，同 `tests/test-sleep-gate.test.ts` 的取舍）。
 *
 * 逐条钉判定口径（本判据是**硬闸**：无基线、无 `--update`）：
 *   ① `it.each` / `describe.each` 都是站点（按名字收窄会漏）→ 该拦
 *   ② 一处都没有 → 放行
 *   ③ 本地同名 helper（不是 vitest 导入的）→ 整文件不看
 *   ④ 夹具字符串 / 注释里的 `.each(` → 不算站点
 *   ⑤ 判据自己的夹具文件 → 跳过
 *   ⑥ 翻闸后无基线文件可读：`--update` 走的是「未知参数」旧路，不写任何 JSON
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
import { copyGateDeps } from "./helpers/gate-repo";

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
 * @param baseline 翻闸前遗留的基线文件内容（硬闸已不认它 —— 留着只为钉住
 *   「噪声基线不影响判定」：判定只看站点数是否为 0）
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
    copyGateDeps(path.join(root, "scripts", path.basename(src)));
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
    expect(r.output).toContain("还有 1 处 `it.each`");
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
    expect(r.output).toContain("还有 1 处 `it.each`");
  });

  it("①″ `test.each` 同样是站点", () => {
    const r = gate({
      "src/a.test.ts": `import { expect, test } from "vitest";
test.each([[1]])("%s", (n) => expect(n).toBe(1));
`,
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("还有 1 处 `it.each`");
  });
});

describe("it.each 门禁：该放的形状（§11.15）", () => {
  it("② 一处 `it.each` 都没有 → 放行", () => {
    const r = gate({ "src/a.test.ts": `${VITEST}it("x", () => {});\n` });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("OK");
  });

  it("②′ 翻闸前遗留的基线文件不影响判定（硬闸只看站点数是否为 0）", () => {
    const r = gate(
      { "src/a.test.ts": `${VITEST}it("x", () => {});\n` },
      [],
      { total: 2, files: { "src/a.test.ts": 2 } },
    );
    expect(r.ok).toBe(true);
    expect(r.output).toContain("OK");
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

describe("it.each 门禁：翻闸后不再有收紧档（§11.15）", () => {
  it("⑥ 无基线文件可写：带 `--update` 也不落盘任何 JSON", () => {
    const r = gate(
      {
        "src/a.test.ts": `${VITEST}it.each([[1]])("%s", (n) => expect(n).toBe(1));
`,
      },
      ["--update"],
    );
    /* 硬闸只认「站点数是否为 0」：`--update` 已不是本判据的出口，
     *  于是它退的是「有站点」那条 1，且**不写任何基线**（那条后门已封）。 */
    expect(r.ok).toBe(false);
    expect(r.output).toContain("还有 1 处 `it.each`");
    expect(
      existsSync(path.join(r.root, "scripts", ".test-it-each-baseline.json")),
    ).toBe(false);
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
