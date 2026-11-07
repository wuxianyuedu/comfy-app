/**
 * D0 预跑的判据自测（ISSUE #3200）：阶段 0 在 `git commit` 之前把钩子 D0 组的只读形态
 * 判据先跑一遍，所有红一次报齐。防的错法：① 清单抄第二份（钩子加一步预跑不知道）——
 * 所以对**真钩子**钉解析；② 红短路（一次只报一条，N 个形态错付 N 次往返）；
 * ③ 取不到清单冒充结论（半截清单 / 零步读成「全绿」）；④ 预跑动了暂存面
 * （`--add` 那一刻暂存面还没成形，拿它预跑是假绿）。接线层用假执行者跑真阶段 0。
 */
import fs, { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, TestRunner } from "vitest";

import {
  PRE_RUN_SKIP_SCRIPTS,
  decideD0PreRun,
  formatD0PreRunLine,
  parseD0RunLines,
  preRunD0Steps,
  selectPreRunSteps,
} from "../scripts/ship-preflight-d0.mjs";
import { parseArgs } from "../scripts/ship-args.mjs";
import { runPreflightStage } from "../scripts/ship-preflight.mjs";
import { CODE } from "../scripts/ship-core.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

/** 这一条用例这次**真跑了**吗（vitest 5 的 `-t` 不跳未命中用例体，见 ship.test.ts 文件头）。 */
function ranThisCase(): boolean {
  return TestRunner.getCurrentTest()?.result?.state !== "skip";
}

/* 与 `ship-exec.mjs` 的 `ExecResult` 同形（`error` 必需：接缝唯一的形状约束）。 */
type FakeResult = {
  error: string | null;
  status: number;
  stderr: string;
  stdout: string;
};

const ok = (stdout: string): FakeResult => ({ status: 0, stdout, stderr: "", error: null });

/** `check-deps-freshness.mjs --json` 的「一致」读数（阶段 0 读它，见 ISSUE #2390）。 */
const FRESH_OK = JSON.stringify({
  code: 0,
  remoteChecked: true,
  remoteAgeMs: 1000,
  remoteDrifts: [],
  installDrift: null,
  envBroken: false,
});

describe("parseD0RunLines：清单的单一出处是真钩子（漂移钉，ISSUE #3200）", () => {
  const hookText = fs.readFileSync(path.join(ROOT, ".githooks", "pre-commit"), "utf8");

  it("真钩子的 D0 组解析得出闭合区间与步骤，且单子点名的三类判据都在场", () => {
    if (!ranThisCase()) {
      return;
    }
    const { steps, closed } = parseD0RunLines(hookText);
    expect(closed).toBe(true);
    expect(steps.length).toBeGreaterThan(0);
    /* 按命令认，不按标签认（标签是给人读的，会改写）。这三类是 #3200 正文点名的最小面。 */
    const scripts = steps.map((s) => s.argv[1]);
    expect(scripts).toContain("scripts/check-format.cjs");
    expect(scripts).toContain("scripts/check-infra-file-size.cjs");
    expect(scripts).toContain("scripts/check-changelog-fragments.cjs");
    /* 按空白拆的前提：每一步都是 `node scripts/<名> [旗标…]`，没有带引号的参数。 */
    for (const s of steps) {
      expect(s.argv[0]).toBe("node");
      expect(s.argv[1]?.startsWith("scripts/")).toBe(true);
      expect(s.label.length).toBeGreaterThan(0);
    }
  });

  it("依赖新鲜度那一步在钩子清单里、但被预跑跳过（阶段 0 刚跑过同一个判据）", () => {
    if (!ranThisCase()) {
      return;
    }
    const { steps } = parseD0RunLines(hookText);
    const skipped = steps.filter((s) => PRE_RUN_SKIP_SCRIPTS.has(s.argv[1] ?? ""));
    expect(skipped.length).toBeGreaterThan(0);
    const sel = selectPreRunSteps(steps);
    expect(sel.length).toBe(steps.length - skipped.length);
    expect(sel.some((s) => PRE_RUN_SKIP_SCRIPTS.has(s.argv[1] ?? ""))).toBe(false);
  });

  it("只认 run 步骤行：区间里的别的行不进清单，D 组的步骤不被吞进来", () => {
    if (!ranThisCase()) {
      return;
    }
    const text = [
      'run_group D0 "形态前置档" sh -c \'',
      "set -e",
      "# 注释",
      'run "第一步" node scripts/a.cjs --staged',
      'run "第二步" node scripts/b.mjs',
      "'",
      'run_group D "并行档" sh -c \'',
      'run "不算数" node scripts/c.cjs',
      "'",
    ].join("\n");
    const r = parseD0RunLines(text);
    expect(r.closed).toBe(true);
    expect(r.steps.map((s) => s.label)).toEqual(["第一步", "第二步"]);
    expect(r.steps[0]?.argv).toEqual(["node", "scripts/a.cjs", "--staged"]);
    expect(r.steps.some((s) => s.argv[1] === "scripts/c.cjs")).toBe(false);
  });

  it("负控制：没有 D0 组 / 区间不闭合 ⇒ closed=false，半截清单不许当全量", () => {
    if (!ranThisCase()) {
      return;
    }
    expect(
      parseD0RunLines('run_group A "别的组" sh -c \'\nrun "a" node scripts/a.cjs\n\'\n').closed,
    ).toBe(false);
    const unclosed = parseD0RunLines(
      'run_group D0 "形态前置档" sh -c \'\nrun "a" node scripts/a.cjs\n',
    );
    expect(unclosed.closed).toBe(false);
    expect(unclosed.steps.length).toBe(1);
  });

  it("收引号并进命令尾部 ⇒ 区间不闭合（§13.5.8.2.1 那个 sh -n 不拦的坑）", () => {
    if (!ranThisCase()) {
      return;
    }
    const bad = 'run_group D0 "x" sh -c \'\nrun "a" node scripts/a.cjs\'\n';
    expect(parseD0RunLines(bad).closed).toBe(false);
  });
});

