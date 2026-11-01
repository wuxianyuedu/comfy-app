/**
 * 「构建日志乱码」那一格的判断面（ISSUE #1959 / #1966）。
 *
 * ## 它守的是什么
 *
 * 自托管 Windows 节点上，本机打的非 ASCII 字符在平台日志里是乱码。这不是推断，
 * 是从构建产物里逐字节复算出来的：下载那一跑的 runner 日志，把 `宸ュ叿閾捐嚜璇侀€氳繃`
 * 按 UTF-8 取字节再按 GBK 解，正好回到 `工具链自证通过`；末尾那个 `?` 是 `✓`
 * （U+2713，UTF-8 三字节 `E2 9C 93`）被 CP936 解出 `鉁` 之后剩下的孤字节。
 * 同一份日志里 PowerShell 自己打的 `Set-Variable : 缺少参数…` 却是完好中文 ——
 * 两个方向的对照都在，所以「谁按什么编码解码」是可判的。
 *
 * ⚠️ **但「解码端是谁」最开始判错了：它被写成「宿主 ANSI 代码页」，而那句 2026-10-16
 * 被两轮探针改写了**（`工具链自证` 里 PS 原生 / cmd / node 三层各吐一行中文）：
 * 两轮**逐字相同**，而两轮之间那台机器换过**两样**东西 —— 控制台输出代码页 936 → 65001、
 * 宿主 ANSI 代码页也换成了 UTF-8（勾了「使用 Unicode UTF-8 提供全球语言支持」并重启）。
 * 换了两次、乱码一个字没变 ⇒ 解码端**与这两个设置都不是同一件事**；而同一份日志里
 * **runner 自己打的行（`script` 原文回显）是完好中文**、子进程输出的每一行都是
 * 「UTF-8 按 CP936 解」⇒ 解码发生在**子进程输出那一跳**，用的是**不与宿主联动的 CP936**。
 * 这正是本文件为什么要**把 ACP 也量出来**：不量到它，就别想否掉它。
 *
 * ## 这里能判什么、不能判什么
 *
 * **不能**判「日志里到底有没有乱码」—— 解码发生在本进程之外，本进程看不到自己的字节
 * 被怎么解。能被机器判的只有**几个读数**（控制台输出代码页 / 宿主 ANSI 代码页 /
 * `chcp` 原文），以及纠正动作（`applyConsoleEncoding`）有没有真的把读数改到 UTF-8。
 * 本文件判的就是这两件。
 *
 * ## 三条边界（与实现同口径）
 *
 *   · **非 Windows 不是失败**：那里控制台输出编码无处可设，读数是 `null`；
 *   · **「没量到」不是「量到的是错的」**：`null` 回 `null`，不许当成 false；
 *   · **纠正失败不阻断**：编码不对只让日志难读，不会让哪一步算错，
 *     所以 `applyConsoleEncoding()` 如实返回结论、调用方只打印。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/* 每个 stage 现在外面都包着 `ci-cp936-exit.mjs`（ISSUE #1977 的 CP936 出口），
 * 下面那两条「命令调用行」的判据要剥掉它才认得出被包的那条命令。 */
