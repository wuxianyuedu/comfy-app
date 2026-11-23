/**
 * `check-oxlint-zero-rules.mjs` 的契约测试（ISSUE #3016；台账 #2777）：判「已清零规则集」防回潮闸自身可信。
 * 正控：全仓档跑一遍，41 条规则 0 命中、退 0（并钉住退码只 0/1/2 三态：「没跑起来」退 2）。
 * 负控：仓外临时目录造回潮夹具（`x !== undefined ? x : 兜底`，#3016 判空三元反面），路径档须判红退 1、指回夹具与 `unicorn(no-negated-condition)`；只选语法级规则（路径档不挂 `--type-aware`，夹具无 tsconfig）。
 */
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { needsTypeAware } from "../scripts/gates/check-oxlint-zero-rules.mjs";

const SCRIPT = "scripts/gates/check-oxlint-zero-rules.mjs";

/** 外来值是不是普通对象（数组不算）：本文件收窄 package.json 的入口。 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * package.json 的形状：`scripts` 是「命令名 → 命令行」的表。
 *
 * 逐字段校验过才收窄 —— 断言外来 JSON 一次等于把「读到的形状」与「假定的形状」
 * 混成一句话，而这一条断言的判据恰恰是「package.json 里那条入口脚本还在不在」。
 */
function isPackageJson(value: unknown): value is { scripts: Record<string, string> } {
  if (!isPlainRecord(value)) {
    return false;
  }
  const scripts = value.scripts;
  if (!isPlainRecord(scripts)) {
    return false;
  }
  return Object.values(scripts).every((line) => typeof line === "string");
}

/**
 * 跑一次全仓档，失败（非零退码）时**自动重试最多两次**（间隔 5s），返回末次结果。
 *
 * 为什么重试（ISSUE #3977）：全量单测里本文件与其余用例并发，仓库树在扫描窗口内
 * 会被别的用例写入 / 删除（`gate-scan-read.cjs` 文件头讲的那个窗口），偶发把
 * 「0 命中」的扫描打成非零退码（今天两轮全量各红一次、隔离复跑均绿）。真回潮
 * 三次都在场（连续红，不会因重试变绿）—— 判据本体（末次退 0）不放宽。
 */
function spawnGateWithLoadRetry(): SpawnSyncReturns<string> {
  let last = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
  for (let attempt = 1; last.status !== 0 && attempt < 3; attempt += 1) {
    /* 同步睡 5s：等并发用例的临时夹具离开扫描面（Atomics.wait 在 node 环境可用）。 */
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
    last = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
  }
  return last;
}

describe("已清零 oxlint 规则集闸（#3016）", () => {
  it("正控：全仓档清单内规则 0 命中，退 0", { timeout: 300_000 }, () => {
    /* 负载窗口下最多三次取样，判据只认**末次**（真回潮三次都在场，#3977）。 */
    const r = spawnGateWithLoadRetry();
    // 退 2 = 没跑起来（oxlint 起不来 / 输出不是 JSON / 一份文件都没扫到）：
    // 那时红与绿都不构成结论，所以这里把 stderr 一并带进断言消息，便于归因。
    expect(r.status, `stderr: ${r.stderr ?? ""}`).toBe(0);
    expect(r.stdout).toContain("0 命中");
  });

  it("负控：判空三元否定侧在前（`x !== undefined ? x : 兜底`）必须判红", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "oxlint-zero-rules-"));
    try {
      const fixture = path.join(dir, "fixture.ts");
      writeFileSync(
        fixture,
        'export function pick(x: string | undefined): string {\n  return x !== undefined ? x : "fallback";\n}\n',
        "utf8",
      );
      const r = spawnSync(process.execPath, [SCRIPT, fixture], { encoding: "utf8" });
      expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(1);
      const out = `${r.stdout}${r.stderr}`;
      expect(out).toContain("unicorn(no-negated-condition)");
      expect(out).toContain("fixture.ts");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("负控的对照：肯定侧在前（`x === undefined ? 兜底 : x`，#3016 口径）必须放行", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "oxlint-zero-rules-"));
    try {
      const fixture = path.join(dir, "fixture.ts");
      writeFileSync(
        fixture,
        'export function pick(x: string | undefined): string {\n  return x === undefined ? "fallback" : x;\n}\n',
        "utf8",
      );
      const r = spawnSync(process.execPath, [SCRIPT, fixture], { encoding: "utf8" });
      expect(r.status, `stderr: ${r.stderr}`).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * import / react 族的负控（ISSUE #3340）：这两族的 4 条规则曾因探针配置缺
   * `plugins:` 声明而**静默空转**——「0 命中」里它们是「没扫」而不是「扫过 0」，
   * 而旧负控只挑了生效族（unicorn），空转抓不住自己。这两条夹具钉住「探针真的
   * 在扫这两族」：哪天 plugins 声明又丢了，这里先红。
   */
  it("负控：import 族（重复 import 语句）必须判红 —— import(no-duplicates) 真在扫", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "oxlint-zero-rules-"));
    try {
      const fixture = path.join(dir, "fixture.ts");
      writeFileSync(
        fixture,
        'import { a } from "node:path";\nimport { b } from "node:path";\nexport const both = [a, b];\n',
        "utf8",
      );
      const r = spawnSync(process.execPath, [SCRIPT, fixture], { encoding: "utf8" });
      expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(1);
      const out = `${r.stdout}${r.stderr}`;
      expect(out).toContain("import(no-duplicates)");
      expect(out).toContain("fixture.ts");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("负控：react 族（JSX 布尔属性字面量）必须判红 —— react(jsx-boolean-value) 真在扫", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "oxlint-zero-rules-"));
    try {
      // .jsx：路径档不挂 --type-aware 也没有 tsconfig，JSX 语法按扩展名解析。
      const fixture = path.join(dir, "fixture.jsx");
      writeFileSync(
        fixture,
        "export const Bar = (props) => <div active={true} {...props} />;\n",
        "utf8",
      );
      const r = spawnSync(process.execPath, [SCRIPT, fixture], { encoding: "utf8" });
      expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(1);
      const out = `${r.stdout}${r.stderr}`;
      expect(out).toContain("react(jsx-boolean-value)");
      expect(out).toContain("fixture.jsx");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("用法错：--staged 与显式路径同时给必须退 2，不能静默二选一", () => {
    const r = spawnSync(process.execPath, [SCRIPT, "--staged", "src/example.ts"], {
      encoding: "utf8",
    });
    expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(2);
    expect(`${r.stdout}${r.stderr}`).toContain("互斥");
  });

  // 这一条要真起一次全仓扫描（无参 ≈ 2597 份文件，本机实测 ≈38.5s）才拿到探针生成物，
  // 默认 30s 必超时（ISSUE #3652）：与上面正控那条同档显式预算，断言一字不动。
  it(
    "探针配置声明了清单涉及的全部内建族（plugins 是替换语义，漏一个挤一个）",
    { timeout: 300_000 },
    () => {
      // `plugins:` 行存在 ⇒ 缺省族被这一行**替换**（实测：只写 import/react 时
      // unicorn 从 --rules 的 Enabled 列消失，ISSUE #3340）。声明集合必须是
      // 清单涉及的内建族全集 —— 直接起探针（顺带刷新生成物）后钉**行为**。
      /* 负载窗口下最多三次取样，判据只认**末次**（真回潮三次都在场，#3977）。 */
      const r = spawnGateWithLoadRetry();
      expect(r.status, `stderr: ${r.stderr ?? ""}`).toBe(0);
      const probe = readFileSync("node_modules/.cache/oxlint-zero-rules.config.mjs", "utf8");
      expect(probe).toContain('plugins: ["import", "react", "typescript", "unicorn"]');
      // jsPlugins 的名字不进 plugins 数组（写进去反而 Unknown plugin，实测）。
      expect(probe).not.toContain('"perfectionist"]');
    },
  );
});