describe("selectPreRunSteps / decideD0PreRun：跳过规则是纯函数", () => {
  it("保序：子集的相对顺序与登记顺序一致（读数可对照）", () => {
    if (!ranThisCase()) {
      return;
    }
    const steps = [
      { label: "a", argv: ["node", "scripts/a.cjs"] },
      { label: "跳过", argv: ["node", "scripts/check-deps-freshness.mjs", "--staged"] },
      { label: "b", argv: ["node", "scripts/b.cjs", "--staged"] },
    ];
    expect(selectPreRunSteps(steps).map((s) => s.label)).toEqual(["a", "b"]);
  });

  const base = {
    enabled: true,
    dryRun: false,
    adds: [] as Array<string>,
    stagedCount: 2,
    depsState: "clean",
  };

  it("条件齐 ⇒ 跑", () => {
    if (!ranThisCase()) {
      return;
    }
    expect(decideD0PreRun(base)).toEqual({ run: true, why: null });
  });

  it("旗标关 ⇒ 念出原因", () => {
    if (!ranThisCase()) {
      return;
    }
    const d = decideD0PreRun({ ...base, enabled: false });
    expect(d.run).toBe(false);
    expect(d.why).toContain("--no-preflight-d0");
  });

  it("dry-run ⇒ 结论留给真跑", () => {
    if (!ranThisCase()) {
      return;
    }
    const d = decideD0PreRun({ ...base, dryRun: true });
    expect(d.run).toBe(false);
    expect(d.why).toContain("--dry-run");
  });

  it("带 --add ⇒ 暂存面还没成形，预跑没有对象（拿它预跑是假绿）", () => {
    if (!ranThisCase()) {
      return;
    }
    const d = decideD0PreRun({ ...base, adds: ["src/a.ts"] });
    expect(d.run).toBe(false);
    expect(d.why).toContain("--add");
  });

  it("依赖没就绪 ⇒ 跳过并念判据原值", () => {
    if (!ranThisCase()) {
      return;
    }
    const d = decideD0PreRun({ ...base, depsState: "no-install" });
    expect(d.run).toBe(false);
    expect(d.why).toContain("no-install");
  });

  it("暂存面为空 ⇒ 静默跳过（why=null，合并 / 轮询类重跑不多一行常驻噪声）", () => {
    if (!ranThisCase()) {
      return;
    }
    expect(decideD0PreRun({ ...base, stagedCount: 0 })).toEqual({ run: false, why: null });
  });
});

