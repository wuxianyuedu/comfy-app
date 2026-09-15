/**
 * 回归护栏：**入口公共库 `scripts/entry-common.ps1` 在 StrictMode 下不得引用
 * 未声明的变量**。
 *
 * 背景（ISSUE #564，实测复现）：`Invoke-Entry` 里有一处 `if ($NodeScript) { … }`
 * ——`$NodeScript` 只是注释块里的一个 `.PARAMETER` 说明，**从未进过 `param()`
 * 的参数表，也从未被任何入口传过**。本库顶部写着
 * `Set-StrictMode -Version Latest`，而 StrictMode 的「Latest」档会把
 * 「引用不存在的变量」从「$null」升级成**终止性错误**：
 *
 *     Invoke-Entry: …\tools\start\run-local.ps1:32
 *     无法检索变量 '$NodeScript'，因为尚未设置该变量。
 *
 * 因为这条分支在 `Invoke-Entry` 的**主路径**上（不是 else 分支），它让
 * `run-local.ps1` / `verify-quality.ps1` / `run-tests.ps1` / `generate-docs.ps1`
 * / `sync-lint.ps1` / `register-comfyapp-protocol.ps1` 等**每一个**走
 * `Invoke-Entry` 的双击入口在调起逻辑脚本之前就炸掉；而 `start-web.ps1` /
 * `start-tauri-dev.ps1` 虽然传的是 `dev-launcher.ps1`（一个现在只会定位→转交
 * 的薄壳），也一并被这条无关的旧分支拦下。
 *
 * 为什么静态断言不够、还要真跑一遍：`.ps1` 里引用未声明变量**在解析期不报错**，
 * 只有执行到那一行才炸；`pnpm lint` / `tsc` / 任何 Node 侧门禁都读不到它，
 * 现有的结构门禁（R7/R8）只看后缀与 BOM。而它在真实机器上是「十一个入口同时
 * 不可用」这种量级的故障。
 *
 * 无 pwsh 的环境（Linux CI）只做静态断言：真实执行在 Windows 侧。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const ENTRY_COMMON = path.join(ROOT, "scripts", "entry-common.ps1");
const src = fs.readFileSync(ENTRY_COMMON, "utf8");

/** 可用时真跑的 PowerShell 宿主（Windows 5.1 / pwsh 7 都认）。 */
const psExe = (() => {
  for (const candidate of ["powershell", "pwsh"]) {
    try {
      execFileSync(candidate, ["-NoProfile", "-Command", "exit 0"], { stdio: "ignore" });
      return candidate;
    } catch {
      // 试下一个候选
    }
  }
  return "";
})();

const tmpDirs: string[] = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * 取出 `function <name>` 的「`param()` 参数表 + 函数体」文本。
 *
 * 不用「\$\w+ 出现即算引用」这种粗判据：本库的注释块（`.PARAMETER` / `.DESCRIPTION`）
 * 里本来就会提到变量名，把它们算进来会把「注释里解释过」误判成「声明了」。
 */
function declarationText(text: string, name: string): string {
  const head = text.indexOf(`function ${name} {`);
  expect(head, `找不到 function ${name}`).toBeGreaterThan(-1);
  const body = text.slice(head);
  // 到下一个顶层 `function ` 或文件末尾为止（本库函数之间没有嵌套）
  const next = body.indexOf("\nfunction ", 1);
  return next > 0 ? body.slice(0, next) : body;
}

