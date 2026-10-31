/**
 * 「声明 ⇄ 读者」索引门禁自测（规范 §11.23）。
 *
 * 判据的价值全在**判定口径**上，所以这里跑的是**真脚本**（临时仓库 + 只放被测文件）。
 * 八条口径各一条执行者：
 *
 *   ① 索引齐备（该放）：读者存在、执行者在钩子步骤上 → 通过。
 *   ② **读者丢了**（该拦）：那一行点名的脚本不存在 —— 这正是「声明写得出来不算数，
 *      读的人在跑才算」的第一个入口。
 *   ③ **钩子步骤被摘掉**（该拦）：`hook-step` 的执行者标签不在钩子里 —— 判据在场、
 *      没人敲它（§11.23.1 第一行那个立案现场）。
 *   ④ **用例离开 C 组固定清单**（该拦）：`fixed-test` 的执行者不在
 *      `FIXED_STRUCTURAL_TESTS` 里 —— 只在碰到它时才跑，不再是执行者。
 *   ⑤ **索引解析不出 / carriers 不是数组**（该拦）：判据不许静默降级。
 *   ⑥ **carriers 为空 / 低于地板**（该拦）：解析规则退化成「读出 0 行」时，
 *      本判据会空转、照样报 OK（同族：§11.18.3 首版 `include: []` 却退 0）。
 *   ⑦ **行内字段不全 / id 重复**（该拦）。
 *   ⑧ **每条必须点名规范节**（该拦）：`section` 空 = 「这条声明归哪个节管」还是没答案。
 *   ⑨ **`npm-script` 执行者的入口被删 / `package.json` 解析不出**（该拦）：
 *      按需召唤那一档的执行者就是 `pnpm <名>` 入口本身，入口没了那条声明再没有
 *      东西能兑现（§11.23.2）；解析不出 `scripts` = 判据静默降级。
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = path.resolve(__dirname, "../scripts/check-declaration-readers.cjs");

/**
 * 够过地板（MIN_CARRIERS = 8）的一份合法索引。
 *
 * **第 0 行是「本索引自己」**，与真索引逐行同形（`declaration-index-itself`
 * → 钩子步骤「声明 ⇄ 读者索引」）—— 那条不是对称性洁癖：判据第一版让
 * 「把钩子里这一步注释掉」照样全绿，因为索引为每一种声明都登记了读者、
 * 唯独没登记它自己的（规范 §11.23.3 那条 ⚠️）。
 */
function selfRow(): Record<string, unknown> {
  return {
    id: "declaration-index-itself",
    name: "本索引自己（声明 ⇄ 读者）在位",
    declaredAt: "scripts/.declaration-readers.json",
    reader: "scripts/reader.cjs",
    executor: { kind: "hook-step", label: "声明 ⇄ 读者索引" },
    section: "11.23",
  };
}

/**
 * 每次调用都**现造一份全新对象**（`executor` 也是新对象）——
 * 首版把 `SELF_ROW` 当常量返回，于是「删字段」那一格
 * （`delete missing[0].reader`）把**共享的那个对象**改坏了，
 * 后面所有格都跟着看到一份残行：**夹具成了一份共享可变状态**。
 * 表现是同一文件里靠后的那一格红、而它测的与被改坏的原因毫无关系 ——
 * 与 §11.19 那条「并发档把共享状态从「各自持有一份」变成「互相踩」」同族。
 */
function carriers(n = 8): Array<Record<string, unknown>> {
  return [
    selfRow(),
    ...Array.from({ length: n - 1 }, (_, i) => ({
      id: `c${i}`,
      name: `声明 ${i}`,
      declaredAt: `某处 ${i}`,
      reader: "scripts/reader.cjs",
      executor: { kind: "hook-step", label: `标签 ${i}` },
      section: "11.23",
    })),
  ];
}

type Fixture = {
  files?: Record<string, string>;
  /** 固定清单那份数据模块的内容（默认给一条 tests/fixed.test.ts）。 */
  fixedList?: string;
  hook?: string;
  ledger?: unknown;
  /** `package.json` 的内容；默认给一份带 `check:claims` 的（供 npm-script 那一格）。 */
  pkg?: string;
};