describe("preRunD0Steps：红不短路，一次报齐；退出码原样带出", () => {
  const steps = [
    { label: "第一步", argv: ["node", "scripts/a.cjs", "--staged"] },
    { label: "第二步", argv: ["node", "scripts/b.cjs"] },
    { label: "第三步", argv: ["node", "scripts/c.cjs"] },
  ];

  function harness(statuses: Array<number>) {
    const calls: Array<string> = [];
    const logs: Array<string> = [];
    const relayed: Array<{ stderr?: string; stdout: string }> = [];
    let i = 0;
    const run = (cmd: string, args: Array<string>): FakeResult => {
      calls.push([cmd, ...args].join(" "));
      const status = statuses[i++] ?? 0;
      return {
        status,
        stdout: `读数自 ${args[0] ?? cmd}`,
        stderr: "",
        error: status < 0 ? "ENOENT" : null,
      };
    };
    let clock = 1000;
    const out = preRunD0Steps({
      steps,
      run,
      relay: (r) => relayed.push(r),
      log: (l) => logs.push(l),
      now: () => (clock += 1500),
    });
    return { calls, logs, relayed, out };
  }

  it("全绿 ⇒ 无失败，命令按原样转发，绿不转发输出", () => {
    if (!ranThisCase()) {
      return;
    }
    const h = harness([0, 0, 0]);
    expect(h.out.failures).toEqual([]);
    expect(h.out.okCount).toBe(3);
    expect(h.calls).toEqual([
      "node scripts/a.cjs --staged",
      "node scripts/b.cjs",
      "node scripts/c.cjs",
    ]);
    expect(h.relayed.length).toBe(0);
    expect(h.out.ms).toBeGreaterThanOrEqual(0);
  });

  it("两处红 ⇒ 都进清单（不短路），各转发判据自己的原话", () => {
    if (!ranThisCase()) {
      return;
    }
    const h = harness([1, 0, 2]);
    expect(h.out.failures.map((f) => [f.label, f.status])).toEqual([
      ["第一步", 1],
      ["第三步", 2],
    ]);
    expect(h.out.okCount).toBe(1);
    expect(h.calls.length).toBe(3);
    expect(h.relayed.length).toBe(2);
    expect(h.logs.join("\n")).toContain("D0 预跑红");
  });

  it("退出码取不到（-1）⇒ 原样记录，不美化成红", () => {
    if (!ranThisCase()) {
      return;
    }
    const h = harness([-1, 0, 0]);
    expect(h.out.failures).toEqual([{ label: "第一步", status: -1 }]);
  });
});

describe("formatD0PreRunLine：读数形状只有这一处", () => {
  it("跳过 / 全绿 / 红 三形", () => {
    if (!ranThisCase()) {
      return;
    }
    expect(formatD0PreRunLine({ failures: 0, total: 0, ms: 0, skippedLine: "旗标关" })).toContain(
      "没跑（旗标关）",
    );
    expect(formatD0PreRunLine({ failures: 0, total: 17, ms: 16_100, skippedLine: null })).toContain(
      "17 步全绿（16.1s）",
    );
    const red = formatD0PreRunLine({ failures: 2, total: 17, ms: 20_000, skippedLine: null });
    expect(red).toContain("2/17 步红");
    expect(red).toContain("提交钩子会拦下的事实");
  });
});

describe("--no-preflight-d0：默认开，只给关的出口", () => {
  it("默认 preflightD0=true", () => {
    if (!ranThisCase()) {
      return;
    }
    expect(parseArgs([]).preflightD0).toBe(true);
  });

  it("点名才关", () => {
    if (!ranThisCase()) {
      return;
    }
    expect(parseArgs(["--no-preflight-d0"]).preflightD0).toBe(false);
  });

  it("拼错 ⇒ unknown，不静默吞（吞了会被读成「没要那个动作」）", () => {
    if (!ranThisCase()) {
      return;
    }
    expect(parseArgs(["--no-preflight-d"]).unknown).toEqual(["--no-preflight-d"]);
  });
});

