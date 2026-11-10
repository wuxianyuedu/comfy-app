/**
 * 「构建日志乱码」那一格的判断面（ISSUE #1959 / #1966）：自托管 Windows 节点上本机打的非 ASCII 在平台日志里是乱码——runner 日志里 `宸ュ叿閾捐嚜璇侀€氳繃` 按 UTF-8 取字节再按 GBK 解正好回到 `工具链自证通过`。2026-10-16 两轮探针之间换了控制台代码页 936→65001 与宿主 ANSI 代码页、乱码一字未变，而同日志里 runner 自己打的行完好 ⇒ 解码发生在**子进程输出那一跳**、用不与宿主联动的 CP936；这正是为什么要把 ACP 也量出来。
 * **不能**判「日志里到底有没有乱码」（解码在本进程之外），能判的只有读数（控制台输出代码页 / 宿主 ANSI 代码页 / `chcp` 原文）与纠正动作（`applyConsoleEncoding`）是否真把读数改到 UTF-8——本文件判的就是这两件。
 * 三条边界（与实现同口径）：非 Windows 不是失败（无处可设，读数是 `null`）；「没量到」不是「量到的是错的」（`null` 回 `null`，不许当 false）；纠正失败不阻断（编码不对只让日志难读，不会让哪一步算错，所以函数如实返回结论、调用方只打印）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  applyConsoleEncoding,
  codePageIsUtf8,
  readConsoleEncoding,
  UTF8_CODE_PAGE,
} from "../scripts/ci-console-encoding.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("控制台输出编码：读数（只读，不改任何东西）", () => {
  it("非 Windows 宿主回「没量到」而不是假装量到了", () => {
    expect(readConsoleEncoding({ platform: "linux" })).toEqual({
      codePage: null,
      chcpRaw: null,
      ansiCodePage: null,
    });
  });

  it("宿主 ANSI 代码页单独带标签读 —— 不与 `chcp` 那一行里的数字撞车", () => {
    const now = readConsoleEncoding({
      platform: "win32",
      runImpl: () => ({
        status: 0,
        out: "65001\nACP=65001\nActive code page: 65001",
      }),
    });
    expect(now.codePage).toBe(65_001);
    expect(now.ansiCodePage).toBe(65_001);
    expect(now.chcpRaw).toBe("Active code page: 65001");
  });

  it("量不到 ACP 时说「没量到」，不拿控制台代码页顶替", () => {
    /* 夹具就是实测过的形态：老读数的输出里没有 ACP 那一行。 */
    const now = readConsoleEncoding({
      platform: "win32",
      runImpl: () => ({ status: 0, out: "936\n活动代码页: 936" }),
    });
    expect(now.codePage).toBe(936);
    expect(now.ansiCodePage).toBeNull();
  });

  it("中文 Windows 的读数：CP936 —— 判成「非 UTF-8」（这就是乱码的成因）", () => {
    const now = readConsoleEncoding({
      platform: "win32",
      runImpl: () => ({ status: 0, out: "936\n活动代码页: 936" }),
    });
    expect(now.codePage).toBe(936);
    expect(now.chcpRaw).toBe("活动代码页: 936");
    expect(codePageIsUtf8(now.codePage)).toBe(false);
  });

  it("已钉成 UTF-8 时判成「对」", () => {
    const now = readConsoleEncoding({
      platform: "win32",
      runImpl: () => ({ status: 0, out: "65001\nActive code page: 65001" }),
    });
    expect(codePageIsUtf8(now.codePage)).toBe(true);
  });

  it("探测失败 / 输出里没有数字 ⇒ codePage 为 null（不知道 ≠ 不合格）", () => {
    expect(
      readConsoleEncoding({
        platform: "win32",
        runImpl: () => ({ status: 1, out: "" }),
      }).codePage,
    ).toBeNull();
    expect(
      readConsoleEncoding({
        platform: "win32",
        runImpl: () => ({ status: 0, out: "无法识别的命令" }),
      }).codePage,
    ).toBeNull();
    /* 三档取值分得开：`null` 既不等于 true 也不等于 false。 */
    expect(codePageIsUtf8(null)).toBeNull();
  });
});