import { unwrapCp936 } from "../scripts/ci-cp936-exit.mjs";
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
    expect(at, `找不到锚点 ${anchor} —— 这条判据没有对象了`).toBeGreaterThan(
      -1,
    );
    const tail = yml.slice(at);
    const start = tail.search(/^ {2}- name:/m);
    expect(start, `${anchor} 下面一格都没有`).toBeGreaterThan(-1);
    const rest = tail.slice(start);
    const next = rest.slice(1).search(/^ {2}- name:/m);
    return next < 0 ? rest : rest.slice(0, next + 1);
  };

  it("每条流水线的**第一格**自己就把控制台编码钉住（在它打任何中文之前）", () => {
    /* 这一条原来钉的是「第一步 = `工具链自证`」，而那句纠编码写在那一格里。
     * 2026-10-19 那一格撤到每日档（只判节点事实的格子不必每个 PR 都判）之后，
     * PR 的第一格换成了 `镜像身份` —— 于是它红的方向是**名字**，不是危险本身。
     *
     * 危险不变的那半是：第一个 stage 之前没有任何人钉过 `[Console]::OutputEncoding`，
     * 它打的每一行非 ASCII 都会按宿主代码页（中文 Windows 是 CP936）落进平台日志
     * （ISSUE #1959 的 `宸ュ叿閾捐嚜璇?` 就是这么来的）。所以按**位置**问，不按名字问：
     * 每条流水线的第一个 stage，自己的 script 必须在任何输出之前先钉编码 ——
     * 与那一格叫什么、挂在哪个触发口都无关，下一次再挪档它不会变成假红。 */
    const yml = read(".cnb.yml");
    for (const anchor of [/^\.gates:[^\n]*$/m, /^\.daily-gates:[^\n]*$/m]) {
      const lines = firstStageBody(yml, anchor)
        .split("\n")
        .filter((l) => l.trim() !== "");
      const scriptAt = lines.findIndex((l) => /^\s+script:/.test(l));
      expect(scriptAt, `锚点 ${anchor} 的第一格没有 script 行`).toBeGreaterThan(
        -1,
      );
      /* 两种形态都要认：单行 `script: $enc=…; node …`，与块标量 `script: |` 之后的第一行。 */
      const scriptLine = lines[scriptAt] ?? "";
      const isBlock = scriptLine.trim() === "script: |";
      const firstStatement =
        lines[scriptAt + (isBlock ? 1 : 0)] ?? "";
      expect(
        firstStatement,
        `锚点 ${anchor} 的第一格在打中文之前没钉 [Console]::OutputEncoding：${
          firstStatement.trim().slice(0, 90)}`,
      ).toContain("[Console]::OutputEncoding");
    }
  });

  it("纠编码那句仍在**它所在的那一格**里，且排在会打中文的命令之前", () => {
    /* 名字不写死（上面那条管位置、这条管顺序）：判的是「`--apply` 与
     * `ci-toolchain-selfcheck` 同一格，且 apply 在前」。
     *
     * 找的是**命令调用行**（行首就是 `node …`），不是「这个文件名的任意一次出现」——
     * 那一步的说明注释里正当地写着同一个文件名，按 `indexOf` 找会把注释算成调用，
     * 于是这条顺序判据自己判错方向。 */
    const yml = read(".cnb.yml");
    const applyAt = yml.indexOf("ci-console-encoding.mjs --apply");
    expect(
      applyAt,
      "没有人纠控制台输出编码 —— 日志乱码那一格因此没有任何执行者",
    ).toBeGreaterThan(-1);
    /* 从 apply 往上回到它所属那一格的 `- name:`、往下到下一格之前为止：
     * 拿「自己那一格」当窗口，而不是「从这一格一直到文件末尾」（原来的写法）。 */
    const stageAt = yml.slice(0, applyAt).lastIndexOf("\n  - name:");
    expect(stageAt, "`--apply` 不在任何一个 stage 块里").toBeGreaterThan(-1);
    const nextAt = yml.slice(applyAt).search(/\n {2}- name:/);
    const block = yml.slice(
      stageAt + 1,
      nextAt < 0 ? undefined : applyAt + nextAt,
    );
    const invoked = block
      .split("\n")
      .findIndex((l) =>
        unwrapCp936(l.trim()).startsWith(
          "node scripts/ci-toolchain-selfcheck.mjs",
        ),
      );
    expect(invoked, "同一步里找不到工具链自证的命令调用行").toBeGreaterThan(-1);
    const applyLine = block
      .split("\n")
      .findIndex((l) =>
        unwrapCp936(l.trim()).startsWith(
          "node scripts/ci-console-encoding.mjs",
        ),
      );
    expect(applyLine, "同一步里找不到纠编码的命令调用行").toBeGreaterThan(-1);
    expect(
      applyLine < invoked,
      "纠编码排在了第一次中文输出之后 —— 那一段照着乱码打出来",
    ).toBe(true);
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