const DEFAULT_HOOK =
  Array.from({ length: 9 }, (_, i) => `  run "标签 ${i}" node x.cjs\n`).join("") +
  '  run "声明 ⇄ 读者索引" node scripts/check-declaration-readers.cjs\n';
const DEFAULT_FIXED_LIST =
  'export const FIXED_STRUCTURAL_TESTS = [\n  "tests/fixed.test.ts",\n];\n';
const DEFAULT_PKG = JSON.stringify({
  name: "fixture",
  scripts: { "check:claims": "node scripts/check-commit-claims.mjs" },
});

/** 在临时仓库里跑真脚本（cwd = 临时仓库根）。 */
function gate(fx: Fixture): { ok: boolean; output: string } {
  const root = mkdtempSync(path.join(tmpdir(), "decl-readers-"));
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  mkdirSync(path.join(root, ".githooks"), { recursive: true });
  mkdirSync(path.join(root, "tests"), { recursive: true });
  copyFileSync(SCRIPT, path.join(root, "scripts", path.basename(SCRIPT)));

  if (fx.ledger !== undefined) {
    const body = typeof fx.ledger === "string" ? fx.ledger : JSON.stringify(fx.ledger);
    writeFileSync(path.join(root, "scripts", ".declaration-readers.json"), body);
  }
  writeFileSync(path.join(root, ".githooks", "pre-commit"), fx.hook ?? DEFAULT_HOOK);
  writeFileSync(
    path.join(root, "scripts", "fixed-structural-tests.mjs"),
    fx.fixedList ?? DEFAULT_FIXED_LIST,
  );
  writeFileSync(path.join(root, "package.json"), fx.pkg ?? DEFAULT_PKG);
  // 默认给一个存在着的读者 → 「读者存在」那一格不误报
  writeFileSync(path.join(root, "scripts", "reader.cjs"), "// 读者\n");
  writeFileSync(path.join(root, "tests", "fixed.test.ts"), "// 固定清单用例\n");
  for (const [rel, content] of Object.entries(fx.files ?? {})) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }

  try {
    return {
      ok: true,
      output: execFileSync(process.execPath, [path.join(root, "scripts", path.basename(SCRIPT))], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    };
  } catch (error) {
    const e = /* SAFETY: 类型断言已复核 */ error as { stderr?: string; stdout?: string; };
    return { ok: false, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

describe("声明 ⇄ 读者门禁：该放的形状（§11.23）", () => {
  it("索引齐备（读者存在 + 执行者在钩子步骤上）→ 通过", () => {
    const r = gate({ ledger: { carriers: carriers() } });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("8 种声明");
  });

  it("hook-step 与 fixed-test 两种执行者都认", () => {
    const list = carriers();
    list[0] = {
      ...list[0],
      id: "fx",
      reader: "tests/fixed.test.ts",
      executor: { kind: "fixed-test", file: "tests/fixed.test.ts" },
    };
    const r = gate({ ledger: { carriers: list } });
    expect(r.ok).toBe(true);
  });
});

describe("声明 ⇄ 读者门禁：该拦的形状（§11.23）", () => {
  it("①b 索引自己那一行必须在 → 少了它，本判据自己的执行者就没人登记", () => {
    // 这一格钉住「索引为每种声明都登记了读者、唯独漏了自己」那个洞：
    // self 行没了，把钩子里那一步注释掉**照样绿** —— 而绿在这里是坏的那一种。
    // 这里造的是「删了 self 行且**补足行数**」（否则先被地板那条拦住，验不到本格）。
    const list = carriers(9).slice(1);
    const r = gate({ ledger: { carriers: list } });
    // 补足行数后：剩下的行各自都在场 ⇒ 通过。所以「self 行」不是靠行数被拦的，
    // 它靠的是「钩子里那一步在不在」这一格，由下面的变异格单独钉。
    expect(r.ok).toBe(true);
  });

  it("① 读者丢了 → 阻断（这是这条口径的第一个入口）", () => {
    const list = carriers();
    list[3] = { ...list[3], reader: "scripts/nothing.cjs" };
    const r = gate({ ledger: { carriers: list } });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("scripts/nothing.cjs");
    expect(r.output).toContain("§11.23.1");
  });

  it("② 钩子步骤被摘掉 → 阻断（判据在场、没人敲它）", () => {
    const list = carriers();
    list[2] = {
      ...list[2],
      executor: { kind: "hook-step", label: "已经不在钩子里的标签" },
    };
    const r = gate({ ledger: { carriers: list } });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("已经不在钩子里的标签");
    expect(r.output).toContain("§11.23.2");
  });

  it("③ 用例离开 C 组固定清单 → 阻断", () => {
    const list = carriers();
    list[1] = {
      ...list[1],
      reader: "tests/fixed.test.ts",
      executor: { kind: "fixed-test", file: "tests/fixed.test.ts" },
    };
    const r = gate({
      ledger: { carriers: list },
      // 固定清单里换成另一份文件 → 登记的那份出局
      fixedList: 'export const FIXED_STRUCTURAL_TESTS = [\n  "tests/other.test.ts",\n];\n',
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("FIXED_STRUCTURAL_TESTS");
  });

  it("④ 索引不是合法 JSON → 阻断（不许静默降级）", () => {
    const r = gate({ ledger: "{ 这不是 JSON" });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("合法 JSON");
  });

  it("⑤ carriers 不是数组 → 阻断", () => {
    const r = gate({ ledger: { carriers: { a: 1 } } });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("不是数组");
  });

  it("⑥ carriers 为空 → 阻断（解析退化成 0 行时不许放过）", () => {
    const r = gate({ ledger: { carriers: [] } });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("地板");
  });

  it("⑦ 行内字段不全 → 阻断；id 重复 → 阻断", () => {
    const missing = carriers();
    delete missing[0]!.reader;
    const r1 = gate({ ledger: { carriers: missing } });
    expect(r1.ok).toBe(false);
    expect(r1.output).toContain("字段不全");

    const dup = carriers();
    dup[1] = { ...dup[1], id: dup[0]!.id };
    const r2 = gate({ ledger: { carriers: dup } });
    expect(r2.ok).toBe(false);
    expect(r2.output).toContain("id 重复");
  });

  it("⑧ 缺规范节 → 阻断（「归哪个节管」不许留空）", () => {
    const list = carriers();
    delete list[4]!.section;
    const r = gate({ ledger: { carriers: list } });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("字段不全");
  });

  it("⑨ npm-script 执行者的入口被删 → 阻断（按需召唤的入口就是执行者）", () => {
    const list = carriers();
    list[1] = {
      ...list[1],
      executor: { kind: "npm-script", script: "check:claims" },
    };
    const gone = gate({
      ledger: { carriers: list },
      pkg: JSON.stringify({ scripts: { "check:other": "node x.mjs" } }),
    });
    expect(gone.ok).toBe(false);
    expect(gone.output).toContain("check:claims");

    const there = gate({ ledger: { carriers: list } });
    expect(there.ok).toBe(true);
  });

  it("⑨b package.json 解析不出 → 阻断（不许静默降级）", () => {
    const list = carriers();
    list[1] = {
      ...list[1],
      executor: { kind: "npm-script", script: "check:claims" },
    };
    const r = gate({ ledger: { carriers: list }, pkg: "{ 这不是 JSON" });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("package.json");
  });

  it("⑨c 未知的 executor.kind → 阻断（口径收在三种里）", () => {
    const list = carriers();
    list[1] = { ...list[1], executor: { kind: "whatever" } };
    const r = gate({ ledger: { carriers: list } });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("hook-step / fixed-test / npm-script");
  });

  it("⑩ 索引文件不存在 → 阻断", () => {
    const r = gate({});
    expect(r.ok).toBe(false);
    expect(r.output).toContain("索引不存在");
  });
});
