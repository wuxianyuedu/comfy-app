/**
 * 判据 ⇄ 执行者的双向判据（ISSUE #1451 要求 2 / 规范 §13.5.12）。
 *
 * 这条门禁的价值全在**三个方向**都成立上，缺一个方向它就成了摆设：
 *   ① 判定型脚本无执行者 ⇒ 红（本次立案现场：`check-comment-language.cjs` 自称
 *      供钩子调用、文档也写着它在报红，而它一个执行者都没有）；
 *   ② 报告型脚本自称「供 pre-commit 调用」⇒ 红（报告档按定义恒 exit(0)，
 *      那句承诺必然是假的 —— 文档说谎而全绿比漏报更难发现）；
 *   ③ 台账双向拦：登记了却其实有执行者 ⇒ 红（台账是负债，不是赦免名单）。
 *
 * 为什么用「临时工作区 + 拷真脚本」而不是在本仓库里造探针：本仓库的任何临时文件
 * 都可能被并行的 C 组 `vitest run` 看见（用例之间共享同一份检出），而这里要为每条
 * 方向各造一次现场。拷进临时区后本仓库零副作用。
 *
 * 规范：docs/standards/13-提交与-code-review.md §13.5.12
 */
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const SCRIPT_NAME = "check-gate-executors.cjs";

/** 判据脚本的识别口径与脚本自身保持一致（前缀族）。 */
const GATE_PREFIXES = [
  "check-",
  "tw4-",
  "report-",
  "render-doc-placeholders",
  "lib-node-only-scan",
];

let workdir = "";

afterEach(() => {
  if (workdir) rmSync(workdir, { recursive: true, force: true });
  workdir = "";
});

/**
 * 搭一个最小工作区：`scripts/` 下放**判据脚本本体 + 台账**，
 * 执行者来源留空（用例按方向各自补）。
 */
function setup(): string {
  workdir = mkdtempSync(join(tmpdir(), "gate-executors-"));
  const srcScripts = join(REPO_ROOT, "scripts");
  const dstScripts = join(workdir, "scripts");
  mkdirSync(dstScripts, { recursive: true });
  for (const entry of readdirSync(srcScripts)) {
    const isGate =
      /\.(cjs|mjs)$/.test(entry) &&
      GATE_PREFIXES.some((p) => entry.startsWith(p));
    if (isGate) {
      copyFileSync(join(srcScripts, entry), join(dstScripts, entry));
    }
  }
  // 台账原样带上（临时区里它就是「当前台账」）。
  copyFileSync(
    join(srcScripts, ".gate-executor-ledger.json"),
    join(dstScripts, ".gate-executor-ledger.json"),
  );
  // 空执行者来源：`.githooks/`、`package.json`、`tests/` 都不建。
  return workdir;
}

