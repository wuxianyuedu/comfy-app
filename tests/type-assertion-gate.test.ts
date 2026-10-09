/**
 * 「类型层断言有没有执行者」门禁自测（规范 §11.20）。
 *
 * 判据的价值全在**判定口径**上，所以这里跑的是**真脚本**（临时仓库 + 只放被测文件），
 * 断言「该拦的拦、不该误伤的放过」。每条口径都有执行者：
 *
 *   ① **站点在 include 面里**（该放）：这是正常形态 —— 执行者 = `tsc --noEmit`。
 *   ② **站点落到 include 面之外**（该拦）：实测这是**全仓断言同时变装饰品**的那条
 *      静默路径（收窄 `tsconfig.include` 之后 `tsc` 与 `vitest` 双双报绿）。
 *   ③ **`.test-d.ts` 站点**（该放）：vitest 不收它（实测「No test files found」），
 *      但 tsc 收 —— 所以它在 include 面里就是合法的「只给 tsc 看的」类型用例。
 *   ④ **零站点**（该放）：本判据是纯闸门，对象是「下一次有人加类型层断言」。
 *   ⑤ **解析不出 include**（该拦）：判据自己不许静默降级 —— 静默退回「没有 include」
 *      会让本判据空转、照样报 OK（§11.18.3 首版那个 `include: []` 却退 0 的 bug 同族）。
 *   ⑥ **字符串 / 注释里的站点**（该放）：本文件自己就写着夹具字符串，
 *      判据去判自己的夹具是 §11.18.3.1 记过的坑。
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = path.resolve(
  __dirname,
  "../scripts/check-type-assertion-executor.cjs",
);

/** 与仓库同口径的 tsconfig（`**\/*.ts` 覆盖测试文件）。 */
const TS_CONFIG = JSON.stringify(
  {
    compilerOptions: { strict: true, noEmit: true },
    include: ["**/*.ts", "**/*.tsx"],
  },
  null,
  2,
);

/** 在临时仓库里跑真脚本（cwd = 临时仓库根，只放被测文件）。 */
function gate(files: Record<string, string>): { ok: boolean; output: string } {
  const root = mkdtempSync(path.join(tmpdir(), "type-assertion-"));
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  copyFileSync(SCRIPT, path.join(root, "scripts", path.basename(SCRIPT)));
  if (!("tsconfig.json" in files)) writeFileSync(path.join(root, "tsconfig.json"), TS_CONFIG);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  const entry = path.join(root, "scripts", path.basename(SCRIPT));
  try {
    return {
      ok: true,
      output: execFileSync(process.execPath, [entry], {
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

const HEAD = 'import { expectTypeOf, it } from "vitest";\n';
const OK_SITE = `${HEAD}it("x", () => { expectTypeOf<string>().toEqualTypeOf<string>(); });\n`;

describe("类型层断言门禁：该放的形状（§11.20）", () => {
  it("站点在 include 面里 → 通过，并报出站点数", () => {
    const r = gate({ "tests/a.test.ts": OK_SITE });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("1 处类型层断言");
    expect(r.output).toContain("tsc --noEmit");
  });

  it("`.test-d.ts` 站点 → 同样通过（vitest 不收它，tsc 收）", () => {
    const r = gate({ "tests/a.test-d.ts": OK_SITE });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("1 处类型层断言");
  });

  it("零站点 → 通过（纯闸门，不是存量清理）", () => {
    const r = gate({ "tests/a.test.ts": 'import { it } from "vitest";\nit("x", () => {});\n' });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("纯闸门");
  });

  it("站点写在字符串 / 注释里 → 不算站点（判据不去判自己的夹具）", () => {
    const r = gate({
      "tests/a.test.ts": `${HEAD}// expectTypeOf<string>() 在注释里不算站点\nexport const FIXTURE = "expectTypeOf<number>()";\nit("x", () => {});\n`,
    });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("纯闸门");
  });
});

describe("类型层断言门禁：该拦的形状（§11.20）", () => {
  it("站点落到 include 面之外 → 阻断，并点名文件与行号", () => {
    const r = gate({
      // 站点在 tests/ 里，而 include 只覆盖 src/ —— 这正是实测过的那条静默路径
      "tsconfig.json": JSON.stringify({
        compilerOptions: { strict: true, noEmit: true },
        include: ["src/**/*.ts"],
      }),
      "tests/a.test.ts": OK_SITE,
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("tests/a.test.ts:2");
    expect(r.output).toContain("没有执行者");
  });

  it("折行站点（prettier 折开）也要被扫出来 —— 漏掉就是整片静默", () => {
    const r = gate({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { strict: true, noEmit: true },
        include: ["src/**/*.ts"],
      }),
      "tests/a.test.ts": `${HEAD}it("x", () => {
  expectTypeOf(
    someValue(),
  ).toEqualTypeOf<string>();
});
`,
    });
    expect(r.ok).toBe(false);
    // 站点在第 3 行（`expectTypeOf(` 那一行，`toEqualTypeOf` 折在第 5 行）；
    // 只认行内字面量 `expectTypeOf<…>(` 的扫描会整片漏掉它、报「纯闸门」而放行。
    expect(r.output).toContain("tests/a.test.ts:3");
  });

  it("解析不出 include → 判据自己判失败（不许空转照样报 OK）", () => {
    const r = gate({
      "tsconfig.json": "{ this is not json }",
      "tests/a.test.ts": OK_SITE,
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("没能解析出 tsconfig 的 include");
  });

  it("include 是空数组 → 同样是「必然没有执行者」，判失败", () => {
    const r = gate({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { strict: true, noEmit: true },
        include: [],
      }),
      "tests/a.test.ts": OK_SITE,
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("空数组");
  });
});
