/**
 * 依赖漏洞扫描门禁的契约测试（ISSUE #1331，规范 §13.5）。
 *
 * 这条门禁的全部价值在**台账形状**上，所以用例都不碰网络：registry 的返回按最小形状
 * 手工构造，判据函数直接喂数据。真跑 `pnpm audit` 的那一路另有两条「形态」用例守着
 * （拿不到 registry 判「未扫描」、输出不是 JSON 判红），都用注入的假 runner 完成 ——
 * 拿真 registry 当测试依赖会让这盏灯随外部世界变红，那就又回到「红不可归因」。
 *
 * 三条判据形状分别对应脚本头里的三条刻意设计：按 `(包名, advisory id)` 记账、
 * 双向拦、每条基线必须有 reason。`--update` 只许降那条是**验收点名要求的**，
 * 所以它跑的是真脚本（子进程 + 临时仓库），不是把逻辑再实现一遍。
 */
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  BLOCKED_SEVERITIES,
  RULE_VERSION,
  advisoryKey,
  collectBlocked,
  diffAgainstBaseline,
  runAudit,
} from "../scripts/check-dependency-audit.mjs";

const SCRIPT = path.resolve(__dirname, "../scripts/check-dependency-audit.mjs");
const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function mkRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "dep-audit-"));
  tempDirs.push(dir);
  mkdirSync(path.join(dir, "scripts", "launcher-core"), { recursive: true });
  // 真脚本 + 它的整条 import 链都得在场。漏了 `launcher-core/shell.mjs` 的话，子进程
  // 在**加载阶段**就 ERR_MODULE_NOT_FOUND，用例读到的是「脚本崩了」而不是判据结论 ——
  // 那种红会长得像业务失败，最难归因（同一坑见 tests/dev-launcher-toolchain-gate.test.ts）。
  copyFileSync(SCRIPT, path.join(dir, "scripts", "check-dependency-audit.mjs"));
  for (const rel of [
    "scripts/launcher-core/shell.mjs",
    "scripts/launcher-core/command-echo.mjs",
  ]) {
    // 必须**按原相对路径**落位：脚本里 import 的是 `./launcher-core/shell.mjs`，
    // 拷成 `scripts/shell.mjs` 会让子进程在加载阶段就 ERR_MODULE_NOT_FOUND ——
    // 那种红长得像业务失败，最难归因。
    copyFileSync(
      path.resolve(__dirname, "..", rel),
      path.join(dir, ...rel.split("/")),
    );
  }
  return dir;
}

/** 构造一条 registry 形状（只留判据真正读的字段）。 */
function advisory(over: Record<string, unknown> = {}) {
  return {
    id: 1000001,
    module_name: "demo-pkg",
    severity: "high",
    vulnerable_versions: ">=1.0.0 <1.0.5",
    patched_versions: ">=1.0.5",
    findings: [
      {
        version: "1.0.1",
        paths: [".>some-tool>demo-pkg", ".>other-tool>mid>demo-pkg"],
      },
    ],
    ...over,
  };
}

/**
 * 台账文件的形状。`JSON.parse` 给的是 `any`，顺着它往下读会一路 `no-unsafe-*`（组 B 是
 * 零警告档）；而且「测试自己认的形状」正是这条判据要钉的东西 —— 键叫什么、reason 是不是
 * 字符串，读成 `any` 就等于用例跟着实现漂。
 */
type LedgerEntry = {
  key: string;
  module?: string;
  advisoryId?: string;
  severity?: string;
  vulnerable?: string;
  patched?: string | null;
  reason?: string;
};
type LedgerFile = { ruleVersion: number; entries: LedgerEntry[] };

const LEDGER_REL = path.join("scripts", ".dependency-audit-baseline.json");

function readLedger(dir: string): LedgerFile {
  const raw: unknown = JSON.parse(
    readFileSync(path.join(dir, LEDGER_REL), "utf8"),
  );
  return raw as LedgerFile;
}

function writeLedger(dir: string, ledger: LedgerFile): void {
  writeFileSync(
    path.join(dir, LEDGER_REL),
    JSON.stringify(ledger, null, 2),
    "utf8",
  );
}

/** 用例里那几处「给台账每条补上原因」的公共动作。 */
function explainAll(dir: string): void {
  const ledger = readLedger(dir);
  for (const entry of ledger.entries) entry.reason = "上游无修复版，待跟进";
  writeLedger(dir, ledger);
}

