import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  allPresets,
  CONSOLE_PRESETS,
  parseConsoleLine,
  shellSyntaxWarning,
} from "./console-catalog";
import { MAX_COMMAND_CHARS } from "./console-limits";

describe("parseConsoleLine", () => {
  it("按空格拆成 file + args，不经过 shell", () => {
    expect(parseConsoleLine("pnpm exec tsc --noEmit")).toEqual({
      ok: true,
      file: "pnpm",
      args: ["exec", "tsc", "--noEmit"],
      display: "pnpm exec tsc --noEmit",
    });
  });

  it("支持单/双引号把空格留在同一个参数里", () => {
    expect(parseConsoleLine(`echo "a b" 'c d'`)).toEqual({
      ok: true,
      file: "echo",
      args: ["a b", "c d"],
      display: "echo a b c d",
    });
  });

  it("反斜杠转义空格", () => {
    const parsed = parseConsoleLine("echo a\\ b");
    expect(parsed.ok && parsed.args).toEqual(["a b"]);
  });

  it("空引号是一个合法空参数（不是「什么都没有」）", () => {
    const parsed = parseConsoleLine("echo ''");
    expect(parsed.ok && parsed.args).toEqual([""]);
  });

  it("双引号里的转义引号", () => {
    const parsed = parseConsoleLine('echo "say \\"hi\\""');
    expect(parsed.ok && parsed.args).toEqual(['say "hi"']);
  });

  it("不把 ; | > & 当语法：它们只是普通字符（要那类语义请写脚本）", () => {
    const parsed = parseConsoleLine("echo a; rm -rf /");
    expect(parsed.ok && parsed.file).toBe("echo");
    // 全部当成普通参数：没有任何分隔符被解释。
    expect(parsed.ok && parsed.args).toEqual(["a;", "rm", "-rf", "/"]);
  });

  it("空 / 全空白 / 只有引号开头，各自给出可读理由", () => {
    expect(parseConsoleLine("")).toEqual({ ok: false, reason: "命令为空" });
    expect(parseConsoleLine("   ")).toEqual({ ok: false, reason: "命令为空" });
    const unclosed = parseConsoleLine('echo "未闭合');
    expect(unclosed.ok).toBe(false);
    expect(!unclosed.ok && unclosed.reason).toContain("引号未闭合");
  });

  it("多段空白不产生空参数", () => {
    const parsed = parseConsoleLine("  pnpm   run    lint  ");
    expect(parsed.ok && parsed.args).toEqual(["run", "lint"]);
  });
});

describe("预设命令表", () => {
  it("id 全局唯一（界面上「填入」按钮按它索引）", () => {
    const ids = allPresets().map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("分组 id 唯一且每组都有内容", () => {
    const ids = CONSOLE_PRESETS.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const group of CONSOLE_PRESETS) {
      expect(group.items.length).toBeGreaterThan(0);
    }
  });

  it("每条预设都能被解析器拆开（预设本身必须是合法命令行）", () => {
    for (const preset of allPresets()) {
      const parsed = parseConsoleLine(preset.command);
      expect(parsed.ok, `预设 ${preset.id} 解析失败：${preset.command}`).toBe(
        true,
      );
    }
  });

  it("预设长度都在输入框上限内", () => {
    for (const preset of allPresets()) {
      expect(preset.command.length).toBeLessThanOrEqual(MAX_COMMAND_CHARS);
    }
  });

  it("预设只走本仓真实存在的入口（pnpm / git / node），不用 npx（硬规则 1）", () => {
    for (const preset of allPresets()) {
      const parsed = parseConsoleLine(preset.command);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) continue;
      expect(["pnpm", "node", "git"]).toContain(parsed.file);
      expect(preset.command).not.toMatch(/\bnpx\b/);
      expect(preset.command).not.toMatch(/\bnpm run\b/);
    }
  });

  it("预设里不出现 shell 控制符（解析器不解释它们，写进去就是一条跑不对的命令）", () => {
    /* 判据是**这一条坑真的踩过**：`node -v && pnpm -v` 在解析器眼里是
     * `node` 带上 `-v` `&&` `pnpm` `-v` 四个参数 —— node 会报「找不到模块 &&」，
     * 而界面上它长得完全正常。预设是给人点的，点下去必须真的跑通。 */
    /* 软断言：逐条预设各自独立 —— 一次把**所有**带控制符的预设都报出来，
       而不是修一条、再发现有下一条（§11.18）。 */
    for (const preset of allPresets()) {
      expect
        .soft(preset.command, `预设 ${preset.id} 含 shell 控制符`)
        .not.toMatch(/[;|&><]|\$\{?\w|%\(/);
    }
  });

  it("预设里的 pnpm 脚本都真的在 package.json 里（防「按钮点了报错」）", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(process.cwd(), "package.json"), "utf-8"),
    ) as { scripts: Record<string, string> };
    const scriptNames = new Set(Object.keys(pkg.scripts));
    for (const preset of allPresets()) {
      const parsed = parseConsoleLine(preset.command);
      if (!parsed.ok) continue;
      if (parsed.file !== "pnpm") continue;
      // `pnpm run <name>` / `pnpm <name>` 两种形态都取到 <name>。
      const target = parsed.args[0] === "run" ? parsed.args[1] : parsed.args[0];
      /* `pnpm exec tsc` 这类是直接跑二进制，不是脚本名 —— 只有 `run` 形态
       * 与「裸脚本名」两种才要求在 scripts 里。 */
      if (parsed.args[0] === "exec") continue;
      expect(
        scriptNames.has(target ?? ""),
        `预设 ${preset.id} 指向的脚本 "${target}" 不在 package.json 里`,
      ).toBe(true);
    }
  });
});

describe("shellSyntaxWarning", () => {
  it("点出命中的具体片段（一句泛泛的「含特殊字符」用户不知道改哪）", () => {
    const warning = shellSyntaxWarning("node -v && pnpm -v");
    expect(warning).toContain("&");
    expect(warning).toContain("不经过 shell");
  });

  it("逐类控制符都能认出来", () => {
    for (const line of [
      "a ; b",
      "a | b",
      "a > out.txt",
      "a < in.txt",
      "a & b",
      "echo `date`",
      "echo $(date)",
      "echo ${HOME}",
      "echo %PATH%",
    ]) {
      expect(shellSyntaxWarning(line), line).not.toBeNull();
    }
  });

  it("单个 %H 不算变量展开（`git log --format=%H` 是正当用法）", () => {
    expect(shellSyntaxWarning("git log --format=%H -3")).toBeNull();
  });

  it("普通命令不误报", () => {
    for (const line of [
      "pnpm exec tsc --noEmit",
      "pnpm test",
      "git status -sb",
      'node -e "process.exit(0)"',
      "",
      "   ",
    ]) {
      expect(shellSyntaxWarning(line), line).toBeNull();
    }
  });

  it("同一种片段只点名一次", () => {
    const warning = shellSyntaxWarning("a && b && c");
    expect(warning?.match(/&/g)?.length).toBeLessThanOrEqual(3);
  });
});
