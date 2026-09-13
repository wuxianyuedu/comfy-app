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
  readFileSync,
  rmSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi
} from "vitest";

const SCRIPT = join(process.cwd(), "scripts", "check-file-structure.cjs");
// 构建前置守卫：断言它真的能认出「路径落在本仓库 src-tauri\target\ 下的 app.exe」，
// 而不是把同名的无关进程（如别处的 app.exe）当成目标壳误杀。
const GUARD = join(process.cwd(), "tools", "scripts", "Build-Guard.ps1");
// 启动链路的残留壳治理：dev-launcher.ps1 的 Get-RunningProjectShell / Stop-StaleProjectShell
// 与构建守卫共用「exe 真实路径落在本仓库 target 下」这条判据。
const LAUNCHER = join(process.cwd(), "scripts", "dev-launcher.ps1");
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
      writeSrc(
        "a.ts",
        "// R-ardot114 (2026-08-17): SSE 心跳\nexport const a = 1;\n",
      );
      const { code, output } = run();
      expect(code).toBe(1);
      expect(output).toContain("R10");
      expect(output).toContain("R-ardot114");
    });

    it("短编号 R83 与批次号 T12-3 被阻断", () => {
      writeSrc(
        "b.ts",
        "/* 2026-08-13 R83: 失败面板 */\n/* T12-3 抽离 */\nexport const b = 2;\n",
      );
      const { code, output } = run();
      expect(code).toBe(1);
      expect(output).toContain("R83");
      expect(output).toContain("T12-3");
    });

    it("只写当前 Why（无日期无编号）的注释放行", () => {
      writeSrc(
        "c.ts",
        "// SSE 心跳：防止 Nginx 60s 空闲断开。\nexport const c = 3;\n",
      );
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
  /* 用例真实 spawn PowerShell（5.1 冷启动 + 造数据 + 收输出），单条常态就要
   * 3~4s；全量并行满载时 5s 默认超时偶发击穿（2026-09-13 两次）。整组放宽到
   * 20s——只影响本 describe，不掩盖其它文件的真实挂起。 */
  vi.setConfig({ testTimeout: 20_000 });
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

  // 结论在 stdout，守卫的日志（`Log` 被桩件改写到 stderr）要一起收，
  // 否则「回收陈旧壳」「非交互构建」「请先结束启动器」这些可见出口断言不到。
  // PS 5.1 对重定向输出默认按系统 ANSI 代码页（zh-CN 为 GBK）编码中文，这里
  // 按 UTF-8 读必是乱码，故在会话内先强制 UTF-8（pwsh 7 本就 UTF-8，前置语句
  // 是无害重复；setter 在无控制台句柄的宿主可能抛错，吞掉即可）。
  const psUtf8Prelude =
    "try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}\n";
  const runGuard = (script: string): string => {
    const proc = spawnSync(
      psExe,
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        psUtf8Prelude + script,
      ],
      { encoding: "utf8" },
    );
    return `${proc.stdout ?? ""}${proc.stderr ?? ""}`;
  };

  // 打桩 Get-CimInstance（进程枚举）与 taskkill（回收动作）：既用来验证筛选规则，
  // 也用来验证「陈旧壳 / 非交互构建自动回收后继续」与「启动器还在跑才中止」这两条
  // ISSUE #412 的判据——不真的动本机进程。
  //
  // 造数据用 `{ Id, Path, Cmd, Name }`：Name 为 `app.exe`（壳）或启动器 exe 名
  // （`start-tauri.exe` 等）。`Name='xxx'` 按名过滤；`ProcessId=<n>` 用来回答
  // 「我是谁 / 我爹是谁」（`Test-UnattendedBuild` 靠它判双击 / 由启动器拉起），
  // 桩件查自身时如实回 `$PID`，查父进程时回 `opts.parent`。
  const guardScript = (
    procsJson: string,
    opts: { parent?: string } = {},
  ): string => `
$ErrorActionPreference = "Stop"
function Log { param([string]$Msg) Write-Output $Msg }
function Get-CimInstance {
  param([string]$ClassName, [string]$Filter)
  $rows = '${procsJson}' | ConvertFrom-Json
  if ($Filter -match "ProcessId=(\\d+)") {
    $want = [int]$Matches[1]
    if ($want -eq $PID) {
      [pscustomobject]@{ ProcessId = $PID; ParentProcessId = 9001; Name = "pwsh.exe" }
    } elseif ($want -eq 9001) {
      [pscustomobject]@{ ProcessId = 9001; ParentProcessId = 0; Name = "${opts.parent ?? "pwsh.exe"}" }
    }
    return
  }
  foreach ($r in $rows) {
    if ($r.Name -and $Filter -notlike ("*" + [char]39 + $r.Name + [char]39 + "*")) { continue }
    if ($global:KILLED_PIDS -contains [int]$r.Id) { continue }
    [pscustomobject]@{ ProcessId = $r.Id; ExecutablePath = $r.Path; CommandLine = $r.Cmd }
  }
}
function taskkill {
  param([Parameter(ValueFromRemainingArguments = $true)]$Args)
  Write-Output ("KILL " + ($Args -join " "))
  $global:KILLED = [int]$global:KILLED + 1
  # 模拟回收：记住被杀掉的 PID，后续查询不再返回它们（否则「回收后复查」这条路
  # 在桩件里永远走不通，测不出守卫真实的继续/中止分支）
  if ($Args.Count -ge 2 -and $Args[0] -eq "/PID") {
    $global:KILLED_PIDS += [int]$Args[1]
  }
}
$global:KILLED_PIDS = @()
$script:KILLED_PIDS = @()
. "${GUARD}"
$root = "${process.cwd()}"
$hits = @(Get-RunningShellProcess -ProjectRoot $root)
Write-Output ("HITS=" + $hits.Count)
foreach ($h in $hits) { Write-Output ("HIT=" + $h.Id) }
`;

  it.skipIf(!psExe)("命中本仓库 target 下的运行中壳", () => {
    const root = process.cwd();
    const json = JSON.stringify([
      {
        Id: 111,
        Path: join(root, "src-tauri", "target", "release", "app.exe"),
        Cmd: "",
        Name: "app.exe",
      },
      { Id: 222, Path: "D:\\other\\app.exe", Cmd: "", Name: "app.exe" },
      { Id: 333, Path: "", Cmd: `other ${root} unrelated`, Name: "app.exe" },
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
        Name: "app.exe",
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

  /**
   * ISSUE #412：用户双击 build-all 时一上来就被「目标文件被占用」挡下，
   * 提示「请先关闭桌面窗口」——可窗口早就关了，照做也关不掉，卡成死循环。
   *
   * 判据收敛成：陈旧壳（起它的启动器已退出 = 无主孤儿壳）与非交互构建下的占用
   * 自动回收后继续；只有「启动器还在跑 / 用户可能正开着应用」才中止。
   * 这里用打桩进程表把三条规则各锁一次（回收动作走 Write-Output 便于断言）。
   */
  // 结论走 stdout、守卫日志走 stderr（同 dev-launcher 用例的套路）：`Log` 若也写
  // stdout，正文会与 `CODE=` 挤在同一行，断言被日志粘住而失衡。
  // KILLED 计数用 `$global:`（Assert-ShellNotRunning 有自己的作用域，`$script:` 改不到）。
  const assertShellScript = (
    procsJson: string,
    opts: { parent?: string } = {},
  ): string =>
    guardScript(procsJson, opts)
      .replace(
        "function Log { param([string]$Msg) Write-Output $Msg }",
        "function Log { param([string]$Msg) [Console]::Error.WriteLine($Msg) }",
      )
      .replace(
        "$global:KILLED_PIDS = @()",
        "$global:KILLED = 0\n$global:KILLED_PIDS = @()",
      ) +
    `
$code = Assert-ShellNotRunning -ProjectRoot $root -Purpose "构建 release 壳"
Write-Output ("CODE=" + $code)
Write-Output ("KILLED=" + $global:KILLED)
Write-Output ("|END")
`;

  it.skipIf(!psExe)(
    "陈旧壳（启动器已退出）自动回收后继续构建，不再要求用户去关窗口",
    () => {
      const root = process.cwd();
      const json = JSON.stringify([
        {
          Id: 711,
          Path: join(root, "src-tauri", "target", "release", "app.exe"),
          Cmd: "",
          Name: "app.exe",
        },
      ]);
      // 进程表里没有任何本仓库启动器 -> 该壳是无主孤儿壳
      const out = runGuard(assertShellScript(json));
      expect(out).toContain("CODE=0");
      expect(out).toContain("KILLED=1");
      expect(out).toContain("回收陈旧桌面壳");
    },
  );

  it.skipIf(!psExe)(
    "启动器还在跑时不自动回收，改为中止并点名要求先结束启动器（ISSUE #412）",
    () => {
      const root = process.cwd();
      const json = JSON.stringify([
        {
          Id: 721,
          Path: join(root, "src-tauri", "target", "release", "app.exe"),
          Cmd: "",
          Name: "app.exe",
        },
        {
          Id: 722,
          Path: join(root, "start-tauri", "start-tauri.exe"),
          Cmd: "",
          Name: "start-tauri.exe",
        },
      ]);
      const out = runGuard(assertShellScript(json, { parent: "pwsh.exe" }));
      expect(out).toContain("CODE=1");
      expect(out).toContain("KILLED=0");
      expect(out).toContain("请先结束启动器");
    },
  );

  it.skipIf(!psExe)(
    "双击构建（父进程 explorer）没人能确认，占用一律自动回收后继续",
    () => {
      const root = process.cwd();
      const json = JSON.stringify([
        {
          Id: 731,
          Path: join(root, "src-tauri", "target", "release", "app.exe"),
          Cmd: "",
          Name: "app.exe",
        },
        {
          Id: 732,
          Path: join(root, "start-tauri", "start-tauri.exe"),
          Cmd: "",
          Name: "start-tauri.exe",
        },
      ]);
      const out = runGuard(assertShellScript(json, { parent: "explorer.exe" }));
      expect(out).toContain("CODE=0");
      expect(out).toContain("KILLED=1");
      expect(out).toContain("非交互构建");
    },
  );

  it.skipIf(!psExe)(
    "启动器进程的命中同样按 exe 真实路径，别处的同名进程不算",
    () => {
      const json = JSON.stringify([
        {
          Id: 741,
          Path: "D:\\other\\start-tauri.exe",
          Cmd: "",
          Name: "start-tauri.exe",
        },
      ]);
      const out = runGuard(guardScript(json));
      expect(out).toContain("HITS=0");
    },
  );
});

describe("dev-launcher.ps1（桌面壳残留治理）", () => {
  /**
   * 锁住「启动前残壳回收」与「构建前置守卫」共用同一条判据：进程 exe 的可执行文件
   * 路径落在本仓库 src-tauri\target\{release,debug}。旧实现按命令行（CommandLine -like
   * "*<项目根>*"）筛选，而预编译壳是 dev-launcher 用 ProcessStartInfo（UseShellExecute
   * =false）拉起的，命令行里不含项目根路径 → 残壳漏判、且下一次编译仍被它锁住产物。
   */
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

  // 注意：verdict 走 stdout（Write-Output），回收动作走 stderr（[Console]::Error）。
  // PowerShell 7 里 Write-Host 的「信息流」会与管道重定向（2>&1）交互，导致紧随其后的
  // Write-Output 被吞掉——用 stderr 记录动作，断言才稳定。
  const runLauncher = (script: string): string => {
    const proc = spawnSync(
      psExe,
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { encoding: "utf8" },
    );
    return `${proc.stdout ?? ""}${proc.stderr ?? ""}`;
  };

  // 打桩 Get-CimInstance（进程枚举）与 taskkill（回收动作）：只断言「认哪些进程、
  // 对认出来的发了什么 kill」，不真的动本机进程。
  const launcherScript = (procsJson: string): string => `
$ErrorActionPreference = "Stop"
function Log { param([string]$Msg) Write-Output $Msg }
function Write-Log { param([string]$Message, [string]$Level = "INFO") [Console]::Error.WriteLine("[$Level] " + $Message) }
function Get-CimInstance {
  param([string]$ClassName, [string]$Filter)
  $rows = '${procsJson}' | ConvertFrom-Json
  foreach ($r in $rows) {
    [pscustomobject]@{ ProcessId = $r.Id; ExecutablePath = $r.Path; CommandLine = $r.Cmd }
  }
}
function taskkill { param([Parameter(ValueFromRemainingArguments = $true)]$Args) [Console]::Error.WriteLine("KILL " + ($Args -join " ")) }
$statements = [System.Management.Automation.Language.Parser]::ParseFile("${LAUNCHER}", [ref]$null, [ref]$null).FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true)
$block = $statements | Where-Object { $_.Name -in @("Test-ProjectShellPath", "Get-RunningProjectShell", "Stop-StaleProjectShell") }
Invoke-Expression (($block | ForEach-Object { $_.Extent.Text }) -join "\`n")
$root = "${process.cwd()}"
$hits = @(Get-RunningProjectShell -Root $root)
Write-Output ("HITS=" + $hits.Count)
foreach ($h in $hits) { Write-Output ("HIT=" + $h.Id) }
Stop-StaleProjectShell -Root $root
`;

  it.skipIf(!psExe)(
    "残留判定按 exe 真实路径：本仓库 target 下的壳命中，别处的同名进程不命中",
    () => {
      const root = process.cwd();
      const json = JSON.stringify([
        {
          Id: 501,
          Path: join(root, "src-tauri", "target", "release", "app.exe"),
          Cmd: "",
        },
        { Id: 502, Path: "D:\\other\\app.exe", Cmd: `legacy ${root} app.exe` },
        { Id: 503, Path: "", Cmd: "" },
      ]);
      const out = runLauncher(launcherScript(json));
      expect(out).toContain("HITS=1");
      expect(out).toContain("HIT=501");
      expect(out).not.toContain("HIT=502");
      expect(out).toContain("KILL /PID 501 /T /F");
    },
  );

  it.skipIf(!psExe)("回收残留壳必须杀整棵进程树（/T /F），不得单杀", () => {
    const root = process.cwd();
    const json = JSON.stringify([
      {
        Id: 601,
        Path: join(root, "src-tauri", "target", "debug", "APP.EXE"),
        Cmd: "",
      },
    ]);
    const out = runLauncher(launcherScript(json));
    expect(out).toContain("KILL /PID 601 /T /F");
  });

  it.skipIf(!psExe)("没有残壳时不产生任何 kill", () => {
    const out = runLauncher(launcherScript(JSON.stringify([])));
    expect(out).toContain("HITS=0");
    expect(out).not.toContain("KILL ");
  });
});

describe("启动链路「不抢前台」判据（python 启动器）", () => {
  /**
   * 应用启动要几十秒，用户很可能切去别的窗口干活；加载完成若是照直把窗口顶到
   * 最前面，正在看的内容就被打断。判据收敛在 start_tauri_launcher.py 的
   * decide_foreground：只有「前台本来就是本应用」「显式冷启动」「唤起已有实例」
   * 才允许自动给前台；**双击启动也不给**——双击之后切去干别的正是常态，等
   * 正式窗口冒出来时用户早就在别处工作了（曾按「用户刚点的启动」放行，结果
   * 连同交接复核的 give 一起把用户打断两次）。其余情形一律留在任务栏并用
   * 任务栏闪烁提示（Rust 壳侧 show_main_window_without_focus 执行）。
   *
   * Win32 前台窗口在 Linux CI 上取不到，因此按本文件里 PowerShell 桩件的同一套路：
   * 把函数源码从启动器里抽出来、打桩 _window_process_name 后直接断言判决表，
   * 锁住「默认不抢前台」这条用户可感知行为。
   */
  const LAUNCHER_PY = join(process.cwd(), "scripts", "start_tauri_launcher.py");
  const python = (() => {
    for (const candidate of ["python3", "python"]) {
      try {
        execFileSync(candidate, ["-c", "import sys; sys.exit(0)"], {
          stdio: "ignore",
        });
        return candidate;
      } catch {
        // 试下一个候选
      }
    }
    return "";
  })();

  /** 抽 decide_foreground / foreground_window_process 的源码，打桩后跑一次判决。 */
  const decide = (call: string, foregroundProcess: string): string => {
    const script = `
import ast, json, sys

src = open(${JSON.stringify(LAUNCHER_PY)}, encoding="utf-8").read()
tree = ast.parse(src)
wanted = {"decide_foreground", "foreground_window_process", "_foreground_window_path"}
blocks = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in wanted]
namespace = {}
exec(compile(ast.Module(body=blocks, type_ignores=[]), "<stub>", "exec"), namespace)

messages = []
namespace["log"] = lambda msg: messages.append(str(msg))
namespace["foreground_window_process"] = lambda: ${JSON.stringify(foregroundProcess)}
# 按检出窗口识别前缀（launch-and-build.md §1.4）：stub 里置空 = 未初始化的
# 旧行为（仅按进程名判定）；这些用例锁的是前台判决表本身，不是检出隔离。
namespace["_SHELL_OWN_PREFIX"] = ""

verdict = namespace["decide_foreground"](${call})
print("RESULT=" + json.dumps(verdict))
print("LOG=" + " | ".join(messages))
`;
    const proc = spawnSync(python, ["-c", script], { encoding: "utf8" });
    return `${proc.stdout ?? ""}${proc.stderr ?? ""}`;
  };

  it.skipIf(!python)("用户切走了（前台是别的应用）时不自动抢前台", () => {
    const out = decide("", "notepad.exe");
    expect(out).toContain("RESULT=false");
    expect(out).toContain("foreground denied");
  });

  it.skipIf(!python)(
    "双击启动（前台是资源管理器）也不给前台——用户切去干别的正是常态",
    () => {
      const out = decide("", "explorer.exe");
      expect(out).toContain("RESULT=false");
      expect(out).toContain("foreground denied");
    },
  );

  it.skipIf(!python)(
    "前台本来就是本应用（重启 / 更新后重启）允许给前台",
    () => {
      expect(decide("", "app.exe")).toContain("RESULT=true");
    },
  );

  it.skipIf(!python)("脚本 / 终端冷启动允许给前台", () => {
    expect(decide("cold_start=True", "pwsh.exe")).toContain("RESULT=true");
  });

  it.skipIf(!python)("已有实例被唤起（重复启动）允许给前台", () => {
    expect(decide("already_running=True", "pwsh.exe")).toContain("RESULT=true");
  });

  it.skipIf(!python)(
    "双击入口自身的进程（打包后的 start-tauri.exe）同样不给前台",
    () => {
      expect(decide("", "start-tauri.exe")).toContain("RESULT=false");
    },
  );
});

describe("桌面壳 PID 文件的残留窗口（ISSUE #412 附带修复）", () => {
  /**
   * `log/launcher/tauri-shell.pid` 是「上一轮 run 的残留」：dev-launcher.ps1 是被
   * 本次启动器另起的进程，在它写到「壳已启动」那一步之前，文件里还是上一轮的旧 PID。
   * Windows 会复用 PID，旧号很可能已归某个无关进程——兜底回收路径读到它就会去杀
   * 不相干的东西。修法是拉起 dev-launcher.ps1 之前先删文件（窗口期内读不到 = 安全）。
   */
  const launcher = readFileSync(
    join(process.cwd(), "scripts", "start_tauri_launcher.py"),
    "utf8",
  );

  it("拉起 dev-launcher.ps1 之前先清掉上一轮的壳 PID 文件", () => {
    expect(launcher).toContain("def _reset_shell_pid_file(");
    const start = launcher.indexOf("def launch_dev_server(");
    const body = launcher.slice(start, launcher.indexOf("def monitor(", start));
    expect(body).toContain("_reset_shell_pid_file(project_root)");
    // 必须在 subprocess.Popen 之前（否则清除会把本次真实 PID 一起删掉）
    expect(body.indexOf("_reset_shell_pid_file(")).toBeLessThan(
      body.indexOf("subprocess.Popen("),
    );
  });

  it("兜底回收读不到 PID 文件时不做任何猜测性击杀", () => {
    const body = launcher.slice(
      launcher.indexOf("def _kill_shell_from_pid_file("),
      launcher.indexOf(
        "# ═══",
        launcher.indexOf("def _kill_shell_from_pid_file("),
      ),
    );
    expect(body).toContain("except Exception:");
    expect(body).toContain("return");
  });
});

describe("窗口交接时刻的前台归属复核（独立进程，ISSUE #359 回归）", () => {
  /**
   * 启动期判决只回答了「双击之后用户是不是马上走开了」；用户切去干别的可以持续
   * 几分钟，等应用真正冒出来时「双击入口还在前台」已经失真。更关键的是窗口交接
   * 那一刻：启动页窗口带 WS_EX_TOOLWINDOW，关闭它之后主窗任务栏按钮重建，Windows
   * 会把前台**自动放行**给主窗——壳里任何 set_focus() 都「成功」，「不打断用户」
   * 的策略当场被架空（用户回报的「构建后启动仍然抢前台」）。
   *
   * 因此交接时刻要再裁定一次，判据收敛在 scripts/win32-window-focus.py 的纯函数
   * decide_handoff：只有启动期判决允许给前台才给（give），系统自动放行的前台要还
   * 回去（restore），前台本来就是别的应用就什么都不做（leave）。
   *
   * Win32 部分在 Linux CI 上跑不到，这里按本文件既有套路抽出源码打桩后断言判决表，
   * 锁住这条用户可感知的行为不再回退。
   */
  const FOCUS_SCRIPT = join(process.cwd(), "scripts", "win32-window-focus.py");
  const python = (() => {
    for (const candidate of ["python3", "python"]) {
      try {
        execFileSync(candidate, ["-c", "import sys; sys.exit(0)"], {
          stdio: "ignore",
        });
        return candidate;
      } catch {
        // 试下一个候选
      }
    }
    return "";
  })();

  /** 抽出 decide_handoff 直接断言判决表。 */
  const decide = (call: string): string => {
    const script = `
import ast, json, sys

src = open(${JSON.stringify(FOCUS_SCRIPT)}, encoding="utf-8").read()
tree = ast.parse(src)
blocks = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "decide_handoff"]
namespace = {}
exec(compile(ast.Module(body=blocks, type_ignores=[]), "<stub>", "exec"), namespace)
print("RESULT=" + json.dumps(namespace["decide_handoff"](${call})))
`;
    const proc = spawnSync(python, ["-c", script], { encoding: "utf8" });
    return `${proc.stdout ?? ""}${proc.stderr ?? ""}`;
  };

  it.skipIf(!python)("用户就在等它（启动期判决允许）时把前台拿到手", () => {
    expect(
      decide(
        "startup_allowed=True, window_visible=True, window_was_foreground=False",
      ),
    ).toContain('RESULT="give"');
    expect(
      decide(
        "startup_allowed=True, window_visible=True, window_was_foreground=True",
      ),
    ).toContain('RESULT="give"');
  });

  it.skipIf(!python)("不该给但系统交接时自动放行了前台 -> 把前台还回去", () => {
    expect(
      decide(
        "startup_allowed=False, window_visible=True, window_was_foreground=True",
      ),
    ).toContain('RESULT="restore"');
  });

  it.skipIf(!python)(
    "用户切走了（前台是别的应用）时什么都不做，窗口留在任务栏",
    () => {
      expect(
        decide(
          "startup_allowed=False, window_visible=True, window_was_foreground=False",
        ),
      ).toContain('RESULT="leave"');
    },
  );

  it.skipIf(!python)("窗口没显示时不做任何前台动作", () => {
    expect(
      decide(
        "startup_allowed=False, window_visible=False, window_was_foreground=True",
      ),
    ).toContain('RESULT="leave"');
    expect(
      decide(
        "startup_allowed=True, window_visible=False, window_was_foreground=False",
      ),
    ).toContain('RESULT="leave"');
  });

  it("壳侧不再无条件 set_focus 试探（那条路径让「别打断用户」形同虚设）", () => {
    const rust = readFileSync(
      join(process.cwd(), "src-tauri", "src", "lib.rs"),
      "utf8",
    );
    const body = rust.slice(
      rust.indexOf("fn show_main_window_without_focus"),
      rust.indexOf("fn open_comfyui_window"),
    );
    expect(body).toContain("if activate {");
    // 无条件 set_focus：只在 activate 分支里才允许出现一次
    expect(body.match(/win\.set_focus\(\)/g)?.length).toBe(1);
    // 交接时刻的前台复审入口必须存在（把系统自动放行的前台还回去）
    expect(rust).toContain("win32-window-focus.py");
  });

  it("启动页被用户关闭而主窗仍未显示时，壳整体退出（不留无窗壳进程）", () => {
    // 主窗在 setup 时就以隐藏态创建：只关 splash 的话壳会带着看不见的主窗
    // 继续活着——任务栏残留、dev server 继续拉起、服务就绪后主窗还会自己
    // 弹出来。启动页的关闭请求必须在主窗尚未显示时让整个壳退出。
    const rust = readFileSync(
      join(process.cwd(), "src-tauri", "src", "lib.rs"),
      "utf8",
    );
    // 关闭请求的处理：钩子挂在 splash 窗口对象上、检查主窗可见性、放弃时退出
    const handler = rust.slice(
      rust.indexOf("启动页关闭 = 放弃本次启动"),
      rust.indexOf("启动页看门狗"),
    );
    expect(handler).toContain("WindowEvent::CloseRequested");
    expect(handler).toContain('get_webview_window("splash")');
    expect(handler).toContain("mark_abandoned()");
    expect(handler).toContain(".exit(0)");
    // 交接与安全网等「显示主窗」的路径都要被 abandoned 标记拦住
    // （CloseRequested 处理器之外的调用点：交接 / 150s 安全网 / 就绪兜底导航）
    const abandonedGuards = rust.match(/is_abandoned\(\)/g)?.length ?? 0;
    expect(
      abandonedGuards,
      "is_abandoned 拦截必须覆盖全部「显示主窗」路径",
    ).toBeGreaterThanOrEqual(3);
  });

  it("启动器在窗口就绪时拉起交接复核进程", () => {
    const launcher = readFileSync(
      join(process.cwd(), "scripts", "start_tauri_launcher.py"),
      "utf8",
    );
    expect(launcher).toContain("def spawn_foreground_watch(");
    // 三条完成路径（prebuilt / tauri dev / standalone）都要复核
    expect(
      launcher.match(/spawn_foreground_watch\(/g)?.length,
    ).toBeGreaterThanOrEqual(4);
    expect(launcher).toContain("foreground-watch.log");
  });
});

describe("启动页窗口即内容（紧凑 + 展开日志两档，无边框自绘标题行）", () => {
  /**
   * 启动页的日志面板是「一行一条日志」的不折行布局（`white-space: pre`，见
   * docs/standards/07-日志系统.md §7.18.6），所以**窗口宽度就是可读宽度**：
   * 窗口太窄日志每行都被切成两截（旧的 1280 就是这么来的）。
   *
   * 但「给得宽」的旧做法走到了另一个极端（ISSUE #412）：窗口按 1680×1000 开，
   * 而内容卡片只有 720/1400 宽、收起日志时垂直方向更是大片留白——用户在 2K/4K
   * 屏上看到的是一大块没有任何用途的空白区域。现在的取向是**窗口即内容**：
   *
   * - 开窗 = 紧凑档（够放下收起日志时的内容，见 SPLASH_WINDOW_SIZE）；
   * - 展开日志 = 壳把窗口调到展开档（SPLASH_WINDOW_SIZE_EXPANDED），页面只把
   *   「展开 / 收起」告诉壳（`set_splash_compact`），不自己写第二份尺寸常量；
   * - 两档都按当前显示器收敛（小屏不越界）；
   * - 窗口 `decorations: false`（无原生标题栏），最小化 / 关闭由启动页自身
   *   右上角的按钮提供。
   *
   * 改动三份启动页副本、tauri.conf.json 或 src-tauri/src/lib.rs 时先看这条。
   */
  const CONF = join(process.cwd(), "src-tauri", "tauri.conf.json");
  const LIB_RS = join(process.cwd(), "src-tauri", "src", "lib.rs");
  const SPLASH_COPIES = [
    join(process.cwd(), "src-tauri", "splash-assets", "splash.html"),
    join(process.cwd(), "src-tauri", "splash-assets", "index.html"),
    join(process.cwd(), "public", "splash.html"),
  ];

  const splashWindow = (): {
    label?: string;
    width: number;
    height: number;
    decorations?: boolean;
  } => {
    const conf = JSON.parse(readFileSync(CONF, "utf8")) as {
      app: {
        windows: {
          label?: string;
          width: number;
          height: number;
          decorations?: boolean;
        }[];
      };
    };
    const win =
      conf.app.windows.find((w) => w.label === "splash") ?? conf.app.windows[0];
    if (!win) throw new Error("tauri.conf.json 里没有窗口配置");
    return win;
  };

  /** 从 lib.rs 里取某个尺寸常量（`const NAME: (f64, f64) = (w, h);`）。 */
  const sizeConst = (rust: string, name: string): [number, number] => {
    const m = new RegExp(
      `const ${name}: \\(f64, f64\\) = \\((\\d+(?:\\.\\d+)?), (\\d+(?:\\.\\d+)?)\\);`,
    ).exec(rust);
    if (!m) throw new Error(`lib.rs 里没有常量 ${name}`);
    return [Number(m[1]), Number(m[2])];
  };

  it("splash 开窗是紧凑的一条，不铺满屏幕留空白", () => {
    const win = splashWindow();
    // 高度必须贴着「收起日志时的内容高度」（约 190px），而不是留出一大块空白：
    // 旧值 1680×1000 就是这块空白的来源（内容只占上面两百来像素）。
    expect(win.width).toBeLessThanOrEqual(900);
    expect(win.height).toBeLessThanOrEqual(280);
    expect(win.width).toBeGreaterThanOrEqual(640);
    // 紧凑档必须与壳里的常量一致，否则开窗和回落档会是两个尺寸
    const rust = readFileSync(LIB_RS, "utf8");
    const [compactWidth, compactHeight] = sizeConst(rust, "SPLASH_WINDOW_SIZE");
    expect(compactWidth).toBe(win.width);
    expect(compactHeight).toBe(win.height);
  });

  it("展开日志那一档够放下未折行的日志（旧的 1280 太窄）", () => {
    const rust = readFileSync(LIB_RS, "utf8");
    const [expandedWidth, expandedHeight] = sizeConst(
      rust,
      "SPLASH_WINDOW_SIZE_EXPANDED",
    );
    expect(expandedWidth).toBeGreaterThanOrEqual(1400);
    expect(expandedHeight).toBeGreaterThanOrEqual(700);
    // 紧凑档必须比展开档小，否则「两档」没有意义
    const [compactWidth, compactHeight] = sizeConst(rust, "SPLASH_WINDOW_SIZE");
    expect(compactWidth).toBeLessThan(expandedWidth);
    expect(compactHeight).toBeLessThan(expandedHeight);
  });

  it("窗口尺寸按显示器收敛，小屏上不会被推出屏幕外", () => {
    const rust = readFileSync(LIB_RS, "utf8");
    expect(rust).toContain("fn splash_window_size");
    // 必须真的取过显示器尺寸并用于收敛，而不是只写了个函数
    expect(rust).toContain("primary_monitor()");
    expect(rust).toContain("splash_window_size(app.handle())");
    // 展开档也要过同一条收敛路径
    expect(rust).toContain("fn clamp_to_monitor");
  });

  it("启动页自己提供最小化 / 关闭（窗口没有原生标题栏）", () => {
    const win = splashWindow();
    expect(win.decorations).toBe(false);
    const html = readFileSync(SPLASH_COPIES[0] ?? "", "utf8");
    // 页面里的两个按钮 + 壳侧的窗口动作都要在，缺一个就是「关不掉也缩不了」
    expect(html).toContain('id="btn-minimize"');
    expect(html).toContain('id="btn-close"');
    expect(html).toContain("minimize()");
    expect(html).toContain("close()");
    // 拖拽区与按钮分开：整条标题行可拖动，按钮不吞点击
    expect(html).toContain("-webkit-app-region: drag");
    expect(html).toContain("-webkit-app-region: no-drag");
  });

  it("三份启动页副本一致，且日志展开由壳统一调尺寸", () => {
    const texts = SPLASH_COPIES.map((p) => readFileSync(p, "utf8"));
    expect(new Set(texts).size).toBe(1);
    const html = texts[0];
    expect(html).toBeDefined();
    if (!html) return;
    // 页面只报「紧凑 / 展开」，尺寸常量只在壳里一份（避免两处常量漂移）
    expect(html).toContain("set_splash_compact");
    expect(html).not.toContain(".card.wide");
    const rust = readFileSync(LIB_RS, "utf8");
    expect(rust).toContain("fn set_splash_compact");
    // 新增应用命令要三处同步：build.rs / capabilities（否则运行期 not allowed by ACL）
    expect(readFileSync(join(process.cwd(), "src-tauri", "build.rs"), "utf8")).toContain(
      '"set_splash_compact"',
    );
    expect(
      readFileSync(join(process.cwd(), "src-tauri", "capabilities", "splash.json"), "utf8"),
    ).toContain('"allow-set-splash-compact"');
  });

  /**
   * 「窗口按钮点了没反应」的第一道闸：**按钮必须真的能调到窗口能力**。
   *
   * ISSUE #412 的第二次回报就是这个症状（最小化 / 关闭都没效果）。这类问题的
   * 成因不在按钮画得对不对，而在「点击之后调用了什么」：
   *
   * - 事件监听没绑上 / 被顶掉时，内联 onclick 仍要能把动作递出去；
   * - 壳过期（改了 src-tauri 没重编）时，Tauri window API 可能整块不可用，
   *   此时要有**应用自建命令**这条兜底（win_minimize / win_close，随壳一起走
   *   ACL 三处同步），并在都不可用时给出可见提示，而不是静默无反应；
   * - 拖拽区与按钮必须分开声明「别被拖拽吞掉点击」。
   *
   * 改动启动页按钮或壳命令时先看这条。
   */
  it("启动页的窗口按钮有内联兜底，不是只靠 addEventListener", () => {
    const html = readFileSync(SPLASH_COPIES[0] ?? "", "utf8");
    // 内联 onclick 是「脚本没跑到绑定」时的第二道；两条路必须汇到同一个入口
    expect(html).toContain("window.__splashWinAction");
    expect(html).toMatch(/onclick="window\.__splashWinAction && window\.__splashWinAction\('minimize'\)"/);
    expect(html).toMatch(/onclick="window\.__splashWinAction && window\.__splashWinAction\('close'\)"/);
    expect(html).toContain("performWinAction");
    // 按钮容器整体也不拖拽（个别按钮漏标 no-drag 时的第二层保险）
    const buttonsCss = html.slice(
      html.indexOf(".win-buttons {"),
      html.indexOf(".win-btn {"),
    );
    expect(buttonsCss).toContain("-webkit-app-region: no-drag");
  });

  it("窗口按钮有壳命令兜底，且命令三处同步", () => {
    const html = readFileSync(SPLASH_COPIES[0] ?? "", "utf8");
    expect(html).toContain("win_minimize");
    expect(html).toContain("win_close");
    // 失败必须可见：都调不通时给出提示，不许静默
    expect(html).toContain("noticeWindowAction");

    const rust = readFileSync(LIB_RS, "utf8");
    expect(rust).toContain("fn win_minimize");
    expect(rust).toContain("fn win_close");
    expect(rust).toContain("win_minimize,");
    expect(rust).toContain("win_close,");

    expect(readFileSync(join(process.cwd(), "src-tauri", "build.rs"), "utf8")).toContain(
      '"win_close"',
    );
    const splashCap = readFileSync(
      join(process.cwd(), "src-tauri", "capabilities", "splash.json"),
      "utf8",
    );
    expect(splashCap).toContain('"allow-win-close"');
    expect(splashCap).toContain('"allow-win-minimize"');
  });

  it("自绘启动器的窗口尺寸与启动页同值，且最小化不是空调用", () => {
    const py = readFileSync(
      join(process.cwd(), "scripts", "start_tauri_launcher.py"),
      "utf8",
    );
    const win = splashWindow();
    const w = Number(/^SPLASH_W = (\d+)/m.exec(py)?.[1]);
    const h = Number(/^SPLASH_H = (\d+)/m.exec(py)?.[1]);
    // 同一张「启动中」画面在本链路有两个实现（壳内嵌启动页 / 启动器 Win32 弹窗），
    // 尺寸各写一份就会改一处、两边不一致——这里盯死必须同值。
    expect(w).toBe(win.width);
    expect(h).toBe(win.height);

    // 置顶弹窗不会被 ShowWindow(SW_MINIMIZE) 最小化，必须走「隐藏 + 撤置顶」，
    // 且用定时器维持（否则其它逻辑一 ShowWindow 就把它翻回来）。
    expect(py).toContain("def _minimize");
    expect(py).toContain("def _keep_minimized");
    expect(py).toContain("SW_HIDE");
    expect(py).toMatch(/if self\._minimized:\s*\n\s*self\._keep_minimized\(\)/);
  });

  it("日志面板吃掉窗口剩余高度（展开后不是一条窄缝，也不留空白）", () => {
    const html = readFileSync(SPLASH_COPIES[0] ?? "", "utf8");
    const panel = html.slice(
      html.indexOf(".log-panel {"),
      html.indexOf(".log-panel pre"),
    );
    // 不再写死高度：面板 flex 撑满窗口剩余空间，窗口放大多少就显示多少行
    expect(panel).toContain("flex: 1 1 auto");
    expect(panel).not.toMatch(/height:\s*\d+px/);
    // 单行不折行 + 横向滚动必须保留，否则「加宽」会被折行悄悄取代
    expect(html).toContain("white-space: pre;");
    expect(html).toContain("overflow-x: auto;");
  });
});
