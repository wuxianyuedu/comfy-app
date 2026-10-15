/**
 * 流水线第一步「工具链自证」的判据（ISSUE #1959 第二轮）。
 *
 * ## 这一步坏过，而且坏得看不出真因
 *
 * 自托管流水线的首跑在第 8 秒就红掉了，红在**第一步**、排在后面的 27 个 stage
 * 一个都没跑，而报错话术与「这台机器压根没装 Python」逐字同形。真因是那段
 * 就地 PowerShell 里探的候选名与门禁 `check-app-port-vectors.cjs` 探的**不是同一份**。
 *
 * 所以本文件判三件事，缺一条那段逻辑就又一次没人看着：
 *
 *   ① **候选表只有一份答案** —— `scripts/ci-toolchain-selfcheck.mjs`、
 *      `scripts/check-app-port-vectors.cjs`、`src/lib/process/python-candidates.ts`
 *      三处的候选名、顺序、`py` 的 `-3` 必须逐项一致（前两份刻意不 import 那份 TS
 *      —— 理由写在各自文件头：一份是 `.cjs`、一份要在「Node 模块链还没被证明可用」
 *      的机器上也能给出可读输出。两份文本 + 一条判据，是这里选的形态）；
 *   ② **`engines.node` 的区间抄得对**（含 caret 的**上界**）—— 比下界就放过的
 *      `24.14.9` 这类形态，正是那种「不报错、只让某几条用例以奇怪方式红」的东西；
 *   ③ **`.cnb.yml` 真的在跑它**、且那段就地 PowerShell 已经撤掉（脚本存在而配置
 *      没接上 = 那一步又回到手写形态，本文件判的链就断了）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  installPython,
  nodeAllowed,
  parseVersion,
  pythonForensics,
  wingetAtStandardLocation,
} from "../scripts/ci-toolchain-selfcheck.mjs";
import {
  pythonCandidates,
  pythonProbeArgs,
} from "../src/lib/process/python-candidates";

const ROOT = path.resolve(import.meta.dirname, "..");

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

/** 解析一个**一定读得出来**的版本（读不出来就当场红，别让下面几条静默空转）。 */
function requireVersion(text: string) {
  const v = parseVersion(text);
  if (!v) throw new Error(`解析不出版本：${text}`);
  return v;
}

/** 从一段源码里抠出「按平台二选一」的候选表（两份文本，逐项对账）。 */
function candidatesInSource(text: string, constName: string): string[] {
  const block = new RegExp(`const ${constName}\\s*=\\s*([\\s\\S]*?);\\n`).exec(
    text,
  )?.[1];
  if (!block) return [];
  /* 只收**数组字面量里**的字符串：`process.platform === "win32"` 那句里的
   * `"win32"` 是平台判别式，不是候选名 —— 连它一起收就会把「候选表」多算一项。
   * `? [...] : [...]` 的出现顺序**不假定**，按顺序收，与
   * `pythonCandidates("win32")` + `("linux")` 的拼接对账即可。 */
  return [...block.matchAll(/\[([^\]]*)\]/g)]
    .flatMap((m) => [...(m[1] ?? "").matchAll(/"([^"]+)"/g)])
    .map((m) => m[1] ?? "");
}

