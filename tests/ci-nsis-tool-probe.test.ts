/**
 * 桌包档 NSIS 工具现场读数（ISSUE #3297）：钉的不是「修没修好」，而是
 * 「只加读数、不改判据、不猜修法」这一格本身别静默失效：
 *   · 恒退 0（读数不是判据，量不到也只如实记「没量到」）；
 *   · 三问都在（ensure 侧 LOCALAPPDATA / bundler 侧 known folder / 两处
 *     makensis.exe 真跑一次 + 整树文件数），且 known folder 不读环境变量；
 *   · 两处同值与不同值都要打得出，别把「不同值」吞成一句笼统结论。
 */
import { describe, expect, it } from "vitest";

import {
  formatTree,
  nsisToolProbe,
  probeScript,
  readProbe,
  sameWindowsPath,
} from "../scripts/ci-nsis-tool-probe.mjs";

/** 收走一次运行的全部读数行。 */
function capture(lines: Array<string>) {
  return (line: string) => lines.push(line);
}

/** 一份 PowerShell 现场回读（形状与 probeScript 的 ConvertTo-Json 输出同源）。 */
function probeData(overrides: Record<string, unknown> = {}) {
  const tree = {
    exists: true,
    length: 700_416,
    treeCount: 442,
    versionExit: 0,
    versionOut: "v3.13",
    aclOwner: String.raw`NT AUTHORITY\SYSTEM`,
    requiredMissing: [],
  };
  return {
    knownLocalAppData: String.raw`C:\WINDOWS\system32\config\systemprofile\AppData\Local`,
    knownNsis: String.raw`C:\WINDOWS\system32\config\systemprofile\AppData\Local\tauri\NSIS`,
    account: String.raw`NT AUTHORITY\SYSTEM`,
    ensure: { ...tree },
    known: { ...tree },
    ...overrides,
  };
}

describe("probeScript（三问一次量，known folder 不读环境变量）", () => {
  it("把 ensure 侧落点、NSIS_PLAN 的必需件与 cacheRel 交给 PowerShell", () => {
    const s = probeScript({ ensureDir: String.raw`G:\la\tauri\NSIS` });
    expect(s).toContain("ConvertFrom-Json");
    /* JSON.stringify 把 Windows 路径里的反斜杠转义成 `\\`，所以这里判的是
     * 转义后仍可辨认的那一段，而不是原始盘符串（那串在 PS 单引号里本来也长这样）。 */
    expect(s).toContain(String.raw`la\\tauri\\NSIS`);
    expect(s).toContain("makensis.exe");
    expect(s).toContain("/VERSION");
    expect(s).toContain("Get-ChildItem");
    expect(s).toContain("Get-Acl");
    expect(s).toContain("WindowsIdentity");
  });

  it("known folder 由 GetFolderPath 现算，脚本里没有把 known 落点当参数传", () => {
    const s = probeScript({ ensureDir: null });
    expect(s).toContain("[Environment]::GetFolderPath('LocalApplicationData')");
    expect(s).toContain("Join-Path $knownLocal 'tauri'");
    /* 反例：Node 侧若把 known 落点拼好传进来，就等于替 bundler 猜了一次。 */
    expect(s).not.toContain("LOCALAPPDATA");
  });
});

describe("readProbe（宿主回退 / JSON 解析 / 量不到不冒充结论）", () => {
  it("pwsh 回了对象 JSON 就用它，不再试 powershell", () => {
    const calls: Array<string> = [];
    const r = readProbe("(无关)", {
      run: (cmd) => {
        calls.push(cmd);
        return { status: 0, stdout: JSON.stringify(probeData()) };
      },
    });
    expect(r.ok).toBe(true);
    expect(r.data?.account).toBe(String.raw`NT AUTHORITY\SYSTEM`);
    expect(calls).toEqual(["pwsh"]);
  });

  it("pwsh 起不来时回退 powershell", () => {
    const calls: Array<string> = [];
    const r = readProbe("(无关)", {
      run: (cmd) => {
        calls.push(cmd);
        return cmd === "pwsh"
          ? { status: null, stdout: "", error: new Error("ENOENT") }
          : { status: 0, stdout: JSON.stringify(probeData()) };
      },
    });
    expect(r.ok).toBe(true);
    expect(calls).toEqual(["pwsh", "powershell"]);
  });

  it("非 JSON / 空读数都落成 ok=false（不抛、不猜）", () => {
    expect(readProbe("(无关)", { run: () => ({ status: 0, stdout: "不是 JSON" }) }).ok).toBe(false);
    expect(readProbe("(无关)", { run: () => ({ status: 0, stdout: "" }) }).ok).toBe(false);
  });
});