describe("阶段 0 接线：预跑红 ⇒ 落 1 停手，与提交钩子同权（ISSUE #3200）", () => {
  /* 合成钩子里刻意放着依赖新鲜度那一步：接线必须把它跳过（阶段 0 刚跑过 --json 形态）。 */
  const HOOK = [
    'run_group D0 "形态前置档" sh -c \'',
    'run "格式" node scripts/check-format.cjs --staged',
    'run "新鲜度" node scripts/check-deps-freshness.mjs --staged',
    'run "文件长度" node scripts/check-infra-file-size.cjs --staged',
    "'",
  ].join("\n");

  function wiringIo(opts: {
    fresh?: FakeResult;
    hook?: string | null;
    staged?: string;
    stepStatus?: Record<string, number>;
  }) {
    const rootDir = mkdtempSync(path.join(os.tmpdir(), "ship-d0-"));
    if (opts.hook !== null) {
      mkdirSync(path.join(rootDir, ".githooks"), { recursive: true });
      writeFileSync(path.join(rootDir, ".githooks", "pre-commit"), opts.hook ?? HOOK, "utf8");
    }
    const calls: Array<string> = [];
    const logs: Array<string> = [];
    const relayed: Array<string> = [];
    const run = (cmd: string, args: Array<string>): FakeResult => {
      const key = [cmd, ...args].join(" ");
      calls.push(key);
      const gitKey = args.join(" ");
      if (cmd === "git" && gitKey === "rev-parse --abbrev-ref HEAD") {
        return ok("feat/x\n");
      }
      if (cmd === "git" && gitKey === "rev-parse HEAD") {
        return ok("abc1234\n");
      }
      if (cmd === "git" && gitKey.includes("status --porcelain")) {
        if (args.includes("changelog.d")) {
          return ok("?? changelog.d/3200-x.md\n");
        }
        return ok(opts.staged ?? "A  src/a.ts\n");
      }
      if (cmd === "node" && gitKey.includes("check-deps-freshness")) {
        return opts.fresh ?? ok(FRESH_OK);
      }
      if (cmd === "node" && args[0]?.startsWith("scripts/")) {
        const status = opts.stepStatus?.[args[0]] ?? 0;
        return {
          status,
          stdout: status === 0 ? "" : `${args[0]} 的红读数`,
          stderr: "",
          error: status < 0 ? "ENOENT" : null,
        };
      }
      return ok("");
    };
    return { rootDir, calls, logs, relayed, run };
  }

  async function stage(
    opts: {
      args?: Array<string>;
      fresh?: FakeResult;
      hook?: string | null;
      staged?: string;
      stepStatus?: Record<string, number>;
    } = {},
  ) {
    const io = wiringIo(opts);
    try {
      const res = await runPreflightStage({
        run: io.run,
        log: (l) => io.logs.push(l),
        relay: (r) => io.relayed.push(r.stdout),
        opt: parseArgs(opts.args ?? []),
        root: io.rootDir,
        up: { remote: "origin", base: "master", source: "remote-head" },
        baseRef: "origin/master",
        baseBranch: "master",
        slug: "moon-read/comfy-app-t3",
        cnbOk: true,
        handle: null,
        readInstances: () => Promise.resolve({ running: false }),
        platform: "linux",
      });
      return { res, text: io.logs.join("\n"), calls: io.calls, relayed: io.relayed };
    } finally {
      rmSync(io.rootDir, { recursive: true, force: true });
    }
  }

  it("全绿 ⇒ 照走，命令按原样跑、新鲜度那步不双付，一个写动作都没有", async () => {
    if (!ranThisCase()) {
      return;
    }
    const { res, text, calls } = await stage();
    expect(res.action).toBe("continue");
    expect(res.codes).toContain(CODE.GREEN);
    expect(text).toContain("D0 预跑：2 步全绿");
    expect(calls.filter((c) => c === "node scripts/check-format.cjs --staged").length).toBe(1);
    expect(
      calls.filter((c) => c === "node scripts/check-infra-file-size.cjs --staged").length,
    ).toBe(1);
    expect(calls.some((c) => c.includes("check-deps-freshness.mjs --staged"))).toBe(false);
    expect(calls.some((c) => /git add|git commit|oxfmt|pnpm install/.test(c))).toBe(false);
  });

  it("一处红 ⇒ 落 1 停在阶段 0，转发判据原话，且另一光照跑（不短路）", async () => {
    if (!ranThisCase()) {
      return;
    }
    const { res, text, calls, relayed } = await stage({
      stepStatus: { "scripts/check-format.cjs": 1 },
    });
    expect(res.action).toBe("finish");
    expect(res.codes).toContain(CODE.RED);
    expect(text).toContain("1/2 步红");
    expect(relayed.join("\n")).toContain("scripts/check-format.cjs 的红读数");
    expect(calls).toContain("node scripts/check-infra-file-size.cjs --staged");
  });

  it("两处红 ⇒ 一次报齐（2/2），两条原话都转发", async () => {
    if (!ranThisCase()) {
      return;
    }
    const { res, text, relayed } = await stage({
      stepStatus: { "scripts/check-format.cjs": 1, "scripts/check-infra-file-size.cjs": 1 },
    });
    expect(res.action).toBe("finish");
    expect(res.codes).toContain(CODE.RED);
    expect(text).toContain("2/2 步红");
    expect(relayed.length).toBe(2);
  });

  it("有步骤没跑起来（退出码取不到）⇒ 落「没跑起来」家族，不念成红", async () => {
    if (!ranThisCase()) {
      return;
    }
    const { res } = await stage({ stepStatus: { "scripts/check-format.cjs": -1 } });
    expect(res.action).toBe("finish");
    expect(res.codes).toContain(CODE.NOT_RUN);
    expect(res.codes).not.toContain(CODE.RED);
  });

  it("旗标关 ⇒ 念一句跳过，一步都不跑", async () => {
    if (!ranThisCase()) {
      return;
    }
    const { res, text, calls } = await stage({ args: ["--no-preflight-d0"] });
    expect(res.action).toBe("continue");
    expect(text).toContain("没跑（旗标关");
    expect(calls.some((c) => c.includes("check-format.cjs"))).toBe(false);
  });

  it("带 --add ⇒ 预跑没有对象（暂存面要到提交那一刻才成形）", async () => {
    if (!ranThisCase()) {
      return;
    }
    const { res, text, calls } = await stage({ args: ["--add", "src/a.ts"] });
    expect(res.action).toBe("continue");
    expect(text).toContain("预跑没有对象");
    expect(calls.some((c) => c.includes("check-format.cjs"))).toBe(false);
  });

  it("--dry-run ⇒ 只念计划，预跑一步不跑", async () => {
    if (!ranThisCase()) {
      return;
    }
    const { res, text, calls } = await stage({ args: ["--dry-run"] });
    expect(res.action).toBe("dry-run");
    expect(text).not.toContain("D0 预跑：");
    expect(calls.some((c) => c.includes("check-format.cjs"))).toBe(false);
  });

  it("暂存面为空 ⇒ 静默跳过（提交段本来就跳过，不多一行常驻噪声）", async () => {
    if (!ranThisCase()) {
      return;
    }
    const { res, text, calls } = await stage({ staged: "" });
    expect(res.action).toBe("continue");
    expect(text).not.toContain("D0 预跑：");
    expect(calls.some((c) => c.includes("check-format.cjs"))).toBe(false);
  });

  it("依赖没就绪 ⇒ 跳过并念判据原值，判据一步不起", async () => {
    if (!ranThisCase()) {
      return;
    }
    const { res, text, calls } = await stage({
      fresh: {
        status: 1,
        stdout: JSON.stringify({
          code: 1,
          remoteChecked: true,
          remoteDrifts: [],
          installDrift: { state: "no-install", unresolved: [] },
          envBroken: false,
        }),
        stderr: "",
        error: null,
      },
    });
    expect(res.action).toBe("continue");
    expect(text).toContain("依赖没就绪");
    expect(calls.some((c) => c.includes("check-format.cjs"))).toBe(false);
  });

  it("钩子文件不在 ⇒ 念「取不到」跳过，不冒充结论也不阻断", async () => {
    if (!ranThisCase()) {
      return;
    }
    const { res, text } = await stage({ hook: null });
    expect(res.action).toBe("continue");
    expect(res.codes).not.toContain(CODE.RED);
    expect(text).toContain("取不到");
  });

  it("区间不闭合 / 零步 ⇒ 同样按「取不到」处置，不许念「0 步全绿」", async () => {
    if (!ranThisCase()) {
      return;
    }
    const unclosed = await stage({ hook: HOOK.replace(/\n'\n?$/, "\n") });
    expect(unclosed.res.action).toBe("continue");
    expect(unclosed.text).toContain("取不到");
    const zero = await stage({ hook: "run_group D0 \"x\" sh -c '\nset -e\n'\n" });
    expect(zero.res.action).toBe("continue");
    expect(zero.text).toContain("取不到");
    expect(zero.text).not.toContain("0 步全绿");
  });
});
