/**
 * 「翻闸删掉的旗标 ⇄ 还在教人跑它们的散文」门禁自测（规范 §13.5.16）。
 *
 * 本文件自己**不进扫描面**：下面每一条用例的夹具里都写着真的「已翻闸脚本 + 旗标」
 * 组合，判它等于判自己的量具（§11.14.2 的通用口径，同 `tests/click-keyboard-gate.test.ts`）。
 *
 * 判据要钉的三格（文件头是唯一出处，这里只列「少了它会怎样」）：
 *
 *   ① **用法块承诺 ⇄ 实现**：脚本头部注释块里教人跑自己的那一行承诺了 `--update` /
 *      `--strict`，而实现里一个字都读不到它。少了这一格 ⇒ 翻闸删旗标之后，
 *      用法块会一直是「照它跑却没反应」的样子，而**没有任何东西会红**
 *      （`--report` 一路绿灯，读的人只会以为「这个旗标大概没用」）。
 *   ② **棘轮归类表的陈词 ⇄ 事实**：表里点名一个脚本 = 断言「它仍带 `--update`」。
 *      少了这一格 ⇒ 口径改了、表没跟着改，而表本身是**别人读它时的唯一线索**。
 *   ③ **命令清单 / 红话里的旧旗标**：`node scripts/<已翻闸脚本> --update` 出现在
 *      钩子、规范门禁清单、或**用户可见的阻断输出**里。少了这一格 ⇒ #1845 那处
 *      「红话叫人跑一条自己会拒绝他的命令」原样复发，而那正是立案现场。
 *   ④ **翻闸台账点名的脚本必须有执行者**（门禁链**或**按需召唤台账至少占一条）。
 *      少了这一格 ⇒ 「已翻硬闸」这句话只兑现了一半：翻闸的语义是「命中即退 1」，
 *      而**退 1 要有人跑**才发生 —— 把一条判据从棘轮翻成硬闸却不给它落点，
 *      得到的是「账面写着硬闸、实际连棘轮都不如」（棘轮至少有钩子里的那一步）。
 *
 * 每格都**双向**验：该红的红（正面），当前真仓库绿（对照组）—— 只验正面的话，
 * 判据把**全仓**判红也是「红」。
 */
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SCRIPT = join(ROOT, "scripts", "check-gate-flag-claims.cjs");

/**
 * 在临时工作区里搭一个**最小但自洽**的仓库：一份判据脚本 + 一份归类表 +
 * 两张命令清单。判据从 `process.cwd()` 找全部输入，所以工作区必须自带这些。
 *
 * 为什么不走 `defineGateRepo`：那份夹具按「一个文件绑一个脚本、脚本从
 * `__dirname` 定扫描根」的形态收口，而本判据的输入面是**多份文件的组合**
 * （脚本目录 + 归类表 + 两张清单），且它按 `cwd` 解析。硬套会得到
 * 「脚本被拷到 `scripts/` 下、而归类表不在」，看起来像判据坏了。
 */