describe("工具链自证：Python 候选表只有一份答案", () => {
  it("脚本里的候选与共享件逐项相同（含顺序）", () => {
    const text = read("scripts/ci-toolchain-selfcheck.mjs");
    /* 扫描面先自证：抠不到表说明下面几条是空转。 */
    const found = candidatesInSource(text, "PY_CANDIDATES");
    expect(found, "抠不到 PY_CANDIDATES —— 扫描面指错了地方").not.toEqual([]);
    expect(found).toEqual([
      ...pythonCandidates("win32"),
      ...pythonCandidates("linux"),
    ]);
  });

  it("`py` 的 `-3` 在脚本里也没丢（裸 py 是「列出已装版本」并退非零）", () => {
    /* 只判「那份表里有 `py: ["-3"` 这一条」这**一件事**，不判它外面套了什么
     * （`/** @type … *\/ ({...})` 这种 JSDoc 归 TS 类型，与判据无关）。 */
    const text = read("scripts/ci-toolchain-selfcheck.mjs");
    const block = /PY_PROBE_ARGS[\s\S]{0,120}?\n\n/.exec(text)?.[0] ?? "";
    expect(block, "抠不到 PY_PROBE_ARGS —— 扫描面指错了地方").not.toBe("");
    expect(block).toContain('py: ["-3"');
    expect(pythonProbeArgs("py", ["--version"])).toEqual(["-3", "--version"]);
  });

  it("门禁脚本（.cjs）的候选表也对得上 —— 三处一份答案", () => {
    const gate = read("scripts/check-app-port-vectors.cjs");
    const found = candidatesInSource(gate, "PYTHON_CANDIDATES");
    expect(found, "抠不到 PYTHON_CANDIDATES —— 扫描面指错了地方").not.toEqual(
      [],
    );
    expect(found).toEqual([
      ...pythonCandidates("win32"),
      ...pythonCandidates("linux"),
    ]);
    expect(gate).toMatch(/PYTHON_PROBE_ARGS\s*=\s*\{\s*py:\s*\["-3"/);
  });
});

describe("工具链自证：engines.node 的区间", () => {
  it("范围之内的过", () => {
    for (const v of [
      "22.22.2",
      "22.99.0",
      "24.15.0",
      "24.20.0",
      "26.0.0",
      "30.1.0",
    ]) {
      expect(nodeAllowed(requireVersion(v)), v).toBe(true);
    }
  });

  it("范围之外的拦 —— 含 caret 的上界（24.14.9 是个具体的坑）", () => {
    for (const v of ["20.11.0", "22.22.1", "24.14.9", "25.3.0"]) {
      expect(nodeAllowed(requireVersion(v)), v).toBe(false);
    }
  });

  it("与 package.json 的 engines.node 对账（改了一侧另一侧会红）", () => {
    const pkg = JSON.parse(read("package.json")) as {
      engines: { node: string };
    };
    const engines = pkg.engines.node;
    /* 逐段核对：写死的范围与 `package.json` 声明的三段**同一批边界**。
     * 不去解析语义版本区间（那要一个依赖，而这一步要在「什么都还没装好」的机器上
     * 也能跑）；这里判的是「三段的边界数字都对得上」这件事本身。 */
    for (const boundary of ["22.22.2", "24.15.0", "26.0.0"]) {
      expect(engines, `engines.node 里没有 ${boundary}`).toContain(boundary);
    }
    expect(engines).toBe("^22.22.2 || ^24.15.0 || >=26.0.0");
  });

  it("版本串解析：带不带 `v` 前缀都认，读不到就答 null", () => {
    expect(parseVersion("v24.20.0")).toEqual({
      major: 24,
      minor: 20,
      patch: 0,
    });
    expect(parseVersion("24.20.0")).toEqual({ major: 24, minor: 20, patch: 0 });
    expect(parseVersion("(node 不可用)")).toBeNull();
  });

  it("读不到版本时 nodeAllowed 不假装通过", () => {
    const v = parseVersion("(node 不可用)");
    if (v) throw new Error("这一格应当读不出版本");
  });
});

describe("工具链自证：失败时的取证（#1959 第三轮）", () => {
  it("探到「一个都没有」时，把执行账号 / PATH / 安装位置命中一并打出来", () => {
    const lines = pythonForensics({
      env: {
        PATH: "/a:/b",
        LOCALAPPDATA: "/home/u/AppData/Local",
        ProgramFiles: "/Program Files",
      },
      account: "RUNNER\\svc",
      existing: (p) => p === "/home/u/AppData/Local/Programs/Python",
      listDirs: (p) =>
        p === "/home/u/AppData/Local/Programs/Python" ? [`${p}/Python312`] : [],
    });
    const text = lines.join("\n");
    expect(text).toContain("执行账号: RUNNER\\svc");
    expect(text).toContain("  /a");
    expect(text).toContain("  /b");
    // 位置命中 → 说明「装过、只是这个账号 PATH 里没有」，与「真没装」分开。
    expect(text).toContain("/home/u/AppData/Local/Programs/Python/Python312");
    expect(text).not.toContain("一个都没找到");
  });

  it("位置也没命中时明说「更像这台机真的没装」", () => {
    const text = pythonForensics({
      env: { PATH: "/a" },
      account: "svc",
      existing: () => false,
      listDirs: () => [],
    }).join("\n");
    expect(text).toContain("一个都没找到 —— 更像「这台机真的没装」");
  });

  it("四个安装根都覆盖（含别人装的那两个），不只是「我们指望它装在哪」", () => {
    const roots: string[] = [];
    pythonForensics({
      env: {
        PATH: "/a",
        LOCALAPPDATA: "/L",
        ProgramFiles: "/PF",
        "ProgramFiles(x86)": "/PFx86",
        ALLUSERSPROFILE: "/ALL",
      },
      account: "svc",
      existing: (p) => {
        roots.push(p);
        return false;
      },
      listDirs: () => [],
    });
    /* `existing` 收到的就是逐条探过的根 —— 断言的是「探了哪四个」。 */
    expect(roots).toEqual([
      "/L/Programs/Python",
      "/PF/Python",
      "/PFx86/Python",
      "/ALL/Python",
    ]);
  });
});

describe("工具链自证：缺件时的安装路径（#1959 第二、三轮）", () => {
  it("winget 不在 PATH 上时，仍按用户级标准落点再找一遍", () => {
    /* 现场：`winget` 常年在盘上却不在构建会话的 PATH 上（`WindowsApps` 那条按用户
     * 追加的路径要新会话才生效）。少了这一条，「机器上有 winget」会被读成「没有」。
     * 这里直判落点拼法（本机没有那个文件，所以 `installPython` 的分支由它决定）；
     * 真起 `winget` 那一档不可能在开发机上判 —— 由这段拼法本身承担。 */
    const existing = (p: string) => p === "/L/Microsoft/WindowsApps/winget.exe";
    expect(wingetAtStandardLocation({ LOCALAPPDATA: "/L" }, existing)).toBe(
      "/L/Microsoft/WindowsApps/winget.exe",
    );
    // 盘上真没有时不编一个路径出来（那会让下面的 `winget install` 以 ENOENT 失败）。
    expect(
      wingetAtStandardLocation({ LOCALAPPDATA: "/L" }, () => false),
    ).toBeNull();
    // 没有 LOCALAPPDATA 时不拼出一个相对路径来冒充绝对路径。
    expect(wingetAtStandardLocation({})).toBeNull();
  });

  it("非 Windows 上不进 winget 那条路，直接把处置交回给人", () => {
    const r = installPython({ run: () => ({ ok: false, out: "" }) });
    if (process.platform === "win32") return;
    expect(r.reason).toContain("非 Windows");
  });
});

describe("工具链自证：`.cnb.yml` 真的在跑它", () => {
  it("那一步走的是这份脚本，不再手写就地 PowerShell", () => {
    const yml = read(".cnb.yml");
    expect(yml).toContain("node scripts/ci-toolchain-selfcheck.mjs");
    // 老形态的两件特征：就地 winget、就地递归找安装根。
    expect(yml).not.toContain("winget install");
    expect(yml).not.toContain("Get-ChildItem");
  });
});