function write(rel: string, content: string): void {
  const full = join(workdir, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

function run(args: string[] = []): { code: number; output: string } {
  try {
    const output = execFileSync(
      process.execPath,
      [join(workdir, "scripts", SCRIPT_NAME), ...args],
      { cwd: workdir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { code: 0, output };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return {
      code: e.status ?? -1,
      output: `${e.stdout ?? ""}${e.stderr ?? ""}`,
    };
  }
}

describe("判据执行者台账（ISSUE #1451 要求 2）", () => {
  it("本仓库原样应通过：两条 canonical 棘轮在册为按需召唤", () => {
    // 在真仓库根跑（不建临时区）：这条断言的对象是「本仓库当前的判据-执行者关系」，
    // 而临时区里没有 `.githooks/` / `package.json` / `tests/`，所有靠它们当执行者的
    // 脚本都会被判成无执行者 —— 那是用例环境的问题，不是仓库的问题。
    const output = execFileSync(
      process.execPath,
      [join(REPO_ROOT, "scripts", SCRIPT_NAME)],
      { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    expect(output).toContain("按需召唤 2");
    expect(output).toContain("报告型自称在跑 0");
  });

  it("① 判定型脚本无执行者且未登记 ⇒ 红并点名", () => {
    setup();
    write(
      "scripts/check-probe-orphan.cjs",
      `#!/usr/bin/env node\n// @ts-nocheck -- 探针\nconsole.log("probe");\nprocess.exit(0);\n`,
    );
    const { code, output } = run();
    expect(code, "判定型无执行者必须阻断").toBe(1);
    expect(output).toContain("check-probe-orphan.cjs");
    expect(output).toContain("一个执行者都没有");
  });

  it("② 报告型脚本自称「供 .githooks/pre-commit 调用」 ⇒ 红", () => {
    setup();
    // 0 处 process.exit = 报告型；头部那句承诺按定义是假的。
    write(
      "scripts/check-probe-report.cjs",
      `#!/usr/bin/env node\n// @ts-nocheck -- 探针(供 .githooks/pre-commit 调用)\n/** 报告型探针。 */\nconsole.log("report");\n`,
    );
    const { code, output } = run();
    expect(code, "报告型自称在跑必须阻断").toBe(1);
    expect(output).toContain("check-probe-report.cjs");
    expect(output).toContain("报告型");
  });

  it("③ 台账登记了却其实有执行者 ⇒ 红（台账不是赦免名单）", () => {
    setup();
    // 造一个执行者来源，让 `check-probe-orphan` 真的有执行者，
    // 同时它又在台账里登记着 —— 双向拦的第二个方向。
    write(
      "scripts/check-probe-orphan.cjs",
      `#!/usr/bin/env node\n// @ts-nocheck -- 探针\nconsole.log("probe");\nprocess.exit(0);\n`,
    );
    write(
      "package.json",
      JSON.stringify({
        scripts: { probe: "node scripts/check-probe-orphan.cjs" },
      }),
    );
    // 把它加进台账（读原台账、补一条）。
    write(
      "scripts/.gate-executor-ledger.json",
      JSON.stringify({
        onDemand: {
          "check-probe-orphan.cjs": { why: "探针", who: "探针" },
        },
      }),
    );
    const { code, output } = run();
    expect(code, "有执行者却仍登记必须阻断").toBe(1);
    expect(output).toContain("有执行者");
  });

  it("台账双向误报的锚点：测试只**读**脚本文本不算执行者，真 **spawn** 才算", () => {
    // 判据自身的坑：`tests/tw4-canonical-ratchet.test.ts` 用 readFileSync 读两份
    // canonical 脚本、断言 `--check` 分支还在 —— 若「测试里出现脚本名」就算执行者，
    // 那两个棘轮会被判成「有执行者」，台账双向判定把两条正当的按需召唤登记报成负债。
    // 这里把两种测试各造一份，断言只有**真起子进程**的那份算执行者。
    setup();
    write(
      "scripts/check-probe-a.cjs",
      `#!/usr/bin/env node\n// @ts-nocheck -- 探针\nconsole.log("a");\nprocess.exit(0);\n`,
    );
    write(
      "scripts/check-probe-b.cjs",
      `#!/usr/bin/env node\n// @ts-nocheck -- 探针\nconsole.log("b");\nprocess.exit(0);\n`,
    );
    // 只读文本的测试（不算执行者）
    write(
      "tests/read-only.test.ts",
      `import { readFileSync } from "node:fs";\n` +
        `export const x = readFileSync("scripts/check-probe-a.cjs", "utf8");\n`,
    );
    // 真起子进程的测试（算执行者）
    write(
      "tests/real-spawn.test.ts",
      `import { execFileSync } from "node:child_process";\n` +
        `export const run = () => execFileSync(process.execPath, ["scripts/check-probe-b.cjs"]);\n`,
    );
    const { code, output } = run();
    // a 只有「读文本」的测试 ⇒ 仍是无执行者 ⇒ 红并点名
    expect(code).toBe(1);
    expect(output, "只读文本的测试不算执行者").toContain("check-probe-a.cjs");
    // b 有真 spawn 的测试 ⇒ 有执行者 ⇒ 不点名
    expect(output, "真起子进程的测试算执行者").not.toContain(
      "check-probe-b.cjs",
    );
  });

  it("台账里的孤儿条目（脚本已不存在）⇒ 红", () => {
    setup();
    write(
      "scripts/.gate-executor-ledger.json",
      JSON.stringify({
        onDemand: {
          "check-already-deleted.cjs": { why: "探针", who: "探针" },
        },
      }),
    );
    const { code, output } = run();
    expect(code, "台账条目改名 / 删除后必须摘掉").toBe(1);
    expect(output).toContain("check-already-deleted.cjs");
  });

  it("`--report` 只盘点、不判失败（供排批次用）", () => {
    setup();
    write(
      "scripts/check-probe-orphan.cjs",
      `#!/usr/bin/env node\n// @ts-nocheck -- 探针\nconsole.log("probe");\nprocess.exit(0);\n`,
    );
    const { code, output } = run(["--report"]);
    expect(code, "--report 是盘点档").toBe(0);
    expect(output).toContain("check-probe-orphan.cjs");
  });
});

describe("pre-commit D 组的在位判据（ISSUE #1451 要求 2）", () => {
  const hook = (): string =>
    readFileSync(join(REPO_ROOT, ".githooks", "pre-commit"), "utf8");

  /** D 组步骤 = `  run "<标签>" <命令>`（与同族用例同款解析，不许 toContain）。 */
  const steps = (): { label: string; cmd: string }[] =>
    [...hook().matchAll(/^ {2}run "([^"]+)" (.+)$/gm)].map((m) => ({
      label: m[1] ?? "",
      cmd: m[2] ?? "",
    }));

  it("「判据执行者台账」这一步真在 D 组里（被注掉的行不算在场）", () => {
    expect(
      steps().find((s) => s.cmd.includes("scripts/check-gate-executors.cjs")),
    ).toEqual({
      label: "判据执行者台账",
      cmd: "node scripts/check-gate-executors.cjs",
    });
  });

  it("「TS 重复属性判定」这一步真在 D 组里", () => {
    expect(
      steps().find((s) =>
        s.cmd.includes("scripts/check-ts-duplicate-keys.cjs"),
      ),
    ).toEqual({
      label: "TS 重复属性判定",
      cmd: "node scripts/check-ts-duplicate-keys.cjs",
    });
  });

  it("旧报告档名不再被任何地方引用（改名后没留孤儿）", () => {
    // `report-ts-duplicate-keys.mjs` 已收成判定档 `check-ts-duplicate-keys.cjs`。
    // 旧名残留会让「按文档跑」的人跑一个不存在的文件。
    expect(hook()).not.toContain("report-ts-duplicate-keys");
  });
});

/**
 * 扫描面本身（ISSUE #1444 残活 A）。
 *
 * 这条靶子是**判据自己的覆盖面**：旧口径只看名字前缀，于是四份真在门禁链里跑的
 * 判定型判据（`shell-gate.mjs` / `storybook-check.mjs` / `visual-gate.mjs` /
 * `pixel-run.mjs`）因名字不叫 `check-` 而不在盘点里 —— 判据自报的份数与真值不符。
 * 而「判据的覆盖面与它自称的不符」正是 #1451 的立案现场，所以这里逐份把
 * **门禁链事实**钉住。
 *
 * ⚠️ 这几条**必须在真仓库根跑**：临时区里没有 `.githooks/` / `quality-gate.*`，
 * 链口径恒为空 —— 在那里测这件事等于测「前缀口径还在不在」。
 */
describe("扫描面 = 门禁链事实 ∪ 名字族（ISSUE #1444 残活 A）", () => {
  /** 在**真仓库根**跑判据（不经临时区）。 */
  const runInRepo = (args: string[] = []): string =>
    execFileSync(
      process.execPath,
      [join(REPO_ROOT, "scripts", SCRIPT_NAME), ...args],
      { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );

  /**
   * 门禁链「步骤位置」里出现的 `scripts/<x>` basename（三个来源，与判据同口径）。
   * 只读步骤位置、不读全文 —— 全文会把散文里的 `x.cjs` 占位符也带进来。
   */
  const chainScripts = (): string[] => {
    const out = new Set<string>();
    const collect = (text: string): void => {
      for (const mm of text.matchAll(
        /scripts[\\/]+([A-Za-z0-9_.-]+\.(?:cjs|mjs))/g,
      )) {
        out.add(mm[1] ?? "");
      }
    };
    const read = (rel: string): string =>
      readFileSync(join(REPO_ROOT, rel), "utf8");
    for (const m of read(".githooks/pre-commit").matchAll(
      /^ {2}run "[^"]+" (.+)$/gm,
    )) {
      collect(m[1] ?? "");
    }
    for (const m of read("scripts/quality-gate.mjs").matchAll(
      /args:\s*\[([^\]]*)\]/g,
    )) {
      collect(m[1] ?? "");
    }
    for (const m of read("scripts/quality-gate.ps1").matchAll(
      /Args\s*=\s*@\(([^)]*)\)/g,
    )) {
      collect(m[1] ?? "");
    }
    return [...out];
  };

  it("四份「名字不叫 check- 但在门禁链里跑」的判据确实被数进去了", () => {
    const output = runInRepo(["--report"]);
    // 份数必须 > 纯前缀口径的 40 —— 差额就是「链里认出、前缀认不出」的那几份。
    const total = Number(/判据脚本 (\d+) 份/.exec(output)?.[1] ?? "0");
    expect(total, "扫描面必须含门禁链认出的判据").toBeGreaterThan(40);
    const chain = chainScripts();
    for (const name of [
      "shell-gate.mjs",
      "storybook-check.mjs",
      "visual-gate.mjs",
      "pixel-run.mjs",
    ]) {
      expect(chain, `${name} 应当出现在钩子的门禁步骤位置`).toContain(name);
      // 名字不在「无执行者 / 报告型自称在跑」这两份点名清单里 ⇒ 已被认作判据且执行者在场。
      expect(output.includes(name), `${name} 不该被点名`).toBe(false);
    }
  });

  it("只作散文举例 / 被 import 的脚本不算判据（步骤位置口径）", () => {
    // 只读「门禁步骤位置」而非文件全文的原因：全文匹配会把这些一起打进 ——
    // `x.cjs` / `xxx.cjs`（散文里的占位符举例）、`affected-tests.mjs`（清单库，
    // 被钩子注释提到）、`install-git-hooks.mjs`（postinstall，被注释提到）、
    // `run-affected-tests.mjs`（被 `node scripts/run-affected-tests.mjs` 那行调，
    // 但它是 C 组的测试执行器、不是判据）、`quality-gate-shared.mjs`（被 import）。
    // 实测：把口径退化成全文匹配，份数会明显上涨（那三份被一并认出）。
    // ⚠️ 这里只留定性、不写那个上涨后的数字：它随仓库里散文提到 `scripts/x.mjs` 的
    // 次数漂移，写死就成了下一个人照着它去核的假账（本仓反复吃过这味药）。
    const output = runInRepo(["--report"]);
    const total = Number(/判据脚本 (\d+) 份/.exec(output)?.[1] ?? "0");
    expect(total, "步骤位置口径下判据是 46 份").toBe(46);
    for (const name of [
      "x.cjs",
      "xxx.cjs",
      "affected-tests.mjs",
      "install-git-hooks.mjs",
      "run-affected-tests.mjs",
      "quality-gate-shared.mjs",
    ]) {
      expect(output.includes(name), `${name} 不该被当成判据`).toBe(false);
    }
  });
});
