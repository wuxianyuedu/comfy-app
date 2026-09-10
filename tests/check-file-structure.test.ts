/**
 * 提交门槛自检：把 scripts/check-file-structure.cjs 当成黑盒跑在临时工作区上，
 * 验证「Windows 入口 .ps1 化」这条硬规则（R7/R8，ISSUE #23）真的会阻断提交，
 * 而不是只写在文档里。
 *
 * 规范：docs/standards/launch-and-build.md §8
 *   - R7 仓库内禁止 .bat / .cmd / .vbs 入口（历史惨案：cmd 走 GBK 代码页，
 *     中文提示与子进程 UTF-8 输出必然乱码，入口被迫做成不含中文的哑壳）
 *   - R8 scripts/ tools/ 下含中文的 .ps1 必须 UTF-8 BOM（无 BOM 会被 PS 5.1
 *     按 GBK 解码，与 .bat 乱码同源）
 *   - R9 根目录禁止散落 .ps1 双击入口（ISSUE #29）：入口归入 tools/<分类>/，
 *     启动类归 tools/start/；根目录只留工程配置
 *   - R10 注释里禁止「历史流水」（日期 / 改动编号 / 任务批次号，ISSUE #46）：
 *     作者与修改日期归 git log，写进注释会随代码搬迁过期失真
 *
 * 为什么用子进程跑而不是 import：该脚本被 pre-commit 以 `node scripts/xxx.cjs`
 * 调用，且内部用 process.cwd() 定位扫描根；复用同一调用方式才等价于真实门禁。
 */
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "scripts", "check-file-structure.cjs");
// 构建前置守卫：断言它真的能认出「路径落在本仓库 src-tauri\target\ 下的 app.exe」，
// 而不是把同名的无关进程（如别处的 app.exe）当成目标壳误杀。
const GUARD = join(process.cwd(), "tools", "scripts", "Build-Guard.ps1");
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

let workdir = "";