describe("记账键与筛选（判据读什么）", () => {
  it("键是「包名#advisory id」，不是版本也不是路径", () => {
    expect(advisoryKey(advisory({ id: 42, module_name: "x" }))).toBe("x#42");
  });

  it("只拦 high/critical，moderate/low 不进台账", () => {
    const blocked = collectBlocked({
      advisories: {
        "1": advisory({ id: 1, module_name: "hi", severity: "high" }),
        "2": advisory({ id: 2, module_name: "crit", severity: "critical" }),
        "3": advisory({ id: 3, module_name: "mod", severity: "moderate" }),
        "4": advisory({ id: 4, module_name: "low", severity: "low" }),
        "5": advisory({ id: 5, module_name: "info", severity: "info" }),
      },
    });
    expect(blocked.map((b: { module: string }) => b.module)).toEqual([
      "crit",
      "hi",
    ]);
    expect(BLOCKED_SEVERITIES).toEqual(["high", "critical"]);
  });

  it("引入路径按 registry 的真分隔符切（裸 `>`，首段 `.` 是工作区根）", () => {
    // 按 " > " 切会得到一整段没人看得懂的字符串 —— 这就是第一版在本机跑真
    // `pnpm audit --json` 时打出的形态（`.>better-auth>next`），用例钉住它。
    const blocked = collectBlocked({ advisories: { "1": advisory() } });
    expect(blocked.length).toBe(1);
    expect(blocked[0]?.paths).toEqual([
      "some-tool > demo-pkg",
      "other-tool > mid > demo-pkg",
    ]);
  });

  it("同一条漏洞换了引入路径，键不变（不误报成新增）", () => {
    const a = collectBlocked({ advisories: { "1": advisory() } });
    const b = collectBlocked({
      advisories: {
        "1": advisory({
          findings: [{ version: "1.0.1", paths: [".>changed>demo-pkg"] }],
        }),
      },
    });
    expect(a[0]?.key).toBe(b[0]?.key);
  });
});

describe("与基线对账（三条形状各钉一条）", () => {
  const baseline = {
    ruleVersion: RULE_VERSION,
    entries: [
      { key: "known-pkg#7", severity: "high", reason: "上游无修复版，待跟进" },
      {
        key: "gone-pkg#8",
        severity: "high",
        reason: "已随升级消掉（该 --update 收紧）",
      },
    ],
  };
  const blocked = collectBlocked({
    advisories: {
      "7": advisory({ id: 7, module_name: "known-pkg" }),
      "9": advisory({ id: 9, module_name: "brand-new-pkg" }),
    },
  });
  const diff = diffAgainstBaseline(blocked, baseline);

  it("① 基线外新增 → 进 added（这就是红）", () => {
    expect(diff.added.map((a: { module: string }) => a.module)).toEqual([
      "brand-new-pkg",
    ]);
  });

  it("② 基线里已不再命中 → 进 stale（双向拦，不留失去记账能力的行）", () => {
    expect(diff.stale.map((e: { key: string }) => e.key)).toEqual([
      "gone-pkg#8",
    ]);
  });

  it("③ 命中且在基线里 → known（绿），但没写 reason 的仍被 unexplained 抓住", () => {
    expect(diff.known.map((k: { module: string }) => k.module)).toEqual([
      "known-pkg",
    ]);
    expect(diff.unexplained).toEqual([]);
    const 空原因 = diffAgainstBaseline(
      collectBlocked({
        advisories: { "7": advisory({ id: 7, module_name: "known-pkg" }) },
      }),
      {
        ruleVersion: RULE_VERSION,
        entries: [{ key: "known-pkg#7", reason: "  " }],
      },
    );
    expect(空原因.unexplained.map((e: { key: string }) => e.key)).toEqual([
      "known-pkg#7",
    ]);
  });
});

describe("真脚本：--update 只许降（验收点名要求的形态）", () => {
  /** 用 `--fixture` 把固定的 registry 形状喂给真脚本（理由见脚本里那段注释）。 */
  function runScript(dir: string, args: string[], auditJson?: string) {
    const full = [...args];
    if (auditJson !== undefined) {
      const fixture = path.join(dir, "fixture.json");
      writeFileSync(fixture, auditJson);
      full.push("--fixture", "fixture.json");
    }
    try {
      const out = execFileSync(
        process.execPath,
        [path.join(dir, "scripts", "check-dependency-audit.mjs"), ...full],
        { cwd: dir, env: process.env, encoding: "utf8" },
      );
      return { code: 0, out };
    } catch (error) {
      const e = error as { status?: number; stdout?: string; stderr?: string };
      return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
    }
  }

  const oneHigh = JSON.stringify({
    advisories: {
      "7": advisory({ id: 7, module_name: "known-pkg", findings: [] }),
    },
  });

  it("首次记账把当前命中写进基线；补上 reason 之后就绿", () => {
    const dir = mkRepo();
    const first = runScript(dir, [], oneHigh);
    expect(first.code).toBe(1);
    expect(first.out).toContain("基线文件缺失");

    const created = runScript(dir, ["--update"], oneHigh);
    expect(created.code).toBe(0);
    const written = readLedger(dir);
    expect(written.entries.map((e) => e.key)).toEqual(["known-pkg#7"]);
    // 首次记账的 reason 是空的 —— 这时判据必须仍然红（「登记了没人写为什么」不算收口）。
    expect(runScript(dir, [], oneHigh).code).toBe(1);

    written.entries[0]!.reason = "上游无修复版，待跟进";
    writeLedger(dir, written);
    const green = runScript(dir, [], oneHigh);
    expect(green.code).toBe(0);
    expect(green.out).toContain("无基线外新增");
  });

  it("--update 拒绝把新增写进基线（棘轮的后门必须堵死）", () => {
    const dir = mkRepo();
    runScript(dir, ["--update"], oneHigh);
    explainAll(dir);

    const two = JSON.stringify({
      advisories: {
        "7": advisory({ id: 7, module_name: "known-pkg", findings: [] }),
        "9": advisory({ id: 9, module_name: "brand-new-pkg", findings: [] }),
      },
    });
    const upd = runScript(dir, ["--update"], two);
    expect(upd.code).toBe(1);
    expect(upd.out).toContain("--update 拒绝执行");
    expect(upd.out).toContain("brand-new-pkg#9");
    // 关键：被拒之后基线文件**没被动过**。
    expect(readLedger(dir).entries.length).toBe(1);
  });

  it("修掉一条之后 --update 才收紧；判据对「不再命中」是红的", () => {
    const dir = mkRepo();
    const two = JSON.stringify({
      advisories: {
        "7": advisory({ id: 7, module_name: "known-pkg", findings: [] }),
        "9": advisory({ id: 9, module_name: "brand-new-pkg", findings: [] }),
      },
    });
    runScript(dir, ["--update"], two);
    explainAll(dir);

    // brand-new 修掉了（不再命中）→ 判红并点名，且给出收紧的出路。
    const afterFix = runScript(dir, [], oneHigh);
    expect(afterFix.code).toBe(1);
    expect(afterFix.out).toContain("已经不再命中");
    expect(afterFix.out).toContain("--update");

    const tighten = runScript(dir, ["--update"], oneHigh);
    expect(tighten.code).toBe(0);
    expect(readLedger(dir).entries.length).toBe(1);
  });
});

