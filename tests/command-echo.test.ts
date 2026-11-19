/**
 * 回归护栏：脚本执行命令行必须能打出来（唯一出口 `launcher-core/command-echo.mjs`）。Windows 上
 * 「pnpm」被解析成哪种形态（shim / `.ps1` / `.cmd`）只能从命令行看出（ISSUE #576）。钉三件事：
 * 格式化、回显出口（`>>> ` 前缀、sink 可注入、可关）、接线（`runSync`/`spawnInGroup` 真打出来）。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { echoCommandLine, formatCommandLine } from "../scripts/launcher-core/command-echo.mjs";
import { runSync, spawnInGroup } from "../scripts/launcher-core/shell.mjs";

/** 捕获这段时间里写到 stdout 的全部文本（回显缺省就写 stdout）。 */
async function captureStdout(run: () => void | Promise<void>): Promise<string> {
  const chunks: Array<string> = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown): boolean => {
    chunks.push(String(chunk));
    return true;
  });
  try {
    await run();
  } finally {
    spy.mockRestore();
  }
  return chunks.join("");
}

/** 读 shell.mjs 的源码，剥掉行注释（注释里会引用函数名，判据只看代码）。 */
function shellSourceCode(): string {
  return fs
    .readFileSync(path.join(process.cwd(), "scripts", "launcher-core", "shell.mjs"), "utf8")
    .split("\n")
    .map((line) => line.replace(/^\s*\/\/.*$/, ""))
    .join("\n");
}

/** 取某个导出函数的函数体（到下一个 `export function` 为止）。 */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`export function ${name}(`);
  expect(start, `shell.mjs 里找不到 ${name}`).toBeGreaterThan(-1);
  const rest = source.slice(start + 1);
  const next = rest.indexOf("\nexport function ");
  return next === -1 ? rest : rest.slice(0, next);
}

describe("命令行回显：格式化", () => {
  it("普通参数不加引号（可整行复制粘贴）", () => {
    expect(formatCommandLine("pnpm", ["exec", "vitest", "run"])).toBe("pnpm exec vitest run");
  });

  it("含空白 / shell 元字符的参数才加引号", () => {
    expect(formatCommandLine("node", [String.raw`C:\Program Files\nodejs\node.exe`])).toBe(
      String.raw`node "C:\Program Files\nodejs\node.exe"`,
    );
    expect(formatCommandLine("git", ["commit", "-m", "a b;c"])).toBe('git commit -m "a b;c"');
  });

  it('空参数不丢（写成 ""，否则命令行会少一个位置参数）', () => {
    expect(formatCommandLine("git", ["commit", "-m", ""])).toBe('git commit -m ""');
  });

  it("参数里的双引号转义，且输出保持单行", () => {
    const line = formatCommandLine("say", ['a"b c']);
    expect(line).toBe(String.raw`say "a\"b c"`);
    // 回显是「一行一条命令」：日志与终端都按行读，格式化的结果里不该出现换行
    expect(line).not.toContain("\n");
  });
});

describe("命令行回显：输出出口", () => {
  it("打印 `>>> ` 前缀，并返回该行", () => {
    const lines: Array<string> = [];
    const line = echoCommandLine("pnpm", ["install"], {
      sink: (text) => lines.push(text),
    });
    expect(line).toBe(">>> pnpm install");
    expect(lines).toEqual([">>> pnpm install\n"]);
  });

  it("可加短标记（同一命令在不同位置有不同角色时用）", () => {
    const lines: Array<string> = [];
    echoCommandLine("app.exe", ["--mode", "prebuilt"], {
      label: "桌面壳",
      sink: (text) => lines.push(text),
    });
    expect(lines[0]).toBe(">>> [桌面壳] app.exe --mode prebuilt\n");
  });

  it("COMFYAPP_ECHO_COMMANDS=0 时整体静默（给机器解析输出的场景留出口）", () => {
    const lines: Array<string> = [];
    const line = echoCommandLine("pnpm", ["install"], {
      sink: (text) => lines.push(text),
      env: { COMFYAPP_ECHO_COMMANDS: "0" },
    });
    expect(line).toBeNull();
    expect(lines).toEqual([]);
  });
});

describe("命令行回显：执行出口真的接上了", () => {
  it("runSync 起命令前先回显命令行", async () => {
    const out = await captureStdout(() => {
      runSync(process.execPath, ["-e", "0"]);
    });
    expect(out).toContain(">>> ");
    expect(out).toContain(formatCommandLine(process.execPath, ["-e", "0"]));
  });

  it("spawnInGroup 起长驻进程前先回显命令行", async () => {
    const out = await captureStdout(async () => {
      const child = spawnInGroup({
        command: process.execPath,
        args: ["-e", "0"],
        cwd: process.cwd(),
      });
      await new Promise((resolve) => child.on("exit", resolve));
    });
    expect(out).toContain(formatCommandLine(process.execPath, ["-e", "0"]));
  });

  /**
   * `runPnpmSync` 不在这里真跑 pnpm：单测里起一次真实包管理器既慢又依赖 PATH 上的
   * 形态，而这条出口要保证的只是「**所有**执行出口都接了回显」。于是按源码判据
   * （与 dev.mjs 的那条用例同口径）逐函数核对，成本几乎为零。
   */
  it("shell.mjs 的每个执行出口都调用了回显", () => {
    const code = shellSourceCode();
    for (const name of ["spawnInGroup", "runSync", "runPnpmSync"]) {
      expect(
        functionBody(code, name),
        `${name} 没有回显命令行 —— 这条出口执行的命令又变成看不见的了`,
      ).toContain("echoCommandLine(");
    }
  });
});