function run(): { code: number; output: string } {
  try {
    const output = execFileSync(
      process.execPath,
      [join(workdir, "check-file-structure.cjs")],
      { cwd: workdir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { code: 0, output };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return {
      code: typeof e.status === "number" ? e.status : 1,
      output: `${e.stdout ?? ""}${e.stderr ?? ""}`,
    };
  }
}

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "structure-gate-"));
  copyFileSync(SCRIPT, join(workdir, "check-file-structure.cjs"));
  // 脚本无条件扫描 src/（R1-R6 规则），临时工作区必须存在该目录
  mkdirSync(join(workdir, "src"));
  mkdirSync(join(workdir, "scripts"));
  mkdirSync(join(workdir, "tools", "build"), { recursive: true });
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe("check-file-structure.cjs（提交门槛）", () => {
  it("干净的工作区放行", () => {
    writeFileSync(
      join(workdir, "scripts", "ok.ps1"),
      Buffer.concat([BOM, Buffer.from('Write-Host "中文提示"\n')]),
    );
    const { code, output } = run();
    expect(output).toContain("[structure] OK");
    expect(code).toBe(0);
  });

  it("R9：根目录新增 .ps1 双击入口被阻断（ISSUE #29）", () => {
    writeFileSync(
      join(workdir, "start-web.ps1"),
      Buffer.concat([BOM, Buffer.from('Write-Host "启动"\n')]),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("R9");
    expect(output).toContain("start-web.ps1");
  });

  it("R9：tools/start/ 下的入口放行（入口归位不误伤）", () => {
    mkdirSync(join(workdir, "tools", "start"), { recursive: true });
    writeFileSync(
      join(workdir, "tools", "start", "start-web.ps1"),
      Buffer.concat([BOM, Buffer.from('Write-Host "启动"\n')]),
    );
    const { code, output } = run();
    expect(output).toContain("[structure] OK");
    expect(code).toBe(0);
  });

  it("R9：根目录的非 .ps1 文件不受约束（配置/文档照旧）", () => {
    // R9 只针对双击入口，不收紧根目录的工程配置与文档
    writeFileSync(join(workdir, "package.json"), "{}\n");
    writeFileSync(join(workdir, "README.md"), "# demo\n");
    const { code, output } = run();
    expect(output).toContain("[structure] OK");
    expect(code).toBe(0);
  });

  it("R7：新增 .bat 入口被阻断", () => {
    writeFileSync(join(workdir, "scripts", "foo.bat"), "@echo off\r\n");
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("R7");
    expect(output).toContain("scripts/foo.bat");
  });

  it("R7：.cmd 与 .vbs 同样被阻断", () => {
    writeFileSync(join(workdir, "tools", "b.cmd"), "@echo off\r\n");
    writeFileSync(join(workdir, "start-tauri.vbs"), "WScript.Quit\r\n");
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("tools/b.cmd");
    expect(output).toContain("start-tauri.vbs");
  });

  it("R8：含中文但无 BOM 的 .ps1 被阻断", () => {
    writeFileSync(
      join(workdir, "tools", "build", "bad.ps1"),
      'Write-Host "中文提示"\n',
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("R8");
    expect(output).toContain("tools/build/bad.ps1");
  });

  it("R8：纯 ASCII 的 .ps1 不强制 BOM（不制造无谓噪音）", () => {
    writeFileSync(
      join(workdir, "tools", "build", "ascii.ps1"),
      'Write-Host "hello"\n',
    );
    const { code, output } = run();
    expect(code).toBe(0);
    expect(output).not.toContain("R8");
  });

  it("R8：带 BOM 的中文 .ps1 放行", () => {
    const content = Buffer.concat([
      BOM,
      Buffer.from('Write-Host "桌面版自检"\n'),
    ]);
    writeFileSync(join(workdir, "tools", "build", "good.ps1"), content);
    const { code } = run();
    expect(code).toBe(0);
  });

  // ── R10：注释里的「历史流水」(ISSUE #46 / 规范 12.4.2 / 反模式表 G4) ──
  // 三类标记都是「哪一批改动留下的」，git log 天然可查，写进注释会随代码
  // 搬迁过期失真（改过一次的代码上仍挂着三个月前的编号）。
  describe("R10：注释里的历史流水被阻断（ISSUE #46）", () => {
    const writeSrc = (name: string, body: string) => {
      mkdirSync(join(workdir, "src"), { recursive: true });
      writeFileSync(join(workdir, "src", name), body);
    };

    it("改动编号 R-ardot114 被阻断", () => {
      writeSrc("a.ts", "// R-ardot114 (2026-08-17): SSE 心跳\nexport const a = 1;\n");
      const { code, output } = run();
      expect(code).toBe(1);
      expect(output).toContain("R10");
      expect(output).toContain("R-ardot114");
    });

    it("短编号 R83 与批次号 T12-3 被阻断", () => {
      writeSrc("b.ts", "/* 2026-08-13 R83: 失败面板 */\n/* T12-3 抽离 */\nexport const b = 2;\n");
      const { code, output } = run();
      expect(code).toBe(1);
      expect(output).toContain("R83");
      expect(output).toContain("T12-3");
    });

    it("只写当前 Why（无日期无编号）的注释放行", () => {
      writeSrc("c.ts", "// SSE 心跳：防止 Nginx 60s 空闲断开。\nexport const c = 3;\n");
      const { code } = run();
      expect(code).toBe(0);
    });

    it("代码里的日期字面量不属于注释流水，放行", () => {
      writeSrc(
        "d.ts",
        'export const SINCE = "2026-08-17";\nexport const KEY = `wfdetail:R6:v2`;\n',
      );
      const { code } = run();
      expect(code).toBe(0);
    });
  });
});

describe("Build-Guard.ps1（构建前置守卫）", () => {
  /**
   * 复现并锁住「cargo 覆盖 target\release\app.exe 时拒绝访问 (os error 5)」这条
   * 已知故障路径（规范 §5）：壳还在跑 → 覆盖被拒 → 整轮编译白跑。
   * 守卫的判据是「进程 exe 路径落在本仓库 src-tauri\target\{release,debug}\」，
   * 因此这里用 PowerShell 打桩 Get-CimInstance，喂两类进程验证筛选：
   *   - 本仓库 target 下的 app.exe（含大小写/相对段差异）→ 必须命中
   *   - 别处路径的 app.exe、命令行恰好含项目根但路径在外的 app.exe → 必须不命中
   */
  // Windows PowerShell 5.1 与 PowerShell 7 都可用；非 Windows 平台（Linux CI）没有
  // powershell，相关用例跳过，规则本身由 scripts/check-file-structure.cjs 与
  // 本文件其它用例覆盖。
  const psExe = (() => {
    for (const candidate of ["powershell", "pwsh"]) {
      try {
        execFileSync(candidate, ["-NoProfile", "-Command", "exit 0"], {
          stdio: "ignore",
        });
        return candidate;
      } catch {
        // 试下一个候选
      }
    }
    return "";
  })();

  const runGuard = (script: string): string =>
    execFileSync(psExe, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

  // 打桩 Get-CimInstance：守卫只依赖它拿进程列表，替换后即可在任意平台喂造数据。
  const guardScript = (procsJson: string): string => `
$ErrorActionPreference = "Stop"
function Log { param([string]$Msg) Write-Output $Msg }
function Get-CimInstance {
  param([string]$ClassName, [string]$Filter)
  $rows = '${procsJson}' | ConvertFrom-Json
  foreach ($r in $rows) {
    [pscustomobject]@{ ProcessId = $r.Id; ExecutablePath = $r.Path; CommandLine = $r.Cmd }
  }
}
. "${GUARD}"
$root = "${process.cwd()}"
$hits = @(Get-RunningShellProcess -ProjectRoot $root)
Write-Output ("HITS=" + $hits.Count)
foreach ($h in $hits) { Write-Output ("HIT=" + $h.Id) }
`;

  it.skipIf(!psExe)("命中本仓库 target 下的运行中壳", () => {
    const root = process.cwd();
    const json = JSON.stringify([
      { Id: 111, Path: join(root, "src-tauri", "target", "release", "app.exe"), Cmd: "" },
      { Id: 222, Path: "D:\\other\\app.exe", Cmd: "" },
      { Id: 333, Path: "", Cmd: `other ${root} unrelated` },
    ]);
    const out = runGuard(guardScript(json));
    expect(out).toContain("HITS=2");
    expect(out).toContain("HIT=111");
    expect(out).toContain("HIT=333");
  });

  it.skipIf(!psExe)("路径大小写不同也算命中", () => {
    const root = process.cwd();
    const json = JSON.stringify([
      {
        Id: 444,
        Path: join(root, "SRC-TAURI", "Target", "Release", "APP.EXE"),
        Cmd: "",
      },
    ]);
    const out = runGuard(guardScript(json));
    expect(out).toContain("HITS=1");
    expect(out).toContain("HIT=444");
  });

  it.skipIf(!psExe)("没有任何壳进程时返回 0 项", () => {
    const out = runGuard(guardScript(JSON.stringify([])));
    expect(out).toContain("HITS=0");
  });
});