describe("控制台输出编码：纠正动作", () => {
  it("目标代码页只有一处定义，且它就是 UTF-8", () => {
    expect(UTF8_CODE_PAGE).toBe(65_001);
  });

  it("钉成功时如实报成功（按**复核后的读数**判，不采信命令退出码）", () => {
    const applied = applyConsoleEncoding({
      platform: "win32",
      runImpl: () => ({ status: 0, out: "65001" }),
    });
    expect(applied.applied).toBe(true);
    expect(applied.detail).toContain("65001");
  });

  it("命令退 0 但读数没变 ⇒ **不**报成功（复验与执行是两件事）", () => {
    const applied = applyConsoleEncoding({
      platform: "win32",
      /* 这一档是实测过的形态：安装 / 设置类命令退 0 不等于结果落地。 */
      runImpl: () => ({ status: 0, out: "936" }),
    });
    expect(applied.applied).toBe(false);
    expect(applied.detail).toContain("936");
  });

  it("非 Windows 只说「无处可设」，不当成失败", () => {
    const applied = applyConsoleEncoding({ platform: "darwin" });
    expect(applied.applied).toBe(false);
    expect(applied.detail).toContain("非 Windows");
  });
});

describe("控制台输出编码：流水线上真的在纠它", () => {
  /** 取某个锚点（`.gates` / `.daily-gates`）里**第一格**的正文（从它的 `- name:` 到下一格之前）。 */
  const firstStageBody = (yml: string, anchor: RegExp) => {
    const at = yml.search(anchor);
    expect(at, `找不到锚点 ${anchor} —— 这条判据没有对象了`).toBeGreaterThan(-1);
    const tail = yml.slice(at);
    const start = tail.search(/^ {2}- name:/m);
    expect(start, `${anchor} 下面一格都没有`).toBeGreaterThan(-1);
    const rest = tail.slice(start);
    const next = rest.slice(1).search(/^ {2}- name:/m);
    return next < 0 ? rest : rest.slice(0, next + 1);
  };

  it("（#3504 反向登记）自托管执行面已整体退役：`.daily-gates` 锚与编码纠偏命令都不许回来", () => {
    /* #3504 起构建执行全在 GA（Linux runner，无宿主代码页问题）；CNB 侧剩余的格
     * 全跑在平台池 Linux 容器里。`.daily-gates` 锚点与 `--apply` 命令随执行面退役
     * —— 谁把自托管 Windows 执行格加回 `.cnb.yml`，就把本条的**正向**判据
     * （第一格先钉 `[Console]::OutputEncoding`，#1959）一起接回来。 */
    const yml = read(".cnb.yml");
    expect(
      yml,
      "`.daily-gates` 锚点回来了 —— 自托管执行清单随 #3504 退役，见 no-platform 台账",
    ).not.toMatch(/^\.daily-gates:/m);
    /* 只看执行面：剥掉整行注释再判 —— `.cnb.yml` 的历史读数注释里**提到**脚本名
     * （规范 §13.5.3.5 的出处指引）不算执行者，反向登记管的是 `script:` 命令。 */
    const code = yml
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("#"))
      .join("\n");
    expect(
      code,
      "`.cnb.yml` 又在执行 ci-console-encoding --apply —— 编码纠偏的执行面已随 #3504 退役",
    ).not.toContain("ci-console-encoding.mjs");
  });

  it("纠编码脚本留盘（本地开发仍用），但配置里没有它的执行者", () => {
    expect(read("scripts/ci-console-encoding.mjs").length, "脚本留盘").toBeGreaterThan(0);
    const code = read(".cnb.yml")
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("#"))
      .join("\n");
    expect(code).not.toContain("ci-console-encoding");
  });

  it("平台池侧（质量门禁主列）：第一格的 script 不许带 PowerShell 编码前缀", () => {
    /* 它在 Linux 上会被 sh 拆碎当场退 127（与 no-platform-ci-config 的质量门禁段
     * 同一组判据）。#3504 起 `.gates` 里只剩回读格（Linux 容器），这一形态照旧成立。 */
    const gatesLines = firstStageBody(read(".cnb.yml"), /^\.gates:[^\n]*$/m)
      .split("\n")
      .filter((l) => l.trim() !== "");
    const gatesScript = gatesLines.find((l) => /^\s+script:/.test(l)) ?? "";
    expect(
      gatesScript,
      "`.gates` 第一格（平台池）带上了 PowerShell 编码前缀 —— sh 会当场退 127",
    ).not.toContain("[Console]::OutputEncoding");
  });

  it("「环境前提」把读数打出来（每一跑都能读到代码页，不靠人去猜）", () => {
    const probe = read("scripts/ci-env-probe.mjs");
    expect(probe).toContain("readConsoleEncoding");
    expect(probe).toContain("codePageIsUtf8");
    /* 话术里必须给**下一动作**（与 §13.5.3.5.1「红了要红在能指路的位置」同口径）。 */
    expect(probe).toContain("--apply");
    /* 这里断言的是「话术里印了 UTF-8 字样」，不是编码参数；用正则避开
     * unicorn/text-encoding-identifier-case 对编码字面量的改写。 */
    expect(probe).toMatch(/UTF-8/);
  });
});