function makeWorkspace(): { dir: string; dispose: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "gate-flag-claims-"));
  for (const sub of ["scripts", "tests", "docs/standards", ".githooks"]) {
    mkdirSync(join(dir, sub), { recursive: true });
  }
  copyFileSync(SCRIPT, join(dir, "scripts", "check-gate-flag-claims.cjs"));
  /* 归类表：判据按 `const <表名>` + `\n};` 切块，所以夹具要写足那个形状。 */
  writeFileSync(join(dir, "tests", "ratchet-update-guards.test.ts"), "");
  writeFileSync(join(dir, ".githooks", "pre-commit"), "");
  writeFileSync(join(dir, "docs", "standards", "13-提交与-code-review.md"), "");
  return {
    dir,
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** 跑一次判据。`cwd` 指向工作区 —— 判据全部输入按 `process.cwd()` 解析。 */
function run(dir: string, args: string[] = []): { code: number; output: string } {
  const r = spawnSync(
    process.execPath,
    [join(dir, "scripts", "check-gate-flag-claims.cjs"), ...args],
    { cwd: dir, encoding: "utf8" },
  );
  return { code: r.status ?? 1, output: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/** 写一份判据脚本夹具：头部用法块 + 实现体。 */
function writeScript(
  dir: string,
  name: string,
  usageBlock: string,
  body = "const ARGS = new Set(process.argv.slice(2));\n",
): void {
  writeFileSync(
    join(dir, "scripts", name),
    `#!/usr/bin/env node\n// @ts-nocheck -- 夹具\n/**\n${usageBlock} */\n${body}`,
  );
}

/** 写归类表夹具。 */
function writeTables(
  dir: string,
  { covered = "", retired = "", flips = "" }: { covered?: string; retired?: string; flips?: string },
): void {
  writeFileSync(
    join(dir, "tests", "ratchet-update-guards.test.ts"),
    `const COVERED_LOCALLY: Record<string, string> = {\n${covered}\n};\n` +
      `const RETIRED_RATCHETS: Record<string, string> = {\n${retired}\n};\n` +
      `const NOT_A_RATCHET: Record<string, string> = {};\n` +
      `const RATCHETS: Ratchet[] = [\n];\n` +
      `const HARD_GATE_FLIPS: Record<string, string> = {\n${flips}\n};\n`,
  );
}

describe("翻闸旗标 ⇄ 散文（§13.5.16）", () => {
  it("① 用法块承诺了实现里没有的旗标 → 红，并点名是哪个旗标", () => {
    const ws = makeWorkspace();
    try {
      writeScript(
        ws.dir,
        "check-fake.cjs",
        " * 用法：\n *   node scripts/check-fake.cjs --update  # 收紧基线",
      );
      writeTables(ws.dir, {});
      const { code, output } = run(ws.dir);
      expect(code).toBe(1);
      expect(output).toContain("check-fake.cjs");
      expect(output).toContain("--update");
    } finally {
      ws.dispose();
    }
  });

  it("① 实现里读得到那个旗标 → 绿（对照组：判据不会把正当形态一起判）", () => {
    const ws = makeWorkspace();
    try {
      writeScript(
        ws.dir,
        "check-fake.cjs",
        " * 用法：\n *   node scripts/check-fake.cjs --update  # 收紧基线",
        'const UPDATE = new Set(process.argv).has("--update");\n',
      );
      writeTables(ws.dir, {});
      const { code, output } = run(ws.dir);
      expect(code, output).toBe(0);
    } finally {
      ws.dispose();
    }
  });

  it("① `argv.indexOf('--update')` 这种读法也算「实现里有」", () => {
    const ws = makeWorkspace();
    try {
      writeScript(
        ws.dir,
        "check-fake.cjs",
        " * 用法：\n *   node scripts/check-fake.cjs --update",
        'const i = process.argv.indexOf("--update");\n',
      );
      writeTables(ws.dir, {});
      expect(run(ws.dir).code).toBe(0);
    } finally {
      ws.dispose();
    }
  });

  it("② 归类表断言它带 --update、而实现里没有 → 红", () => {
    const ws = makeWorkspace();
    try {
      /* 脚本自己在场、**真把 `.fake-baseline.json` 写回去**，但实现里不带 `--update`。 */
      writeScript(
        ws.dir,
        "check-fake.cjs",
        " * 用法：\n *   node scripts/check-fake.cjs",
        'const B = path.join(__dirname, ".fake-baseline.json");\n' +
          'fs.writeFileSync(B, "{}");\n',
      );
      /* 表里点名的是**基线名**（键），脚本名由「谁把它写回去」现算 —— 与真表的形状一致。 */
      writeTables(ws.dir, {
        covered: '  ".fake-baseline.json": "tests/check-fake.test.ts",',
      });
      const { code, output } = run(ws.dir);
      expect(code).toBe(1);
      expect(output).toContain("棘轮归类表断言它带 --update");
    } finally {
      ws.dispose();
    }
  });

  it("② 表里点名一份没有任何脚本写回去的基线 → 红（归属已不存在）", () => {
    const ws = makeWorkspace();
    try {
      /* 没有任何脚本落盘 `.ghost-baseline.json`，而表里有它这一行。 */
      writeTables(ws.dir, { covered: '  ".ghost-baseline.json": "tests/x.test.ts",' });
      const { code, output } = run(ws.dir);
      expect(code).toBe(1);
      expect(output).toContain(".ghost-baseline.json");
    } finally {
      ws.dispose();
    }
  });

  it("③ 命令清单里叫人跑已翻闸脚本的 --update → 红", () => {
    const ws = makeWorkspace();
    try {
      /* 翻闸台账点名 check-fake.cjs；命令清单里还叫人跑它。 */
      writeScript(ws.dir, "check-fake.cjs", " * 用法：\n *   node scripts/check-fake.cjs");
      writeTables(ws.dir, { flips: '  "check-fake.cjs": "tests/check-fake.test.ts",' });
      writeFileSync(
        join(ws.dir, ".githooks", "pre-commit"),
        '  run "x" node scripts/check-fake.cjs --update\n',
      );
      const { code, output } = run(ws.dir);
      expect(code).toBe(1);
      expect(output).toContain("命令清单");
      expect(output).toContain("check-fake.cjs");
    } finally {
      ws.dispose();
    }
  });

  it("③ 红话话术（字符串字面量）里叫人跑已翻闸脚本的旧旗标 → 红（#1845 的现场）", () => {
    const ws = makeWorkspace();
    try {
      writeScript(ws.dir, "check-other.cjs", " * 用法：\n *   node scripts/check-other.cjs");
      writeScript(
        ws.dir,
        "check-fake.cjs",
        " * 用法：\n *   node scripts/check-fake.cjs",
        'console.error("\\n  存量清掉后记得 node scripts/check-fake.cjs --update 收紧基线。");\n',
      );
      writeTables(ws.dir, { flips: '  "check-fake.cjs": "tests/check-fake.test.ts",' });
      const { code, output } = run(ws.dir);
      expect(code).toBe(1);
      expect(output).toContain("check-fake.cjs");
    } finally {
      ws.dispose();
    }
  });

  it("③ 如实记述沿革的行不算（「已删 / 原本还有 / 同族先例」）", () => {
    const ws = makeWorkspace();
    try {
      writeScript(ws.dir, "check-fake.cjs", " * 用法：\n *   node scripts/check-fake.cjs");
      writeTables(ws.dir, { flips: '  "check-fake.cjs": "tests/check-fake.test.ts",' });
      /* ④ 那一格要求翻闸台账点名的脚本有落点；这条用例判的是 ③ 的豁免，
       * 所以夹具必须把 ④ 喂绿 —— 否则它红的原因与 ③ 无关（判据是复合的，
       * 夹具就要把无关的那几格都配平，同 `ratchet-update-guards` 的「第 ② 步
       * 先配出基线=现状」那条口径）。 */
      writeFileSync(
        join(ws.dir, "scripts", ".gate-executor-ledger.json"),
        JSON.stringify({ onDemand: {} }),
      );
      writeFileSync(
        join(ws.dir, ".githooks", "pre-commit"),
        '  run "x" node scripts/check-fake.cjs\n  # 同族先例：`check-fake.cjs` 的 `--update`。\n',
      );
      writeFileSync(
        join(ws.dir, "docs", "standards", "13-提交与-code-review.md"),
        "本判据**已删** `--update`（`node scripts/check-fake.cjs --update` 不再存在）。\n",
      );
      const { code, output } = run(ws.dir);
      expect(code, output).toBe(0);
    } finally {
      ws.dispose();
    }
  });

  it("④ 翻闸台账点名了它、而它没有任何落点 → 红（「命中即退 1」要有人跑）", () => {
    const ws = makeWorkspace();
    try {
      writeScript(ws.dir, "check-fake.cjs", " * 用法：\n *   node scripts/check-fake.cjs");
      writeTables(ws.dir, { flips: '  "check-fake.cjs": "tests/check-fake.test.ts",' });
      /* 门禁链三处 + 聚合档都没有它、按需台账也没登记 ⇒ 谁都不会跑它。 */
      writeFileSync(
        join(ws.dir, "scripts", ".gate-executor-ledger.json"),
        JSON.stringify({ onDemand: {} }),
      );
      const { code, output } = run(ws.dir);
      expect(code).toBe(1);
      expect(output).toContain("一条落点都没有");
      expect(output).toContain("check-fake.cjs");
    } finally {
      ws.dispose();
    }
  });

  it("④ 落点是一条正当落点时 → 绿（钩子步骤行 / 聚合档表项 / 按需台账各试一格）", () => {
    /* 三个落点各建一次工作区：只验一个的话，另外两个形态的解析坏了不会有反应 ——
     * 而误报（把真有落点的判成没有）正是这一格最容易出的错（实测撞过一次：
     * 经 `run-ast-gates.cjs` 聚合档真在跑的两条被误报）。 */
    const cases: Array<[string, (dir: string) => void]> = [
      [
        "钩子步骤行",
        (dir) =>
          writeFileSync(
            join(dir, ".githooks", "pre-commit"),
            '  run "x" node scripts/check-fake.cjs\n',
          ),
      ],
      [
        "聚合档表项（裸 script: 形态，无 scripts/ 前缀）",
        (dir) =>
          writeFileSync(
            join(dir, "scripts", "run-ast-gates.cjs"),
            'const GATES = [\n  { script: "check-fake.cjs", tag: "[x]" },\n];\n',
          ),
      ],
      [
        "按需召唤台账",
        (dir) =>
          writeFileSync(
            join(dir, "scripts", ".gate-executor-ledger.json"),
            JSON.stringify({ onDemand: { "check-fake.cjs": { why: "w", who: "h" } } }),
          ),
      ],
    ];
    for (const [label, place] of cases) {
      const ws = makeWorkspace();
      try {
        writeScript(ws.dir, "check-fake.cjs", " * 用法：\n *   node scripts/check-fake.cjs");
        writeTables(ws.dir, { flips: '  "check-fake.cjs": "tests/check-fake.test.ts",' });
        place(ws.dir);
        const { code, output } = run(ws.dir);
        expect(code, `${label}：${output}`).toBe(0);
      } finally {
        ws.dispose();
      }
    }
  });

  it("④ 落点那两条**都要现读**（把假落点写死进判据就会被抓）", () => {
    /* 这一格防的是「判据把落点抄成第二份清单」：门禁链与台账都从磁盘现读，
     * 所以在临时工作区里**只写落点、不写别的**就能让它在场。反过来，如果判据
     * 是拿真仓库的清单硬编的，这个干净工作区会照绿 —— 那它判的就不是当前仓库。
     * 这里显式钉「干净工作区 + 一条落点 = 绿」（上面那三条已经覆盖），
     * 以及「干净工作区 + 零落点 = 红」（上一条）—— 两侧都成立才说明它是现读的。 */
    const ws = makeWorkspace();
    try {
      writeScript(ws.dir, "check-fake.cjs", " * 用法：\n *   node scripts/check-fake.cjs");
      writeTables(ws.dir, { flips: '  "check-fake.cjs": "tests/check-fake.test.ts",' });
      writeFileSync(
        join(ws.dir, "scripts", ".gate-executor-ledger.json"),
        JSON.stringify({ onDemand: {} }),
      );
      expect(run(ws.dir).code).toBe(1);
    } finally {
      ws.dispose();
    }
  });

  it("--report 只出清单、不判失败（清零后的自证档）", () => {
    const ws = makeWorkspace();
    try {
      writeScript(
        ws.dir,
        "check-fake.cjs",
        " * 用法：\n *   node scripts/check-fake.cjs --update",
      );
      writeTables(ws.dir, {});
      const { code, output } = run(ws.dir, ["--report"]);
      expect(code).toBe(0);
      expect(output).toContain("命中 1 处");
    } finally {
      ws.dispose();
    }
  });

  it("对照组：当前真仓库是绿的，且扫描面非空（判据没退化成空转）", () => {
    const { code, output } = run(ROOT);
    expect(code, output).toBe(0);
    /* 扫描面非空：一份脚本都没扫到时本判据恒绿 —— 那正是它要防的形态。 */
    expect(output).toMatch(/\d+ 份脚本/);
    expect(output).toMatch(/\d+ 条翻闸台账/);
    const m = /(\d+) 份脚本/.exec(output);
    expect(Number(m?.[1] ?? 0)).toBeGreaterThan(50);
    const f = /(\d+) 条翻闸台账/.exec(output);
    expect(Number(f?.[1] ?? 0)).toBeGreaterThan(5);
    /* ④ 那一格的读数：真仓库里落点缺失必须是 0 —— 它出现非零就是判据在报真问题，
     * 而这条断言让「有人把两条 tw4 从按需台账里摘掉」在**这里**也能看见。 */
    const miss = /落点缺失 (\d+)/.exec(output);
    expect(miss, "输出里必须有「落点缺失」这个读数").not.toBeNull();
    expect(Number(miss?.[1] ?? -1)).toBe(0);
  });

  it("判据自己的文件头不被自适应（它必然要点名脚本与旗标）", () => {
    /* 真仓库绿已经隐含这一条（本判据点名的活都在册），这里显式钉住
     * 「那份自豁免是有对象、也确实被豁免了」—— 而不是「全仓恰好没有这种行」。 */
    const src = readFileSync(SCRIPT, "utf8");
    expect(src).toContain("check-gate-flag-claims.cjs");
    expect(src).toContain("check-format.cjs");
    expect(run(ROOT).code).toBe(0);
  });
});
