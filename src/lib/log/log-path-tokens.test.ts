/**
 * 日志行路径识别的判据用例。
 *
 * 首条断言直接用**用户贴图里那几行原文**（ISSUE #1365）：这些是本模块存在的理由，
 * 任何一条认不出来，「路径能点开」就是空话。其余按形状分组钉住边界 —— 尤其是
 * 「宁可漏」的那几档（相对路径、散文、除号分片），它们一旦被认成路径，用户点开
 * 会到一个「不是那里的文件夹」，比不可点更糟。
 */
import { describe, expect, it } from "vitest";

import { findLogPathTokens } from "./log-path-tokens";

/** 取出这一行里所有被认成路径的文本。 */
function paths(line: string): string[] {
  return findLogPathTokens(line).map((t) => t.text);
}

describe("日志行路径识别（ISSUE #1365 的用户原文）", () => {
  const ROOT = "F:\\AI\\Other\\comfy-app-t3-branch4";

  it("启动报告里的四行路径逐条认出，且不留尾随字符", () => {
    expect(paths(`项目根: ${ROOT}`)).toEqual([ROOT]);
    expect(paths(`编排脚本: ${ROOT}\\scripts\\dev-launcher.mjs`)).toEqual([
      `${ROOT}\\scripts\\dev-launcher.mjs`,
    ]);
    expect(paths(`启动状态文件: ${ROOT}\\run\\launch-status.json`)).toEqual([
      `${ROOT}\\run\\launch-status.json`,
    ]);
    expect(
      paths(`编排链路日志: ${ROOT}\\log\\launcher\\shell-launch.log`),
    ).toEqual([`${ROOT}\\log\\launcher\\shell-launch.log`]);
  });

  it("一行两段路径各认一段（逗号并列）", () => {
    expect(
      paths(
        `拉起到编排器: node ${ROOT}\\scripts\\dev-launcher.mjs --mode prebuilt （端口 3847, 来源: 按检出路径推导（3200~3999）, cwd ${ROOT}）`,
      ),
    ).toEqual([`${ROOT}\\scripts\\dev-launcher.mjs`, ROOT]);
  });

  it("引号里的 exe / ps1 不吃引号，也不吃后面的开关", () => {
    expect(
      paths(
        `>>> "C:\\Program Files\\PowerShell\\7\\pwsh.EXE" -NoProfile -ExecutionPolicy Bypass -File "D:\\Program Files\\nodejs\\pnpm.ps1" -v`,
      ),
    ).toEqual([
      "C:\\Program Files\\PowerShell\\7\\pwsh.EXE",
      "D:\\Program Files\\nodejs\\pnpm.ps1",
    ]);
  });

  it("收掉尾部句子标点（全角括号 + 句号两层）", () => {
    expect(paths("allowedRoot: /workspace/generated （见 §1.1）。")).toEqual([
      "/workspace/generated",
    ]);
    expect(paths("路径：F:\\a\\b.log。后面还有中文")).toEqual(["F:\\a\\b.log"]);
  });

  it("POSIX 形态与 UNC 形态都认", () => {
    expect(
      paths("  1) 壳侧编排链路（壳自己写的）：/workspace/log/launcher/x.log"),
    ).toEqual(["/workspace/log/launcher/x.log"]);
    expect(paths("resolved to \\\\server\\share\\dir\\x.log")).toEqual([
      "\\\\server\\share\\dir\\x.log",
    ]);
  });
});

describe("日志行路径识别：刻意漏的那几档", () => {
  it("相对路径不认（判不了相对谁，猜错会到别的文件夹）", () => {
    expect(paths("shell log: log/shell/shell.log")).toEqual([]);
    expect(paths("见 ./src/lib/log.ts 与 src/lib/log/log-store.ts:12")).toEqual(
      [],
    );
  });

  it("URL 里不切出裸路径段", () => {
    expect(
      paths("见 https://cnb.cool/moon-read/comfy-app-t3/-/issues/1365"),
    ).toEqual([]);
    expect(paths("http://127.0.0.1:3100/workspace/x")).toEqual([]);
  });

  it("除号分片不算路径（`/ 0 /` 这类写法在日志里很常见）", () => {
    expect(paths("count 1769 / 0 / 3")).toEqual([]);
    expect(paths("信息 1769 / 警告 0 / 错误 0")).toEqual([]);
  });

  it("POSIX 形态只有一段时不认", () => {
    expect(paths("progress 42% (12/29)")).toEqual([]);
    expect(paths("分隔符 / 与 \\ 都是硬字符")).toEqual([]);
  });

  it("纯散文一行不认", () => {
    expect(paths("阶段: 壳已接手（双击 app.exe）")).toEqual([]);
    expect(paths("保留 .next 缓存（首次启动：写入初始指纹）")).toEqual([]);
  });
});

describe("日志行路径识别：边界形状", () => {
  it("盘符 / UNC 起点把空格吃进来（Program Files 是一整段）", () => {
    expect(paths("at F:\\with space\\file name.txt")).toEqual([
      "F:\\with space\\file name.txt",
    ]);
  });

  it("POSIX 起点不吃空格（否则 `a and b`、并列路径会连成一段）", () => {
    expect(paths("paths: /a/b/c.log and /d/e/f.log")).toEqual([
      "/a/b/c.log",
      "/d/e/f.log",
    ]);
  });

  it("成对括号留给文件名，落单的右括号才裁", () => {
    expect(paths("installer at C:\\Program Files (x86)\\x.exe")).toEqual([
      "C:\\Program Files (x86)\\x.exe",
    ]);
    expect(paths("（日志：/var/log/app.log)")).toEqual(["/var/log/app.log"]);
  });

  it("尾随开关裁到路径为止（含 `--k=v` 与 `--k v` 两种写法）", () => {
    expect(paths("cmd F:\\a\\b\\d.mjs --mode prebuilt")).toEqual([
      "F:\\a\\b\\d.mjs",
    ]);
    expect(paths("cmd F:\\a\\b\\d.mjs --port=3847")).toEqual([
      "F:\\a\\b\\d.mjs",
    ]);
  });

  it("盘符根目录本身是合法路径（可以点开）", () => {
    /* `C:\` 两字符就是盘根，是真实存在的路径 —— 这里刻意**认**它：
     * 判据要的是「点开有意义」，盘根点开就是盘根。 */
    expect(paths("drive C:\\")).toEqual(["C:\\"]);
  });

  it("空格把普通词连进来时照样认（存在性由端点定案，不在这里猜）", () => {
    /* 这是「盘符形态吃空格」的代价：`C:\ then` 会被认成一段候选。它**故意**留到
     * 端点侧判 —— 那里能问文件系统「最长存在前缀是什么」，而这里只有文本。
     * 猜错的后果是用户点一下看到「路径不存在」的反馈（有出口、可纠正），
     * 而猜得过紧的后果是 `C:\Program Files\…` 被切成 `C:\Program`
     * —— 那是一段**看起来能点、点了什么都不是**的片段，更糟。 */
    expect(paths("drive C:\\ then")).toEqual(["C:\\ then"]);
  });

  it("回的是半开区间，切出来与 text 一致", () => {
    const line = `项目根: F:\\AI\\x`;
    for (const token of findLogPathTokens(line)) {
      expect(line.slice(token.start, token.end)).toBe(token.text);
    }
  });
});