describe("拿不到 registry 的三种形态（这条判据不许静默变绿）", () => {
  it("stdout 为空（离线 / registry 抖动）→ 判「未扫描」，退 0，但话里不许出现「干净」", () => {
    const r = runAudit({
      runner: () => ({
        ok: false,
        stdout: "",
        stderr: "ERR_PNPM_AUDIT_FAILED  fetch failed",
        status: 1,
        error: null,
        command: "pnpm",
        args: ["audit", "--json"],
      }),
    });
    expect(r.kind).toBe("unreachable");
    // 原因要带出来：只说「跳过」等于把下一次的真红也一起吞掉。
    expect(r.detail).toContain("ERR_PNPM_AUDIT_FAILED");
  });

  it("有 stdout 但不是 JSON → 判 broken（判据自身坏了必须红，不能当离线）", () => {
    const r = runAudit({
      runner: () => ({
        ok: false,
        stdout: "<html>registry 错误页</html>",
        stderr: "",
        status: 1,
        error: null,
        command: "pnpm",
        args: ["audit", "--json"],
      }),
    });
    expect(r.kind).toBe("broken");
    expect(r.detail).toContain("不是 JSON");
  });

  it("pnpm 压根没起来 → 判 broken 并带出 error.code", () => {
    const r = runAudit({
      runner: () => ({
        ok: false,
        stdout: "",
        stderr: "",
        status: null,
        error: Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }),
        command: "pnpm",
        args: ["audit", "--json"],
      }),
    });
    expect(r.kind).toBe("broken");
    expect(r.detail).toContain("ENOENT");
  });
});

describe("接线（两处同步 + 刻意不进 pre-commit）", () => {
  const gate = readFileSync(
    path.resolve(__dirname, "../scripts/quality-gate.mjs"),
    "utf8",
  );
  const ps1 = readFileSync(
    path.resolve(__dirname, "../scripts/quality-gate.ps1"),
    "utf8",
  );
  const hook = readFileSync(
    path.resolve(__dirname, "../.githooks/pre-commit"),
    "utf8",
  );

  it("Node 侧 GATES 与 PowerShell 侧 $Blocks 都登记了同名的这一条", () => {
    expect(gate).toMatch(/dependencyAudit:\s*\{/);
    expect(ps1).toMatch(/Name = "dependencyAudit"/);
    // -Mode 单选值里也要有它，否则 Windows 侧点名单跑这一条会撞 ValidateSet。
    expect(ps1).toMatch(/ValidateSet\([^)]*"dependencyAudit"/);
  });

  it("脚本名两侧一致且真实存在（§9.5 跨平台动作对照表的口径）", () => {
    expect(gate).toContain("check-dependency-audit.mjs");
    expect(ps1).toContain("check-dependency-audit.mjs");
    readFileSync(SCRIPT, "utf8");
  });

  it("它是网络请求，所以刻意不在 pre-commit —— 这条断言防的是「顺手接进去」", () => {
    expect(hook).not.toContain("check-dependency-audit");
  });

  it("`.mjs` 也走 node 直跑那条分支（只认 .cjs 会把新门禁当 pnpm 参数送出去）", () => {
    expect(gate).toMatch(/\.\(\?:c\|m\)\?js\$/);
  });
});