/** 一个函数（不含注释）里引用的 `$变量` 集合。 */
function referencedVars(body: string): Set<string> {
  const code = body.replace(/<#[\s\S]*?#>/g, "").replace(/(?<![:"'])#.*$/gm, "");
  const vars = new Set<string>();
  for (const m of code.matchAll(/\$([A-Za-z_]\w*)/g)) vars.add(m[1]!);
  return vars;
}

describe("entry-common.ps1：StrictMode 下不得引用未声明的变量", () => {
  it("库顶部仍是 StrictMode Latest（本条的前提，被悄悄降级就失效了）", () => {
    expect(src).toContain("Set-StrictMode -Version Latest");
  });

  it("`param()` 里声明的变量覆盖函数体引用的每一个变量", () => {
    const body = declarationText(src, "Invoke-Entry");
    const open = body.indexOf("param(");
    const close = body.indexOf("\n  )", open);
    expect(open, "找不到 Invoke-Entry 的 param()").toBeGreaterThan(-1);
    expect(close, "找不到 Invoke-Entry 的 param() 收尾").toBeGreaterThan(open);
    const signaturePart = body.slice(open, close);
    const codePart = body.slice(close);
    const declared = new Set(
      [...signaturePart.matchAll(/\$([A-Za-z_]\w*)/g)].map((m) => m[1]!),
    );
    // 函数体内自己赋值/定义的局部变量（`$abs = …` / `foreach ($f in …)`）也算声明；
    // 这里只抓「赋值目标」与 `param(` 之外的形参声明，做法是从代码里取出所有
    // 「出现在 = 左边」或「for/foreach 引入」的名字。
    for (const m of codePart.matchAll(/\$([A-Za-z_]\w*)\s*=/g)) declared.add(m[1]!);
    for (const m of codePart.matchAll(/fore(?:ach)?\s*\(\s*\$([A-Za-z_]\w*)/g)) declared.add(m[1]!);
    // 本库自己的函数名（`Get-Pwsh` 写成 `$psExe = Get-Pwsh` 时不会误命中，
    // 但 `return (Get-Pwsh)` 这类形态在粗匹配里可能落到 `$` 上）与 PowerShell
    // 自动变量不算「未声明」。
    const ALLOWED = new Set([
      "PSScriptRoot", "LASTEXITCODE", "env", "PID", "null", "true", "false", "_",
    ]);

    const undeclared = [...referencedVars(codePart)].filter(
      (v) => !declared.has(v) && !ALLOWED.has(v),
    );
    expect(
      undeclared,
      `Invoke-Entry 引用了 param() 里没有的变量：${undeclared.join(" / ")}。` +
        `在 Set-StrictMode -Version Latest 下这会在**执行到那一行时**直接终止，` +
        `而 .ps1 的解析期与任何 Node 侧门禁都拦不住它（ISSUE #564）。`,
    ).toEqual([]);
  });

  it("`$NodeScript` 这个未接线的分支不再回来（它曾让 11 个入口全部不可用）", () => {
    // 判据是「不再出现这个变量名」而不是「不再出现 if」：本库只认 PowerShell
    // 逻辑脚本，调 .mjs 的入口各自做薄壳（scripts/dev-launcher.ps1 是参考形态）。
    expect(src).not.toContain("NodeScript");
    expect(src).not.toContain("Invoke-NodeEntry");
  });

  it("注释块里说明过「本库只管 .ps1 逻辑脚本」", () => {
    // 光删掉不够：下一个「顺手支持 .mjs」的人需要知道为什么不该加回来。
    expect(src).toMatch(/只管 PowerShell 逻辑脚本/);
    expect(src).toMatch(/不要走这里/);
  });
});

/**
 * 真跑一遍：StrictMode 的报错只在**执行到那行**才出现，静态断言容易漏掉
 * 「参数表 vs 函数体」之外的形态（例如函数外的作用域引用）。这里在一个最小
 * 检出副本里调 Invoke-Entry，断言「它至少走到了『未找到逻辑脚本』这条出口」——
 * 那正是「主路径没被任何未声明变量拦下」的证据。
 */
describe.runIf(psExe !== "")("entry-common.ps1 真跑（有 PowerShell 的环境）", () => {
  const runInMinimalCheckout = (): string => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "entry-common-"));
    tmpDirs.push(tmp);
    fs.mkdirSync(path.join(tmp, "scripts"), { recursive: true });
    fs.copyFileSync(ENTRY_COMMON, path.join(tmp, "scripts", "entry-common.ps1"));
    // Get-ProjectRoot 的标记文件：编排器的唯一实现（不是任何 .ps1 入口形态）
    fs.writeFileSync(path.join(tmp, "scripts", "dev-launcher.mjs"), "", "utf8");
    const probe = [
      `$ErrorActionPreference = "Stop"`,
      `try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}`,
      `. (Join-Path "${tmp}" "scripts\\entry-common.ps1")`,
      // 目录里没有 no-such-logic.ps1：正常路径应在「未找到逻辑脚本」处返回 1，
      // 而不是被 StrictMode 的「无法检索变量」终止。
      `$code = Invoke-Entry -Root "${tmp}" -ScriptPath "scripts\\no-such-logic.ps1"`,
      `Write-Output "EXIT=$code"`,
    ].join("\n");
    const proc = execFileSync(
      psExe,
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", probe],
      { encoding: "utf8" },
    );
    return proc;
  };

  it("Invoke-Entry 走到自己的「未找到逻辑脚本」出口，而不是 StrictMode 终止", () => {
    const out = runInMinimalCheckout();
    expect(out).toContain("EXIT=1");
    expect(out).toContain("未找到逻辑脚本");
    // 旧实现走到这里就炸：报的是变量检索失败，用户完全看不出发生了什么。
    expect(out).not.toContain("无法检索变量");
    expect(out).not.toContain("NodeScript");
  }, 60_000);
});