describe("nsisToolProbe（恒退 0 + 读数可读）", () => {
  it("非 Windows 宿主只留 ensure 侧读数并退 0", () => {
    const lines: Array<string> = [];
    const code = nsisToolProbe({
      platform: "linux",
      env: { LOCALAPPDATA: String.raw`G:\la` },
      log: capture(lines),
    });
    expect(code).toBe(0);
    expect(lines.join("\n")).toContain(String.raw`ensure 侧 %LOCALAPPDATA%=G:\la`);
    expect(lines.join("\n")).toContain("非 Windows 宿主");
    expect(lines.join("\n")).toContain("结论=没量到");
  });

  it("Windows + 两处同值：三问都在，且明确打成「是」", () => {
    const lines: Array<string> = [];
    const code = nsisToolProbe({
      platform: "win32",
      env: {
        LOCALAPPDATA: String.raw`C:\WINDOWS\system32\config\systemprofile\AppData\Local`,
      },
      run: () => ({ status: 0, stdout: JSON.stringify(probeData()) }),
      log: capture(lines),
    });
    const out = lines.join("\n");
    expect(code).toBe(0);
    expect(out).toContain("ensure 侧 %LOCALAPPDATA%=");
    expect(out).toContain("bundler known folder LocalApplicationData=");
    expect(out).toContain(String.raw`bundler 侧 tauri\NSIS 落点=`);
    expect(out).toContain("两处落点是否同值=是");
    expect(out).toContain("ensure 侧 makensis.exe");
    expect(out).toContain("bundler 侧 makensis.exe");
    /* 评论补的两条：真跑 /VERSION + 独立数整树，不是只 Test-Path。 */
    expect(out).toContain("/VERSION exit=0·输出=v3.13");
    expect(out).toContain("整树文件数=442");
  });

  it("Windows + 两处不同值：明确打成「否」，不吞成笼统结论", () => {
    const lines: Array<string> = [];
    const code = nsisToolProbe({
      platform: "win32",
      env: { LOCALAPPDATA: String.raw`G:\elsewhere` },
      run: () => ({ status: 0, stdout: JSON.stringify(probeData()) }),
      log: capture(lines),
    });
    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("两处落点是否同值=**否**");
  });

  it("PowerShell 没量到也恒退 0，并如实记「没量到」", () => {
    const lines: Array<string> = [];
    const code = nsisToolProbe({
      platform: "win32",
      env: { LOCALAPPDATA: String.raw`G:\la` },
      run: () => ({ status: null, stdout: "", error: new Error("起不来") }),
      log: capture(lines),
    });
    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("现场 PowerShell 没量到");
    expect(lines.join("\n")).toContain("结论=没量到");
  });

  it("LOCALAPPDATA 没设：ensure 侧问不出也不崩", () => {
    const lines: Array<string> = [];
    const code = nsisToolProbe({
      platform: "win32",
      env: {},
      run: () => ({ status: 0, stdout: JSON.stringify(probeData()) }),
      log: capture(lines),
    });
    expect(code).toBe(0);
    expect(lines.join("\n")).toContain(String.raw`ensure 侧 tauri\NSIS 落点=(问不出)`);
  });
});

describe("sameWindowsPath（与 host 平台无关，NTFS 语义）", () => {
  it("斜杠形态不同仍同值", () => {
    expect(sameWindowsPath(String.raw`C:\la\tauri\NSIS`, "C:/la/tauri/NSIS")).toBe(true);
  });
  it("大小写 / 尾部分隔符不同仍同值", () => {
    expect(sameWindowsPath(String.raw`C:\LA\tauri\NSIS`, String.raw`c:\la\tauri\nsis`)).toBe(true);
  });
  it("真不同值判否", () => {
    expect(sameWindowsPath(String.raw`G:\elsewhere\tauri\NSIS`, String.raw`C:\la\tauri\NSIS`)).toBe(
      false,
    );
  });
});

describe("formatTree（字段缺了也整行给得出）", () => {
  it("空对象不抛，缺字段落成 ?", () => {
    const line = formatTree("x", {});
    expect(line).toContain("Test-Path=?");
    expect(line).toContain("整树文件数=?");
  });

  it("缺必需件逐件点名，没有时写「(无)」", () => {
    expect(formatTree("x", { requiredMissing: ["makensis.exe", "Include/MUI2.nsh"] })).toContain(
      "缺必需件=makensis.exe, Include/MUI2.nsh",
    );
    expect(formatTree("x", { requiredMissing: [] })).toContain("缺必需件=(无)");
  });
});