/**
 * 判据自己被挂进门槛：三个登记面都在岗 —— pre-commit 的 D 组 `run` 行
 * （`check-gate-executors.cjs` 的文本解析面）、quality-gate 的 GATES 条目、
 * package.json 的独立入口脚本。少任何一面，这扇闸就只剩「文档承诺」。
 */
describe("门槛接线", () => {
  it("pre-commit 同时登记暂存面快检与全仓重档", () => {
    const hook = readFileSync(".githooks/pre-commit", "utf8");
    const zeroRuleLines = hook
      .split("\n")
      .filter((line) => line.includes("node scripts/gates/check-oxlint-zero-rules.mjs"));
    // D0 快检在提交时拦「这次带进来的新文件」；D 组全仓档继续由重档 / 推送前复算执行。
    expect(zeroRuleLines.some((line) => line.includes(" --staged"))).toBe(true);
    expect(zeroRuleLines.some((line) => !line.includes(" --staged"))).toBe(true);
  });

  it("暂存面快检登记进 D0 名单", () => {
    const registry = readFileSync("scripts/base-check/declared-hook-steps.mjs", "utf8");
    expect(registry).toContain('"已清零 oxlint 规则集（暂存面快检）"');
  });

  it("pre-commit D 组有这条 run 行", () => {
    const hook = readFileSync(".githooks/pre-commit", "utf8");
    expect(hook).toContain("node scripts/gates/check-oxlint-zero-rules.mjs");
  });

  it("quality-gate.mjs 的 GATES 登记了这个门禁", () => {
    const gate = readFileSync("scripts/gates/quality-gate.mjs", "utf8");
    expect(gate).toContain("check-oxlint-zero-rules.mjs");
  });

  it("package.json 有独立入口脚本", () => {
    const parsed: unknown = JSON.parse(readFileSync("package.json", "utf8"));
    if (!isPackageJson(parsed)) {
      throw new Error("package.json 的 scripts 段形状不对");
    }
    expect(parsed.scripts["check:oxlint-zero-rules"]).toBe(`node ${SCRIPT}`);
  });

  it("清单里登记着 #3016 这条的源头规则（no-negated-condition）", () => {
    const src = readFileSync(SCRIPT, "utf8");
    expect(src).toContain('"unicorn/no-negated-condition"');
  });
});

/**
 * 档位口径（ISSUE #4884）：`--type-aware` 只在全仓档挂。此前 staged 与全仓共用
 * `paths.length === 0`，而 staged 的 paths 恰好也是空数组 ⇒ 提交时起一轮 TS 程序，
 * 共享机上跑满 300s 预算、把 D0 整档变成「没结论」。类型级规则的覆盖面不丢：
 * D 组全仓档与平台 `ci-heavy-gates.mjs` 都走全仓档、都带类型感知。
 */
describe("类型感知只在全仓档（ISSUE #4884）", () => {
  it("staged 快检不挂 --type-aware；全仓档挂；带路径的契约自测档不挂", () => {
    expect(needsTypeAware(true, [])).toBe(false);
    expect(needsTypeAware(false, [])).toBe(true);
    expect(needsTypeAware(false, ["/tmp/fixture.ts"])).toBe(false);
  });
});
