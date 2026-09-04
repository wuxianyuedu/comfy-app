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
});
