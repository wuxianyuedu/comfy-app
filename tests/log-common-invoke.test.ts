/**
 * `tools/scripts/Log-Common.ps1` 的 `Invoke-Logged()`（ISSUE #1350）：三个双击发布入口的唯一判决来源（`build-standalone.ps1:57`
 * / `build-tauri-release.ps1:127` / `rebuild-static.ps1:26`），此前零执行者（ParserError sweep 只证语法过）。抓的假绿：`&` 起不来
 * 时 PowerShell 不写 `$LASTEXITCODE`，读回上次成功的 0 ⇒ 跳过中止、打印「全部完成」而 exe 不存在；两宿主都跑（默认 5.1），日志用临时目录。
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const LOG_COMMON = path.join(ROOT, "tools", "scripts", "Log-Common.ps1");
const kernelSrc = fs.readFileSync(LOG_COMMON, "utf8");

/** 按宿主可用性收集要跑的 PowerShell（5.1 与 7 都跑，两边行为必须同形）。 */
const hosts = (() => {
  const found: Array<string> = [];
  for (const candidate of ["pwsh", "powershell"]) {
    try {
      execFileSync(candidate, ["-NoProfile", "-Command", "exit 0"], {
        stdio: "ignore",
      });
      found.push(candidate);
    } catch {
      // 这台机器上没有这个宿主
    }
  }
  return found;
})();
const hasPs = hosts.length > 0;

const tmpDirs: Array<string> = [];
afterAll(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * 一次性 harness：dot-source 内核，顺序跑四态、结论打成 `CODE|<label>|<值>`。参数走 env 而非 `-Root <path>`：5.1 的 `-File`
 * 传参曾把变量绑成空值（`Join-Path` 收到 null 炸），env 两宿主同形且无引号坑。顺序有讲究：成功退 0 后立刻跑一条起不来的 ——
 * 起不来若沿用陈旧码会读回 0、看着像通过；反向（先退 3 再起不来）陈旧值非零，用例会绿着放过这个洞。
 */
const HARNESS = [
  "$PROJECT_ROOT = $env:JUDGE_ROOT",
  ". $env:JUDGE_LOG_COMMON",
  "Initialize-Log 'judge.log'",
  // 1) 成功
  "Invoke-Logged 'node -e \"process.exit(0)\"'",
  "Write-Output ('CODE|success|' + $script:LAST_INVOKE_CODE)",
  // 2) 紧跟着一条起不来的命令 —— 决定性那一格
  "Invoke-Logged 'definitely-not-a-real-command-xyz --version'",
  "Write-Output ('CODE|missing-after-success|' + $script:LAST_INVOKE_CODE)",
  // 3) 真跑了且退 3
  "Invoke-Logged 'node -e \"process.exit(3)\"'",
  "Write-Output ('CODE|exit3|' + $script:LAST_INVOKE_CODE)",
  // 4) 退非 0 之后再来一条起不来的：陈旧值此时是 3，也必须报 127 而不是 3
  "Invoke-Logged 'definitely-not-a-real-command-xyz --version'",
  "Write-Output ('CODE|missing-after-exit3|' + $script:LAST_INVOKE_CODE)",
  "",
].join("\n");

function runHarness(host: string): Record<string, string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "log-common-judge-"));
  tmpDirs.push(dir);
  const harness = path.join(dir, "harness.ps1");
  fs.writeFileSync(harness, HARNESS, "utf8");
  const r = spawnSync(host, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", harness], {
    cwd: dir,
    encoding: "utf8",
    timeout: 180_000,
    env: { ...process.env, JUDGE_ROOT: dir, JUDGE_LOG_COMMON: LOG_COMMON },
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const codes: Record<string, string> = {};
  for (const line of out.split(/\r?\n/)) {
    const m = /^CODE\|(?<key>[^|]+)\|(?<msg>.*)$/.exec(line.trim());
    const codeKey = m?.groups?.key;
    if (codeKey !== undefined && codeKey !== "") {
      codes[codeKey] = m?.groups?.msg ?? "";
    }
  }
  codes.__status = String(r.status);
  codes.__out = out;
  return codes;
}

/** 三个发布构建入口：判决只能来自内核那一份结论。 */
const READERS = [
  "tools/scripts/build-standalone.ps1",
  "tools/scripts/build-tauri-release.ps1",
  "tools/scripts/rebuild-static.ps1",
];

describe("内核的失败形态要分开（静态）", () => {
  it("「命令没起来」有自己的 ASCII 标签，且判决只在循环外赋一次", () => {
    expect(kernelSrc).toContain("[CMD-NOTFOUND]");
    // 旧形状在 ForEach-Object 的循环体里也赋一次值 —— 子进程零输出时循环体一次都不执行，
    // 那份赋值就漏写结论（两个读者迟早漂成两个数）。
    const assignments = kernelSrc.match(/\$script:LAST_INVOKE_CODE\s*=\s*\$LASTEXITCODE/g);
    expect(assignments ?? []).toHaveLength(1);
  });

  it("三个入口都读内核的结论，没有一个在 Invoke-Logged 之后另起一份 $LASTEXITCODE 判决", () => {
    // 这条不是洁癖：#1350 的实测里 `rebuild-static.ps1` 就是**第二个读者**（直接读
    // `$LASTEXITCODE`）。两份读者意味着同一步可能给出两个结论 —— 而陈旧码那一侧永远是绿的。
    /* 软断言：三个入口 × 各自的若干站点是**互不相关**的结论 —— 第一个入口
       的毛病不该遮住另外两个的（§11.18）。 */
    for (const rel of READERS) {
      const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
      expect
        .soft(text, `${rel} 必须读 $script:LAST_INVOKE_CODE`)
        .toContain("$script:LAST_INVOKE_CODE");
      const afterInvoke = text.split("Invoke-Logged").slice(1);
      for (const chunk of afterInvoke) {
        const head = chunk.split(/\r?\n/).slice(1, 3).join("\n");
        expect
          .soft(
            /\$LASTEXITCODE\s*-ne\s*0/.test(head),
            `${rel} 在 Invoke-Logged 之后直接判 $LASTEXITCODE（那份可能是陈旧值）`,
          )
          .toBe(false);
      }
    }
  });
});

describe.skipIf(!hasPs)("Invoke-Logged 真跑（三态跨宿主同形）", () => {
  for (const host of hosts) {
    it(`${host}：成功给 0、真失败给真码、命令起不来给 127 而不是上一次的 0`, () => {
      const c = runHarness(host);
      const out = c.__out ?? "";
      expect(c.success, `成功的调用应记 0（输出：\n${out}）`).toBe("0");
      // 决定性那条：陈旧值是 0，读回 0 就等于「没跑起来 = 通过」
      expect(
        c["missing-after-success"],
        `命令起不来却记成 ${c["missing-after-success"]}（陈旧码），输出：\n${out}`,
      ).toBe("127");
      expect(c.exit3, `外部命令退 3 必须记 3，读到 ${c.exit3}`).toBe("3");
      expect(c["missing-after-exit3"], `此时陈旧值是 3，必须被清成 127 而不是复用 3`).toBe("127");
      expect(out).toContain("[CMD-NOTFOUND]");
      // 三态各一条结论：不许把「判不了」塌成「跑了且失败」，也不许反过来
      expect(out).not.toContain("[FAIL][DEP-DRIFT]");
    });
  }
});
