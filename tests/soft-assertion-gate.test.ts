/**
 * 「软断言用在哪儿」门禁自测（规范 §11.18）。
 *
 * 判据的价值全在**判定口径**上，所以这里跑的是**真脚本**（临时仓库 + 只放被测文件），
 * 断言「该拦的拦、不该误伤的放过」。四条口径各有执行者：
 *
 *   ① **顺序依赖**（该拦）：软断言后面那行依赖它的结果 —— 报错会被后续的
 *      `TypeError` 顶掉，真正的原因一个字都不留。
 *   ② **循环体里**（该放）：`for` / `for...of` / `.forEach` 的块体，含嵌套 `if`。
 *   ③ **单行形态**（该放）：`for (…) { expect.soft(…) }` 与 `.forEach((x) => { … })`
 *      写在**一行**里 —— 循环关键字与站点同行，向上走永远看不到它
 *      （是判据首版的一处误报，所以必须有人钉住）。
 *   ④ **折行循环头**（该放）：`for (const n of [\n 1,\n]) {` 这类把关键字与 `{`
 *      隔开几行的写法。
 *   ⑤ **循环之后的语句**（该拦）：循环结束后的软断言不再受循环包着。
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = path.resolve(__dirname, "../scripts/check-soft-assertions.cjs");

/** 在临时仓库里跑真脚本（cwd = 临时仓库根，只放被测文件）。 */
function gate(files: Record<string, string>): { ok: boolean; output: string } {
  const root = mkdtempSync(path.join(tmpdir(), "soft-assert-"));
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  copyFileSync(SCRIPT, path.join(root, "scripts", path.basename(SCRIPT)));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
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
    const e = error as { stdout?: string; stderr?: string };
    return { ok: false, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

const HEAD = 'import { expect, it } from "vitest";\n';

describe("软断言门禁：该拦的形状（§11.18）", () => {
  it("顺序依赖：软断言后面那行用它的结果 → 阻断", () => {
    const r = gate({
      "tests/a.test.ts": `${HEAD}it("x", () => {
  const arr: number[] = [];
  expect.soft(arr.length, "应为空").toBe(0);
  expect.soft(arr[0].toFixed(2), "第一个元素").toBe("0.00");
});
`,
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("tests/a.test.ts:4");
    expect(r.output).toContain("tests/a.test.ts:5");
  });

  it("循环之后的语句不受循环包着 → 阻断", () => {
    const r = gate({
      "tests/a.test.ts": `${HEAD}it("x", () => {
  for (const n of [1, 2]) {
    expect.soft(n, "n").toBe(1);
  }
  expect.soft(1, "循环外").toBe(2);
});
`,
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("tests/a.test.ts:6");
    expect(r.output).not.toContain("tests/a.test.ts:4");
  });
});

describe("软断言门禁：不该误伤的写法（§11.18）", () => {
  it("循环体里（含嵌套 if）→ 放过", () => {
    const r = gate({
      "tests/a.test.ts": `${HEAD}it("x", () => {
  for (const n of [1, 2]) {
    if (n > 0) {
      expect.soft(n, "n").toBe(1);
    }
  }
});
`,
    });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("[soft] OK");
  });

  it("单行 for / forEach（站点与循环同行）→ 放过", () => {
    const r = gate({
      "tests/a.test.ts": `${HEAD}it("x", () => {
  for (const n of [1, 2]) { expect.soft(n, "n").toBe(1); }
  [1, 2].forEach((n) => { expect.soft(n, "n").toBe(1); });
});
`,
    });
    expect(r.ok).toBe(true);
  });

  it("折行循环头（关键字与 { 隔几行）→ 放过", () => {
    const r = gate({
      "tests/a.test.ts": `${HEAD}it("x", () => {
  for (const n of [
    1,
    2,
  ]) {
    expect.soft(n, "n").toBe(1);
  }
});
`,
    });
    expect(r.ok).toBe(true);
  });

  it("无软断言的文件 → 放过（计数为 0 也要报 OK）", () => {
    const r = gate({
      "tests/a.test.ts": `${HEAD}it("x", () => {
  expect(1).toBe(1);
});
`,
    });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("0 处 expect.soft");
  });
});
