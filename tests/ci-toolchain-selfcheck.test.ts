/**
 * 流水线第一步「工具链自证」的判据（ISSUE #1959 第二轮）。首跑第 8 秒红在第一步、后 27 个 stage 全没跑，
 * 且话术与「机器没装 Python」逐字同形 —— 真因是就地 PowerShell 与 `check-app-port-vectors.cjs` 探的候选名不是同一份。判三件事：
 * ① 三处（`ci-toolchain-selfcheck.mjs`/`check-app-port-vectors.cjs`/`python-candidates.ts`）候选名、顺序与 `py -3` 一致；② `engines.node` 区间含 caret 上界；③ `.cnb.yml` 真在跑它、就地 PowerShell 已撤。
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import {
  installPython,
  PYTHON_EMBED_VERSION,
  pythonForensics,
  wingetAtStandardLocation,
  wingetCandidates,
} from "../scripts/ci-toolchain-python.mjs";
import {
  cargoForensics,
  nodeAllowed,
  parseVersion,
  playwrightInstallHints,
  runPlaywrightInstall,
} from "../scripts/ci-toolchain-selfcheck.mjs";
import {
  findPnpm,
  pnpmForensics,
  pnpmPathEntries,
  pnpmPathValue,
} from "../scripts/ci-toolchain-pnpm.mjs";
import { BROWSER_PACKAGES } from "../scripts/ci-toolchain-browser.mjs";
import { pythonCandidates, pythonProbeArgs } from "../src/lib/process/python-candidates";

/** 浏览器那一层的直接导出（下载根两个 / 「已装就不装」/ 「到得了哪」）。 */
const { PLAYWRIGHT_HOST_CANDIDATES: browserCandidates } =
  await import("../scripts/ci-toolchain-browser-reach.mjs");
const {
  httpDownloadProbe,
  isReachableVerdict,
  playwrightDownloadRoots,
  playwrightHostsToTry,
  playwrightInstallHintFacts,
  playwrightOnly,
  playwrightProbeUrl,
  playwrightReachability,
} = await import("../scripts/ci-toolchain-browser.mjs");
/** 自取那一层（分片 + 续传 + 自己读 zip），见 `ci-toolchain-browser-fetch.mjs`。 */
const { browserDirName, extractZipTo, fetchRangeToFile, fetchUrlResumable } =
  await import("../scripts/ci-toolchain-browser-fetch.mjs");

const ROOT = path.resolve(import.meta.dirname, "..");

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

/** 解析一个**一定读得出来**的版本（读不出来就当场红，别让下面几条静默空转）。 */
function requireVersion(text: string) {
  const v = parseVersion(text);
  if (!v) {
    throw new Error(`解析不出版本：${text}`);
  }
  return v;
}

/**
 * 断言「探了哪条路径」用的**归一形态**（分隔符归一 + 折叠重复 + 小写）。
 * 被测脚本用平台 `path.join` 拼落点，期望值写死一侧只在那一侧宿主成立（本文件最初这么写，自托管 Windows 红了 6 条）；
 * 判的是「探了哪个落点」而非分隔符，而 `path.join` 拼期望只是把问题挪个位置 ⇒ 统一按归一后的正斜杠形态比。
 */
function norm(p: string): string {
  return p
    .replaceAll("\\", "/")
    .replaceAll(/\/{2,}/g, "/")
    .toLowerCase();
}

/**
 * 造一个**最小可用**的 zip（只带一个条目），给「自己读 zip」那条判据当夹具。
 * 走 `node:zlib` 的 `deflateRawSync`（与实现的 `inflateRawSync` 对得上），不落二进制夹具进仓；
 * local header 与 central directory 都写全 —— 实现读 central directory，数据偏移须落在真 local header 上。
 */
function makeZip(files: Array<{ data: Buffer; name: string }>): Buffer {
  const locals: Array<Buffer> = [];
  const centrals: Array<Buffer> = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const comp = deflateRawSync(f.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04_03_4b_50, 0);
    local.writeUInt16LE(20, 4); // 需要的版本
    local.writeUInt16LE(0, 6); // 旗标
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10); // 时间
    local.writeUInt16LE(0, 12); // 日期
    local.writeUInt32LE(crc32(f.data), 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra 长度
    locals.push(local, name, comp);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02_01_4b_50, 0);
    central.writeUInt16LE(0x03_1e, 4); // made by Unix
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10); // deflate
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc32(f.data), 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(f.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE((0o10_0644 << 16) >>> 0, 38); // 外部属性（权限位在高 16 位）
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + comp.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06_05_4b_50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

/** 标准的 CRC-32（zip 用它校验每个条目）—— 只服务上面那个夹具。 */
function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k += 1) {
      c = (c >>> 1) ^ (0xed_b8_83_20 & -(c & 1));
    }
  }
  return ~c >>> 0;
}

/** 从一段源码里抠出「按平台二选一」的候选表（两份文本，逐项对账）。 */
function candidatesInSource(text: string, constName: string): Array<string> {
  const block = new RegExp(`const ${constName}\\s*=\\s*([\\s\\S]*?);\\n`).exec(text)?.[1];
  if (block === undefined || block === "") {
    return [];
  }
  /* 只收**数组字面量里**的字符串：`process.platform === "win32"` 那句里的
   * `"win32"` 是平台判别式，不是候选名 —— 连它一起收就会把「候选表」多算一项。
   * `? [...] : [...]` 的出现顺序**不假定**，按顺序收，与
   * `pythonCandidates("win32")` + `("linux")` 的拼接对账即可。 */
  return [...block.matchAll(/\[(?<material>[^\]]*)\]/g)]
    .flatMap((m) => [...(m.groups?.material ?? "").matchAll(/"(?<name>[^"]+)"/g)])
    .map((m) => m.groups?.name ?? "");
}

describe("工具链自证：Python 候选表只有一份答案", () => {
  it("脚本里的候选与共享件逐项相同（含顺序）", () => {
    /* 候选表随 Python 那一层拆到了 `ci-toolchain-python.mjs`（selfcheck 的 900 行
     * 硬闸要求把「机制」与「编排」分开）—— 扫描面跟着走，别指到已经搬走的地方。 */
    const text = read("scripts/ci-toolchain-python.mjs");
    /* 扫描面先自证：抠不到表说明下面几条是空转。 */
    const found = candidatesInSource(text, "PY_CANDIDATES");
    expect(found, "抠不到 PY_CANDIDATES —— 扫描面指错了地方").not.toEqual([]);
    expect(found).toEqual([...pythonCandidates("win32"), ...pythonCandidates("linux")]);
  });

  it("`py` 的 `-3` 在脚本里也没丢（裸 py 是「列出已装版本」并退非零）", () => {
    /* 只判「那份表里有 `py: ["-3"` 这一条」这**一件事**，不判它外面套了什么
     * （`/** @type … *\/ ({...})` 这种 JSDoc 归 TS 类型，与判据无关）。 */
    const text = read("scripts/ci-toolchain-python.mjs");
    const block = /PY_PROBE_ARGS[\s\S]{0,120}?\n\n/.exec(text)?.[0] ?? "";
    expect(block, "抠不到 PY_PROBE_ARGS —— 扫描面指错了地方").not.toBe("");
    expect(block).toContain('py: ["-3"');
    expect(pythonProbeArgs("py", ["--version"])).toEqual(["-3", "--version"]);
  });

  it("门禁脚本（.cjs）的候选表也对得上 —— 三处一份答案", () => {
    const gate = read("scripts/check-app-port-vectors.cjs");
    const found = candidatesInSource(gate, "PYTHON_CANDIDATES");
    expect(found, "抠不到 PYTHON_CANDIDATES —— 扫描面指错了地方").not.toEqual([]);
    expect(found).toEqual([...pythonCandidates("win32"), ...pythonCandidates("linux")]);
    expect(gate).toMatch(/PYTHON_PROBE_ARGS\s*=\s*\{\s*py:\s*\["-3"/);
  });
});

describe("工具链自证：engines.node 的区间", () => {
  it("范围之内的过", () => {
    /* `>=26.12.1` 一档（#2532 收紧之后的 `package.json`）—— 高于下界的都要过。 */
    for (const v of ["26.12.1", "26.12.2", "26.20.0", "27.0.0", "30.1.0"]) {
      expect(nodeAllowed(requireVersion(v)), v).toBe(true);
    }
  });

  it("范围之外的拦 —— 含下界那一个版本自身（26.12.0 是这一次的坑）", () => {
    /* `26.12.0` 正好在下界之下：只比 major / minor 的写法会把它读成「过」。
     * （caret 上界那一档随 #2532 一起走掉了 —— 现在只剩一个无上界区间。） */
    for (const v of ["20.11.0", "22.22.1", "24.14.9", "25.3.0", "26.12.0"]) {
      expect(nodeAllowed(requireVersion(v)), v).toBe(false);
    }
  });

  it("与 package.json 的 engines.node 对账（改了一侧另一侧会红）", () => {
    /* SAFETY: 类型断言已复核 */
    const pkg = JSON.parse(read("package.json")) as {
      engines: { node: string };
    };
    const engines = pkg.engines.node;
    /* 逐段核对：写死的范围与 `package.json` 声明的**同一批边界**。不解析语义版本区间
     * （那要一个依赖，而这一步要在「什么都还没装好」的机器上跑），只判「边界数字对得上」。
     *
     * ⚠️ #2532 收紧成 `>=26.12.1` 时这串**没**跟着改 ⇒ 本用例因此变红，而它正是这一格
     * 唯一能对上两侧的判据（ISSUE #2552）。 */
    for (const boundary of ["26.12.1"]) {
      expect(engines, `engines.node 里没有 ${boundary}`).toContain(boundary);
    }
    expect(engines).toBe(">=26.12.1");
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
    if (v) {
      throw new Error("这一格应当读不出版本");
    }
  });
});

/**
 * Rust 那一格的取证（ISSUE #2549）：今天失败只有 `(cargo 不可用)` 五个字，而桌面成品包
 * 02:00 那一跑就是这么红的 —— 机上装着 cargo，差的是**执行账号**（runner 是服务账号，
 * `CARGO_HOME` / `G:\\.cargo\\bin` 在开发者会话那侧）。取证把「这个账号看不见」与「没装」分开。
 */
describe("工具链自证：Rust 那一格的取证（#2549）", () => {
  /** 把 `path.join` 的盘符形态归一化（Windows 上 join 出 `\`，posix 上出 `/`）。 */
  const norm = (s: string) => s.replaceAll("\\", "/").toLowerCase();

  it("`CARGO_HOME` 在却在 PATH 上找不到 ⇒ 直说「代理在盘上、缺的是 PATH」", () => {
    const home = path.join("/G", ".cargo");
    const lines = cargoForensics({
      platform: "linux",
      env: { PATH: "/usr/bin", CARGO_HOME: home, RUSTUP_HOME: "/home/u/.rustup" },
      isFile: (p) => norm(p) === norm(path.join(home, "bin", "cargo")),
    }).join("\n");
    expect(lines).toContain(`CARGO_HOME：${home}`);
    expect(lines).toContain("这一格的 PATH 上没有它");
    expect(norm(lines)).toContain(norm(path.join(home, "bin", "cargo")));
    /* PATH 原文必须念得到 —— 它是「这一格读到的那一串对不对」这件事的唯一读数。 */
    expect(lines).toContain("PATH 原文");
  });

  it("Windows 上 `.exe` / `.EXE` 只算一个命中（不区分大小写的文件系统不许读成两个）", () => {
    const home = String.raw`G:\.cargo`;
    const text = cargoForensics({
      platform: "win32",
      env: { PATH: String.raw`C:\Windows`, CARGO_HOME: home },
      isFile: () => true,
    }).join("\n");
    const listed = text.match(/G:\\\.cargo\\bin\\cargo\S*/g) ?? [];
    expect(listed.length).toBe(1);
  });

  it("那一对变量都不在场 ⇒ 念「这一格的变量表里没有它」（给读绘本的人指路）", () => {
    const lines = cargoForensics({
      platform: "linux",
      env: { PATH: "/usr/bin" },
      isFile: () => false,
    }).join("\n");
    expect(lines).toContain("CARGO_HOME：（这一格的变量表里没有它");
    expect(lines).toContain("RUSTUP_HOME：（这一格的变量表里没有它");
  });

  it("`CARGO_HOME` 在、而它指的地方没有代理 ⇒ 说清楚是真没装 / 值指错了，不谎报「只是 PATH 上没有」", () => {
    const lines = cargoForensics({
      platform: "linux",
      env: { PATH: "/usr/bin", CARGO_HOME: "/nowhere" },
      isFile: () => false,
    }).join("\n");
    expect(lines).toContain("要么工具链不在这台机上、要么 `CARGO_HOME` 这个值指错了");
    expect(lines).not.toContain("只是这一格的 PATH 上没有它");
  });
});

describe("工具链自证：失败时的取证（#1959 第三轮）", () => {
  it("探到「一个都没有」时，把执行账号 / PATH / 安装位置命中一并打出来", () => {
    /* 落点由脚本用**平台的** `path.join` 拼（POSIX 给 `/L/Programs/Python`、
     * Windows 给 `\\L\\Programs\\Python`），所以注入的两个判据也按同一形态拼 ——
     * 写死正斜杠字面量只在 POSIX 宿主上命中（本文件最初就这么写，在自托管节点上红）。 */
    const lRoot = path.join("/home/u/AppData/Local", "Programs", "Python");
    const lines = pythonForensics({
      env: {
        // 用**宿主的分隔符**拼两条目：`/a:/b` 在 Windows 上是一整条，
        // 那两条断言就会红在「宿主分隔符」而不是被测逻辑上。
        PATH: ["/a", "/b"].join(path.delimiter),
        LOCALAPPDATA: "/home/u/AppData/Local",
        ProgramFiles: "/Program Files",
      },
      account: String.raw`RUNNER\svc`,
      existing: (p) => p === lRoot,
      listDirs: (p) => (p === lRoot ? [path.join(p, "Python312")] : []),
    });
    const text = lines.join("\n");
    expect(text).toContain(String.raw`执行账号: RUNNER\svc`);
    expect(text).toContain("  /a");
    expect(text).toContain("  /b");
    // 位置命中 → 说明「装过、只是这个账号 PATH 里没有」，与「真没装」分开。
    expect(norm(text)).toContain(norm(path.join(lRoot, "Python312")));
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

  it("落点按「这台机的实际布局」问：PATH 上的盘符与别人的 profile 都算", () => {
    /* 现场教的一课（#1959 第三轮第二跑）：那台机把用户数据与程序放在 `D:` 盘，
     * 而标准落点（`%LOCALAPPDATA%\Programs\Python` 一族）**零命中** —— 只查标准
     * 落点会得出「这台机真的没装」，可 PATH 里明明带着 `D:\...`。判据是
     * 「取证必须覆盖这台机实际用的盘符，以及**其他账号** profile 里的按用户安装」
     * （`D:\Users\yuedu\...` 正是「yuedu 会话有、SYSTEM 构建账号没有」的那一格）。 */
    const probed: Array<string> = [];
    pythonForensics({
      env: {
        // 只用分号当分隔符（Windows 形态）—— 这里的 env 是合成的 PATH，不是本机的。
        PATH: String.raw`C:\Windows\system32;D:\Program Files\nodejs`,
        LOCALAPPDATA: String.raw`C:\srv\AppData\Local`,
        ProgramFiles: String.raw`C:\Program Files`,
      },
      account: String.raw`NT AUTHORITY\SYSTEM`,
      existing: (p) => {
        probed.push(p);
        return false;
      },
      /* 只让 `D:` 盘那根 Users 列举出一个 profile —— 其余 Users 根返回空。
       * 判「是不是 D: 盘的 Users 根」按**归一后的正斜杠形态**，不写字面量：
       * 脚本用平台的 `path.join` 拼，POSIX 宿主上会得到 `D:\/Users` 这种混种形态，
       * 写死会漂（这是判据自身的可移植性，不是被测逻辑的形态）。 */
      listDirs: (p) =>
        /^d:\/+users\/?$/i.test(p.replaceAll("\\", "/")) ? [String.raw`D:\Users\yuedu`] : [],
    });
    /* 一律按**归一后的正斜杠形态**断言落点身份 —— 脚本用平台 `path.join` 拼，
     * POSIX 宿主上会出现 `D:\/...` 这类混种分隔符；判的是「探了哪个落点」，
     * 不是「分隔符长什么样」。 */
    const norm = (x: string) =>
      x
        .replaceAll("\\", "/")
        .replaceAll(/\/{2,}/g, "/")
        .toLowerCase();
    const set = new Set(probed.map(norm));
    // 标准落点仍在（不能为了新形态把既有的四个丢了）。
    expect(set.has(norm(String.raw`C:\srv\AppData\Local\Programs\Python`))).toBe(true);
    // 这台机 PATH 上出现过的盘符下的同类位置也探了（不是只探 C:）。
    expect(set.has("d:/program files/python")).toBe(true);
    expect(set.has("d:/python")).toBe(true);
    // 别人的按用户安装 —— 最初的症状就在这一格。
    expect(set.has("d:/users/yuedu/appdata/local/programs/python")).toBe(true);
  });

  it("四个安装根都覆盖（含别人装的那两个），不只是「我们指望它装在哪」", () => {
    const roots: Array<string> = [];
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
    /* `existing` 收到的就是逐条探过的根 —— 断言的是「探了哪四个」。
     * 期望值同样按**平台的 `path.join`** 拼（脚本就是这么拼的）：写死正斜杠
     * 字面量会让这条判据只在 POSIX 宿主上成立。 */
    expect(roots.map(norm)).toEqual(
      [
        path.join("/L", "Programs", "Python"),
        path.join("/PF", "Python"),
        path.join("/PFx86", "Python"),
        path.join("/ALL", "Python"),
      ].map(norm),
    );
  });
});

describe("工具链自证：缺件时的安装路径（#1959 第二、三轮）", () => {
  /**
   * 把**三条通道的接缝全注入死**的公共夹具（#1959 第六轮）。
   * 只注入 `findExe` 时 `installPython` 仍会走完三条通道，末条 embed **真去 python.org 下载/解压/写盘**：残留 `python-embeded/` 让下一跑读到上一跑的目录（`expected true to be false`），冷节点上还撞 30s 全局超时。
   * 故接缝按「会不会碰外部世界」列全：`run`/`findExe`、`existing`、`download`/`unzip`/`mkdir`/`cwd`（第三条通道的落点）。
   */
  const noExternalAction = {
    /* SAFETY: 类型断言已复核 */
    platform: "win32" as NodeJS.Platform,
    /* SAFETY: 类型断言已复核 */
    env: { LOCALAPPDATA: "/L" } as unknown as NodeJS.ProcessEnv,
    existing: () => false,
    mkdir: () => undefined,
    download: () => undefined,
    unzip: () => undefined,
    cwd: mkdtempSync(path.join(tmpdir(), "selfcheck-inert-")),
    /* ⚠️ 上面这一串是按「**用例传了什么**」列的，而漏掉一个就仍然会真去读盘。
     * 这一条是**两个**查找面（ISSUE #1961）：`findExe` 回答「这台机器上有没有」，
     * `findExeUnder` 回答「这个目录下有没有」—— `scoop` 通道按落点逐个问的是后者。
     * 只给前者时那一半会绕过它直取模块实现读真 fs（下面那条结构判据钉住这件事）。 */
    findExe: () => null,
    findExeUnder: () => null,
    listDirs: () => [],
  };

  it("winget 不在 PATH 上时，仍按用户级标准落点再找一遍", () => {
    /* 现场：`winget` 常年在盘上却不在构建会话的 PATH 上（`WindowsApps` 那条按用户
     * 追加的路径要新会话才生效）。少了这一条，「机器上有 winget」会被读成「没有」。
     * 这里直判落点拼法（本机没有那个文件，所以 `installPython` 的分支由它决定）；
     * 真起 `winget` 那一档不可能在开发机上判 —— 由这段拼法本身承担。 */
    /* 被测实现用平台的 `path.join` 拼，所以落点身份按**归一形态**比。 */
    const want = norm(path.join("/L", "Microsoft", "WindowsApps", "winget.exe"));
    const existing = (p: string) => norm(p) === want;
    expect(norm(wingetAtStandardLocation({ LOCALAPPDATA: "/L" }, existing) ?? "")).toBe(want);
    // 盘上真没有时不编一个路径出来（那会让下面的 `winget install` 以 ENOENT 失败）。
    expect(wingetAtStandardLocation({ LOCALAPPDATA: "/L" }, () => false)).toBeNull();
    // 没有 LOCALAPPDATA 时不拼出一个相对路径来冒充绝对路径。
    expect(wingetAtStandardLocation({})).toBeNull();
  });

  it("落点是**一串**：本账号 → 其他账号的 profile → 各盘 Program Files（只探本账号会把「找错 profile」报成「没有 winget」）", () => {
    /* 现场（ISSUE #1959 第四轮）：构建账号是 `NT AUTHORITY\SYSTEM`，而 winget 是
     * **按用户**装的 MSIX 别名 —— 它的落点在**装它的那个用户**的 profile 下，SYSTEM
     * 的 `%LOCALAPPDATA%` 里结构上不可能有它。只探本账号时，日志报的是「盘上也没
     * 找到 winget」，而真因是「找错了账号的 profile」。 */
    /* 列目录注入进来，断言与开发机上有没有 `C:\Users` **无关**（真实现读 `fs`，
     * 在 Linux 上恒空 —— 那样这条用例会随环境静默变绿）。 */
    const cands = wingetCandidates(
      /* PATH 里带 `D:\` —— 盘符靠它反推，与 `pythonInstallRoots` 共用同一份证据。 */
      { PATH: String.raw`D:\x;`, LOCALAPPDATA: "/L", ProgramFiles: "/PF" },
      (root) => (root === String.raw`C:\Users` ? [String.raw`C:\Users\other`] : []),
    );
    /* 一律按**归一形态**比：被测实现用平台的 `path.join` 拼，写死分隔符
     * 只在某一侧的宿主上成立（本文件最初写死了，Windows 节点上红）。 */
    const has = (x: string) => cands.map(norm).includes(norm(x));
    /* 顺序即语义：本账号在最前（人机同账号时它一次就中），机器级在最后兜底。 */
    expect(norm(cands[0] ?? "")).toBe(
      norm(path.join("/L", "Microsoft", "WindowsApps", "winget.exe")),
    );
    /* 其他账号那一条要补 `AppData\Local`（MSIX 按用户安装落在那儿）—— 少补这一段
     * 会拼成一条不存在的路径。 */
    expect(has(String.raw`C:\Users\other\AppData\Local\Microsoft\WindowsApps\winget.exe`)).toBe(
      true,
    );
    /* 盘符从 PATH 反推的 —— `D:` 盘上的程序目录也在候选里（写死 `C:` 就会漏）。 */
    expect(has(String.raw`D:\Program Files\WindowsApps\winget.exe`)).toBe(true);
    expect(has("/PF/Microsoft/WindowsApps/winget.exe")).toBe(true);
  });

  it("别的 profile 读不动时只是少几个候选，不抛", () => {
    /* 真实现是 `fs.readdirSync`，别人 profile 权限不足时会抛 —— 而这一步的语义
     * 只是「少几个候选」，不该让整步工具链自证炸掉。 */
    const cands = wingetCandidates({ LOCALAPPDATA: "/L" }, () => {
      throw new Error("权限不足");
    });
    expect(cands.map(norm)).toContain(
      norm(path.join("/L", "Microsoft", "WindowsApps", "winget.exe")),
    );
  });

  it("POSIX 上按平台挑唯一一个包管理器；一个都不在时不猜、不动手", () => {
    /* Linux：apt-get / dnf / apk 里挑**第一个 `--version` 答得上的**那一档
     * （`apt-get` 排在最前，所以模拟「只有 dnf 在」时 apt-get 会先被问一次、
     * 答不上来才轮到 dnf —— 顺序本身是判据）。 */
    const ran: Array<string> = [];
    const linux = installPython({
      platform: "linux",
      run: (cmd, args) => {
        ran.push(`${cmd} ${args.join(" ")}`);
        // 只有 dnf 在盘上：其余两个连 `--version` 都不答。
        if (cmd === "dnf") {
          return { ok: true, out: "" };
        }
        return { ok: false, out: "" };
      },
    });
    expect(ran[0]).toBe("apt-get --version");
    expect(ran).toContain("dnf --version");
    expect(ran).toContain("dnf install -y python3");
    // 刻意**不**替人 sudo：权限那一层归平台侧的人（无人值守里一次提示 = 一次挂死）。
    expect(ran.some((c) => c.includes("sudo"))).toBe(false);
    expect(linux.reason === null || typeof linux.reason === "string").toBe(true);

    // 一个都不在 ⇒ 如实说「请自行安装」，而不是猜一个可能不存在的包管理器。
    const none = installPython({
      platform: "linux",
      run: () => ({ ok: false, out: "" }),
    });
    expect(none.installed).toBe(false);
    expect(none.reason).toContain("apt-get");

    // macOS 只认 brew（没有它就给 python.org 这条出口）。
    const mac = installPython({
      platform: "darwin",
      run: () => ({ ok: false, out: "" }),
    });
    expect(mac.installed).toBe(false);
    expect(mac.reason).toContain("brew");

    // 有 brew 就真去装（装成与否无所谓，判据只钉「跑了哪条」）。
    const brewRan: Array<string> = [];
    installPython({
      platform: "darwin",
      run: (cmd, args) => {
        brewRan.push(`${cmd} ${args.join(" ")}`);
        // `--version` 答得上 = 它在盘上；装那一趟让它退非零，走的正是失败分支。
        return { ok: args[0] === "--version", out: "" };
      },
    });
    expect(brewRan).toContain("brew --version");
    expect(brewRan).toContain("brew install python@3.12");
  });

  it("`--scope user` 不成时再试机器级 —— SYSTEM 账号看不见用户级安装", () => {
    /* 现场（#1959 第三轮）：Runner 以 `NT AUTHORITY\SYSTEM` 跑、用的是机器 PATH，
     * 而 `--scope user` 把包装进当前用户的配置目录 —— 那条路对 SYSTEM 要么装不上、
     * 要么装到一个这次构建之后的会话也看不见的地方。所以两个 scope 都要试。 */
    const scopes: Array<string> = [];
    installPython({
      ...noExternalAction,
      /* 「装完找解释器」必须注入成**一定找不到**：真实现扫安装根读真 fs，
       * 而跑判据的那台机器上若碰巧装着 Python，第一条 scope 就会提前成功返回、
       * 第二条根本不会跑 —— 一条判「两条都试」的用例于是随环境变成恒假
       * （本文件最初漏了这个注入面，在自托管 Windows 节点上红了 1 条）。 */
      findExe: () => null,
      // `winget --version` 答得上（用 PATH 上那个名字）；两条 install 都报成功。
      run: (_cmd, args) => {
        if (args.includes("--scope")) {
          scopes.push(args[args.indexOf("--scope") + 1] ?? "");
        }
        return { ok: true, out: "" };
      },
    });
    expect(scopes).toEqual(["user", "machine"]);
  });

  it("winget 那条路**也**经过注入面：两个接缝都注入后，链接目录里真放着解释器也读不到", () => {
    /* 接缝齐了但有一处直呼实现：`winget` 分支在「按链接目录再找一遍」那档**直接调**模块级
     * `findExeUnder` —— 第二个通真 fs 的口（注入的 `findExe` 管不到它）。实测两个接缝都注入
     * `() => null`，链接目录里**真放**一个 `python.exe` 仍得 `installed === true`、path 指向真文件。
     * 用真文件而不 mock `fs`：这一格判的正是「还有没有人去问真 fs」。 */
    const localAppData = mkdtempSync(path.join(tmpdir(), "selfcheck-links-"));
    try {
      const links = path.join(localAppData, "Microsoft", "WinGet", "Links");
      mkdirSync(links, { recursive: true });
      writeFileSync(path.join(links, "python.exe"), "");
      const r = installPython({
        ...noExternalAction,
        /* SAFETY: 类型断言已复核 */
        env: {
          LOCALAPPDATA: localAppData,
        } as unknown as NodeJS.ProcessEnv,
        run: () => ({ ok: true, out: "" }),
      });
      expect(r.installed).toBe(false);
    } finally {
      rmSync(localAppData, { recursive: true, force: true });
    }
  });

  it("两条 scope 都试过仍拿不到解释器时，把「试过什么」写进 reason", () => {
    const r = installPython({
      ...noExternalAction,
      /* `run` 对 `--scope` 那两条报失败，对其余（`winget --version`、`scoop …`）
       * 报成功 —— 后面两条通道因此仍会被走到，它们的接缝同样由夹具注入死。 */
      run: (_cmd, args) =>
        args.includes("--scope") ? { ok: false, out: "boom" } : { ok: true, out: "" },
    });
    expect(r.installed).toBe(false);
    expect(r.reason).toContain("user");
    expect(r.reason).toContain("machine");
  });

  /* 「既判也装」是**三条按序**的通道（#1959 第三轮）：`winget --scope user` 在本节点上
   * 两条路都不通（msstore 源没达成协议 / `--accept-msstore-source-agreements` 要管理员），
   * 所以最后那条「官方 embed 包解到检出本地」才是这里唯一真跑通过的一条。
   * 下面用注入的 run 把三条各自的**断点**逐条照亮。 */
  const win = {
    /* SAFETY: 类型断言已复核 */
    platform: "win32" as NodeJS.Platform,
    /* SAFETY: 类型断言已复核 */
    env: {
      LOCALAPPDATA: "/L",
      USERPROFILE: "/U",
      TEMP: "/T",
    } as unknown as NodeJS.ProcessEnv,
    existing: () => false,
    /* 「装完找解释器」读真 fs —— 注入成一定找不到，结论才只取决于下面注入的 run。 */
    findExe: () => null,
  };

  it("winget 与 scoop 都不在盘上时，落到官方 embed 包（下载 → 解压 → 复判都走过）", () => {
    const downloaded: Array<string> = [];
    const unzipped: Array<string> = [];
    const r = installPython({
      ...win,
      /* 一个干净的 cwd：embed 包解在 `<cwd>/python-embeded`，指到仓库根会让这条
       * 用例读到**上一跑真装出来的**那个目录、于是下载这一步根本不会发生。 */
      cwd: mkdtempSync(path.join(tmpdir(), "selfcheck-embed-")),
      run: () => ({ ok: false, out: "" }),
      /* `mkdir` 必须是真的：`unzip` 要在里面落一个 `python.exe`，而判据读的正是它。 */
      mkdir: (p: string) => {
        mkdirSync(p, { recursive: true });
      },
      download: (url: string) => {
        downloaded.push(url);
      },
      unzip: (_zip: string, dest: string) => {
        unzipped.push(dest);
        writeFileSync(path.join(dest, "python.exe"), "");
      },
      existing: (p: string) => existsSync(p),
    });
    expect(r.channel).toBe("embed");
    expect(downloaded[0]).toContain("python.org/ftp/python/");
    expect(unzipped[0]).toContain("python-embeded");
    expect(r.installed).toBe(true);
    expect(r.path).toMatch(/python-embeded.*python\.exe$/);
  });

  it("embed 包固定版本号，不取 latest（同一提交在两台节点上要装出同一个 Python）", () => {
    expect(PYTHON_EMBED_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(read("scripts/ci-toolchain-selfcheck.mjs")).not.toContain("/latest/");
  });

  it("三条通道全断时，reason 逐条点名各自断在哪（不糊成一句「装不上」）", () => {
    const r = installPython({
      ...win,
      cwd: mkdtempSync(path.join(tmpdir(), "selfcheck-dead-")),
      run: () => ({ ok: false, out: "" }),
      existing: () => false,
      mkdir: () => undefined,
      download: () => {
        throw new Error("网络不可达");
      },
      unzip: () => undefined,
    });
    expect(r.installed).toBe(false);
    for (const channel of ["winget", "scoop", "embed"]) {
      expect(r.reason, `reason 里没点名 ${channel}`).toContain(channel);
    }
  });
});

/**
 * 「pnpm 不可用」时的取证（ISSUE #1961）。两次猜测（cmd.exe 退路、`.PS1` 候选）都没修好，
 * 而历史上同一次构建里 `pnpm install` 跑得通 ⇒ 「缺一条候选规则」解释不通。缺的是**读数**：
 * 这一步看到的 `PATH` 是什么、逐条命中在哪 —— 人答得出而这里答不出，只可能是执行上下文（服务账号读机器 PATH、子进程继承的不是同一份）不同。
 */
describe("工具链自证：pnpm 找不到时要有取证（ISSUE #1961）", () => {
  it("逐条打印 PATH，并点名 pnpm* 在各目录的命中", () => {
    const lines = pnpmForensics({
      platform: "win32",
      env: { PATH: String.raw`C:\Windows;C:\Program Files\nodejs` },
      isFile: () => false,
    });
    const text = lines.join("\n");
    // PATH 的两条都要打出来（人是照它判「这个账号看得见什么」的）。
    expect(text).toContain(String.raw`C:\Windows`);
    expect(text).toContain(String.raw`C:\Program Files\nodejs`);
    // 零命中时要说清「是这个账号 PATH 上没有」，而不是留一片空白。
    expect(text).toContain("一个都没命中");
  });

  it("命中时逐条点名（形态一起打，人才判得出「名字在但起不来」）", () => {
    /* 形态大小写按**判据自己拼出来的**写（后缀表用 `PATHEXT` 的大写惯例）——
     * 写小写会让这条用例判的是宿主的大小写敏感，不是被测逻辑（同文件其它用例
     * 对 `.PS1` / `.CMD` 的处理一致）。 */
    const lines = pnpmForensics({
      platform: "win32",
      env: { PATH: String.raw`C:\Program Files\nodejs` },
      isFile: (candidate) => candidate.endsWith("pnpm.CMD"),
    });
    expect(lines.join("\n")).toContain("pnpm.CMD");
  });

  it("按**目标平台**的分隔符切 PATH，不按宿主的 `path.delimiter`", () => {
    /* `ci-toolchain-python.mjs` 的 `pathDrives` 记过这一格：宿主的 `path.delimiter`
     * 在 POSIX 上是 `:`，拿它切一串 Windows PATH 会把 `C:\Windows` 拆成
     * `C` 与 `\Windows` —— 而这条判据的 `platform` 是可注入的，单测就是在 POSIX
     * 上判 Windows 的形态。反向复算：改回 `path.delimiter`，这条当场点名。 */
    const lines = pnpmForensics({
      platform: "win32",
      env: { PATH: String.raw`C:\Windows;C:\nodejs` },
      isFile: () => false,
    });
    const text = lines.join("\n");
    expect(text).toContain(String.raw`C:\Windows`);
    expect(text).toContain(String.raw`C:\nodejs`);
    // 拆坏之后会留下孤立的 `C` 与 `\Windows` 两行。
    expect(text).not.toMatch(/^ {2}C$/m);
  });

  it("失败时按候选逐条报「在盘上但没起来」，并给宿主的结论", () => {
    /* 这是后半段才补上的那一半读数。此前只有「命中在哪几个目录」，
     * 回答不了下一个问题：命中的这几处里**有哪个真被试过、各自怎么败的**。
     * 「候选全对、败在探它的方式」那一轮（`.ps1` 少收了 `-v`）恰好只在这条读数里显形。 */
    const dir = "/bin";
    const tried = [path.join(dir, "pnpm.PS1"), path.join(dir, "pnpm.CMD")];
    const lines = pnpmForensics({
      platform: "win32",
      env: { PATH: dir },
      isFile: (p: string) => p.toLowerCase() === path.join(dir, "pnpm.ps1").toLowerCase(),
      tried,
      hostFound: false,
    });
    const text = lines.join("\n");
    for (const c of tried) {
      expect(text).toContain(c);
    }
    expect(text).toContain("在盘上但**没起起来**的候选");
    // 宿主不在时要把这条结论说全 —— 它是「不必再翻候选表」的那个出口。
    expect(text).toContain("没找到");
    expect(text).toContain("PowerShell");
  });

  it("没有候选进到探测这一步时如实说「没有」，不冒充读完", () => {
    const text = pnpmForensics({
      platform: "win32",
      env: { PATH: "/bin" },
      isFile: () => false,
      tried: [],
      hostFound: true,
    }).join("\n");
    expect(text).toContain("一个候选都没进到探测这一步");
  });

  /* ── ISSUE #2281：失败日志必须能分开「三类同形结论」────────────────
   *
   * 现场：一处只写「pnpm* 命中（一个都没命中）」而**从没打印读到的 PATH 原文**；另一处
   * 「pnpm 忽然不见了」在同机上用 `where pnpm` / `pnpm -v` 当场复算三次都不成立。
   * 共性：读数里没有「判据看到的那一串」，于是「真没装」「键名不是 PATH」「分隔符读错」逐字同形 —— 三者的下一动作完全不同（装 / 改键名 / 改切分）。 */
  it("取证里必须打 PATH **原文** —— 只打切出来的条目分不开那三类成因", () => {
    const text = pnpmForensics({
      platform: "win32",
      env: { PATH: String.raw`C:\Windows;C:\nodejs` },
      isFile: () => false,
    }).join("\n");
    expect(text, "读取到的 PATH 原文没有出现在取证里").toContain("PATH 原文");
    // 原文是**一整串**（含分隔符），不是逐条再拼一遍。
    expect(text).toContain(String.raw`C:\Windows;C:\nodejs`);
  });

  it("PATH 为空时明说「读到的是空」，不写成「这个账号上没有 pnpm」", () => {
    const text = pnpmForensics({
      platform: "win32",
      // 键名写作 `Path`：Windows 环境变量表里的常见写法，`env.PATH` 会读成 undefined。
      env: {},
      isFile: () => false,
    }).join("\n");
    expect(text).toContain("PATH 原文: （空");
  });

  it("键名是 `Path` 时 Windows 判据照样读到那一串（不因此判成「没装」）", () => {
    /* 判定面与读数面必须是**同一份**读法：两处各读一遍，就会出现「判据读的是
     * `Path`、取证打的却是空的 `PATH`」—— 那正是第 2281 号单里读不出根因的那种日志。 */
    const env = { Path: String.raw`C:\Windows;C:\nodejs` };
    expect(pnpmPathValue({ platform: "win32", env })).toBe(String.raw`C:\Windows;C:\nodejs`);
    expect(pnpmPathEntries({ platform: "win32", env })).toEqual([
      String.raw`C:\Windows`,
      String.raw`C:\nodejs`,
    ]);
    // POSIX 上 `Path` 与 `PATH` 是两个变量：不许把不敏感那一条套过去。
    expect(pnpmPathValue({ platform: "linux", env })).toBe("");
  });

  it("`findPnpm()` 失败时把试过的候选与宿主结论一起交出来", () => {
    /* 读数不能只活在取证函数里 —— 它得由**判据自己**在失败路径上产出，
     * 否则 `main()` 拿不到「这一跑试了什么」。这条钉住那条数据链。 */
    const dir = "/bin";
    const r = findPnpm({
      platform: "win32",
      env: { PATH: dir, PATHEXT: ".COM;.EXE;.BAT;.CMD" },
      // 盘上有两个形态，而两个都起不来。
      isFile: (p: string) =>
        [".ps1", ".cmd"].some((e) => p.toLowerCase() === path.join(dir, `pnpm${e}`)),
      host: () => null,
      probeRun: () => null,
    });
    expect(r.ok).toBe(false);
    expect(r.tried ?? [], "试过的候选一条都没记下来").not.toHaveLength(0);
    expect(r.hostFound, "宿主没有却报找到了").toBe(false);
  });
});

/**
 * 「浏览器安装」那一步的命令行（ISSUE #1961，自托管节点首次真跑到 E2E）。`findPnpm()` 交的 `args`
 * 是「**探一趟**」形态（`-File pnpm.ps1 -v`），照它拼真跑成 `pnpm -v exec playwright install …`：只打印版本、退 0，
 * 浏览器一个没装 ⇒ 这一步报绿而 E2E 照旧说二进制不在（比直接红更难查）。故另交 `prefixArgs`（去掉探针、含完整宿主前缀），真命令一律用它。
 */
describe("工具链自证：浏览器安装的命令行（ISSUE #1961）", () => {
  const hostPrefix = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "/bin/pnpm.PS1"];

  it("真命令里**不带**探针参数 `-v`（带上就变成「只打版本、什么都不装」）", () => {
    const calls: Array<Array<string>> = [];
    const r = runPlaywrightInstall({
      find: () => ({
        command: "/host/pwsh.EXE",
        prefixArgs: hostPrefix,
        args: [...hostPrefix, "-v"],
        out: "12.4.1",
        ok: true,
      }),
      exec: (_cmd, args) => {
        calls.push(args);
        return { ok: true, out: "installed" };
      },
    });
    expect(r.ok).toBe(true);
    expect(calls.length).toBe(1);
    const args = calls[0] ?? [];
    /* 这一条是**反向复算**的那一半：把 `prefixArgs` 换回 `args`，这里当场红。 */
    expect(args, "命令行里混进了探针参数 -v").not.toContain("-v");
    /* 装哪几件从 `BROWSER_PACKAGES` 取，**不在这里抄一份** —— 抄一份就成了第二处
     * 「这一步装什么」的定义，换成只装 headless shell 时它不会跟着变（本笔正是这么
     * 改的，而这一条当场红了一次）。 */
    expect(args).toEqual([...hostPrefix, "exec", "playwright", "install", ...BROWSER_PACKAGES]);
  });

  it("宿主前缀一件不少（少了就变成「拿 .ps1 当可执行文件起」）", () => {
    const seen: Array<[string, Array<string>]> = [];
    runPlaywrightInstall({
      find: () => ({
        command: "/host/pwsh.EXE",
        prefixArgs: hostPrefix,
        args: [...hostPrefix, "-v"],
        out: "12.4.1",
        ok: true,
      }),
      exec: (cmd, args) => {
        seen.push([cmd, args]);
        return { ok: true, out: "" };
      },
    });
    expect(seen[0]?.[0]).toBe("/host/pwsh.EXE");
    for (const one of hostPrefix) {
      expect(seen[0]?.[1]).toContain(one);
    }
  });

  it("pnpm 不可用时如实说，且**不去起**任何进程", () => {
    let ran = false;
    const r = runPlaywrightInstall({
      find: () => ({
        command: "pnpm",
        prefixArgs: [],
        args: ["-v"],
        out: "",
        ok: false,
      }),
      exec: () => {
        ran = true;
        return { ok: true, out: "" };
      },
    });
    expect(r.ok).toBe(false);
    expect(r.out).toContain("pnpm 不可用");
    expect(ran, "pnpm 都没探到还去起进程").toBe(false);
  });

  it("装的是这一档真正要的那一件（多下的那件 205 MB 正是超时的那个）", () => {
    /* 判的是「装了哪几件」，两个方向都要钉住：少了 `chromium-headless-shell` ⇒ headless 档报
     * `Executable doesn't exist`；多了 `chromium` ⇒ 多下 `chrome-win64.zip` 205 MB（headless shell
     * 才 120 MB），实测这台节点因此拉到 120s 超时（`cnb-g9d-1k515kvrq`），这一步红、
     * `E2E 关键流程` 一步都跑不到。本仓 `playwright.config.ts` 只有一个 headless project ⇒ 只需后者。 */
    let args: Array<string> = [];
    runPlaywrightInstall({
      find: () => ({
        command: "pnpm",
        prefixArgs: [],
        args: ["-v"],
        out: "",
        ok: true,
      }),
      exec: (_cmd, a) => {
        args = a;
        return { ok: true, out: "" };
      },
    });
    expect(args).toContain("chromium-headless-shell");
    expect(
      args,
      "又把 `chromium`（205 MB 那件）加回来了 —— 本档只有一个 headless project，用不到它，" +
        "而它正是这台节点上超时的那一件",
    ).not.toContain("chromium");
    /* 复验判的那一件必须在装的那一串里 —— 否则「装上」与「判过」指着两件不同的东西
     * （判据会一直红，而东西其实装了）。 */
    const src = readFileSync(path.join(ROOT, "scripts", "ci-toolchain-browser.mjs"), "utf8");
    for (const pkg of BROWSER_PACKAGES) {
      expect(src, `复验找的形状与 BROWSER_PACKAGES 对不上：${pkg}`).toContain(
        pkg.replaceAll("-", "_"),
      );
    }
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

/**
 * 「注入面只堵了一半」的结构判据（ISSUE #1961）。`installPython` 是**三条按序**的通道，而注入面
 * 此前按「用例传了什么」攒 —— 漏一个那半就直取模块实现：只注入 `run` 时 `viaScoop` 自己起
 * `spawnSync("scoop", …)` 并用模块内 `findExeUnder` 读真 fs。按**源码结构**判（按用例数要维护一张会过期的名单），只要通道内出现直取模块级实现就红。
 */
describe("工具链自证：安装通道的注入面按结构判（ISSUE #1961）", () => {
  const script = readFileSync(path.join(ROOT, "scripts", "ci-toolchain-python.mjs"), "utf8");

  it("`installPython` 的注入面覆盖每条通道会伸出去的东西", () => {
    for (const one of [
      "run: runCmd = run",
      "env = process.env",
      "existing =",
      "findExe =",
      "findExeUnder: findUnder =",
      "listDirs =",
      "mkdir =",
      "download =",
      "unzip =",
      "cwd = process.cwd()",
    ]) {
      expect(script, `installPython 的参数表里没有 \`${one}\``).toContain(one);
    }
  });

  it("通道壳把注入面透传下去，而不是在内部直取模块级实现", () => {
    /* `viaScoop` 曾经直接用模块内的 `findExeUnder` —— 注入的 `findExe` 管不到它，
     * 于是「scoop 报成功」那条结论随宿主上有没有 Python 而变。 */
    const scoop = script.slice(
      script.indexOf("function viaScoop("),
      script.indexOf("function viaEmbed("),
    );
    expect(scoop, "viaScoop 没有接 findExeUnder 注入面").toContain("findExeUnder");
    expect(
      /(?<![.\w])findExeUnder\s*\(/.test(scoop.replace(/findExeUnder:\s*findExe/, "")),
      "viaScoop 又直接调了模块级的 findExeUnder（读真 fs）：注入面形同虚设",
    ).toBe(false);

    /* `listDirs` 是 `wingetCandidates` 的第二个参数：漏传它，那一步会真去列盘上目录。 */
    const shell = script.slice(
      script.indexOf("function viaWinget("),
      script.indexOf("function installViaWinget("),
    );
    expect(shell, "viaWinget 没把 listDirs / existing 透传给实现").toContain("listDirs");
    expect(shell).toContain("existing");
  });

  it("Windows 分支的每个调用点都带 noExternalAction()", () => {
    /* 只判 **Windows** 分支：POSIX 那条只经 `run` 起包管理器，没有网络与解压
     * 那两截 —— 只注入 `run` 在那里是真的够，判它等于误报。 */
    const self = readFileSync(import.meta.filename, "utf8");
    const calls = [...self.matchAll(/installPython\(\{(?<args>[\s\S]*?)\n\s{0,6}\}\);/g)].map(
      (m) => m.groups?.args ?? "",
    );
    const winCalls = calls.filter((args) => args.includes("...noExternalAction"));
    expect(winCalls.length, "没扫到 Windows 分支的调用点，判据失效了").toBeGreaterThan(1);
    expect(
      calls.some((args) => args.includes('platform: "linux"')),
      "POSIX 分支的调用点不见了（判据的另一半）",
    ).toBe(true);
  });
});

/**
 * 「工具链自证」的 pnpm 那一格（ISSUE #1961）。自托管 Windows 节点首跑就红在 `pnpm 不可用`，而同一台机上 `pnpm install` 跑得好好的 ⇒ 整条流水线停在不成立的结论上（后 30 个 stage 全 skipped）。
 * 根因是裸名字交给 CreateProcess：corepack 的三种落盘形态 Node 一个都起不来 —— 无扩展名 shim 是 `#!/usr/bin/env node`（libuv 不解析 shebang）、`.cmd` 只有 cmd.exe 认（`EINVAL`）、只有 `.ps1` 要 PowerShell 宿主。
 * 故判「按 PATH × 扩展名解析、取第一个真能起的形态」（与 `whichCommand()` 同一套）；下判 `.ps1` 能被找到并给出可 spawn 的命令。
 */
/**
 * 工具链自证那一格与主判据的**形态选择必须一致**（ISSUE #2562）。`findPnpm()` 刻意不 import 仓库内
 * 模块（理由见文件头：要能在「Node 模块链还没被证明可用」的机器上给出可读输出），所以「包真身 JS
 * 入口优先」两边各有一份实现；漂移是**静默的** —— 一边走 `process.execPath` + 入口、另一边继续起 PowerShell 宿主，两边都绿，只是后者每条命令多付一次宿主冷启动。
 */
describe("工具链自证：pnpm 优先跑包真身的 JS 入口（ISSUE #2562）", () => {
  /** 造一个「只有垫片 + 包真身」的落点（Windows 现场的形状）。 */
  function makePnpmDropIn(opts: { bin: unknown; entryName: string }) {
    const dir = mkdtempSync(path.join(tmpdir(), "pnpm-js-entry-"));
    const pkgDir = path.join(dir, "node_modules", "pnpm");
    mkdirSync(path.join(pkgDir, "bin"), { recursive: true });
    writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({ name: "pnpm", version: "12.4.1", bin: opts.bin }),
    );
    const entry = path.join(pkgDir, opts.entryName);
    writeFileSync(entry, '#!/usr/bin/env node\nprocess.stdout.write("12.4.1\\n");\n');
    // PATH 上那三个垫片（Node 一个都起不来）
    writeFileSync(path.join(dir, "pnpm"), "#!/bin/sh\nexit 0\n");
    writeFileSync(path.join(dir, "pnpm.CMD"), "@ECHO off\r\n");
    writeFileSync(path.join(dir, "pnpm.PS1"), "Write-Output '12.4.1'\n");
    return { dir, entry };
  }

  it("垫片都在、包真身也在：选中 node + 入口，而不是 `.ps1` 宿主", () => {
    const { dir, entry } = makePnpmDropIn({
      bin: "./bin/pnpm.cjs",
      entryName: "bin/pnpm.cjs",
    });
    const r = findPnpm({
      platform: "win32",
      env: { PATH: dir, PATHEXT: ".COM;.EXE;.BAT;.CMD" },
      // 宿主**在**：这一格要证明的是「即使宿主可用也不走它」
      host: () => "/host/pwsh.EXE",
      probeRun: (cmd, args) => ({ command: cmd, args, out: "12.4.1" }),
    });
    expect(r.ok).toBe(true);
    expect(r.command).toBe(process.execPath);
    expect(r.prefixArgs).toEqual([entry]);
    expect(r.out).toBe("12.4.1");
  });

  it("`bin` 指向原生二进制时改用同包的 Corepack 入口（bin/pnpm.mjs）", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pnpm-js-entry-native-"));
    const pkgDir = path.join(dir, "node_modules", "pnpm");
    mkdirSync(path.join(pkgDir, "bin"), { recursive: true });
    writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({ name: "pnpm", bin: { pnpm: "pnpm" } }),
    );
    writeFileSync(path.join(pkgDir, "pnpm"), Buffer.from([0x4d, 0x5a, 0x90, 0x00]));
    const mjs = path.join(pkgDir, "bin", "pnpm.mjs");
    writeFileSync(mjs, '#!/usr/bin/env node\nprocess.stdout.write("12.4.1");\n');
    const r = findPnpm({
      platform: "win32",
      env: { PATH: dir, PATHEXT: ".COM;.EXE;.BAT;.CMD" },
      host: () => "/host/pwsh.EXE",
      probeRun: (cmd, args) => ({ command: cmd, args, out: "12.4.1" }),
    });
    expect(r.command).toBe(process.execPath);
    expect(r.prefixArgs).toEqual([mjs]);
  });

  it("`bin` 指向 Corepack 的**占位文本**（首行是 `#` 注释）时，同样改用 bin/pnpm.mjs（ISSUE #2597）", () => {
    /* 本机现场：`…\corepack\v1\pnpm\<ver>\pnpm` 在 `install.js` 跑过之前只是占位文件，
     * 第一行是一条 `#` 注释（**不是** shebang）。它两个字节都可打印 ⇒ 「像脚本」⇒
     * 从前会被当成交付形态选中，于是每条 pnpm 门禁都退 1（node 解析出 `SyntaxError`），
     * 而那一行读数会把自己报成 `[OK]`。与 `executable-resolve.ts` 那一侧同一条规则、
     * 同一份现场 —— 两份实现各判一次，是因为这一格不许 import 仓库内模块。 */
    const dir = mkdtempSync(path.join(tmpdir(), "pnpm-js-entry-placeholder-"));
    const pkgDir = path.join(dir, "node_modules", "pnpm");
    mkdirSync(path.join(pkgDir, "bin"), { recursive: true });
    writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({ name: "pnpm", bin: { pnpm: "pnpm" } }),
    );
    writeFileSync(
      path.join(pkgDir, "pnpm"),
      "# pnpm's native binary replaces this file during installation.\n" +
        "# Until then this hands over to ./bin/pnpm.mjs.\n",
    );
    const mjs = path.join(pkgDir, "bin", "pnpm.mjs");
    writeFileSync(mjs, '#!/usr/bin/env node\nprocess.stdout.write("12.4.1");\n');
    const r = findPnpm({
      platform: "win32",
      env: { PATH: dir, PATHEXT: ".COM;.EXE;.BAT;.CMD" },
      host: () => "/host/pwsh.EXE",
      probeRun: (cmd, args) => ({ command: cmd, args, out: "12.4.1" }),
    });
    expect(r.ok).toBe(true);
    expect(r.command).toBe(process.execPath);
    expect(r.prefixArgs).toEqual([mjs]);
  });
});

describe("工具链自证：pnpm 那一格（ISSUE #1961）", () => {
  /** 造一个「只有某个候选在盘上」的注入现场。 */
  const winEnv = (dir: string): Record<string, string | undefined> => ({
    PATH: dir,
    // 真实 Windows 默认 PATHEXT —— **不含 `.PS1`**，这正是现场的关键。
    PATHEXT: ".COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC",
  });

  it("多条目的 PATH 按**目标平台**的分隔符切（宿主是 POSIX 也要判对 Windows）", () => {
    /* `findPnpm()` 的 `platform` 是可注入的，而单测正是在 POSIX 上判 Windows 的形态。
     * 拿宿主的 `path.delimiter`（POSIX 是 `:`）去切一串 `;` 分隔的 Windows PATH，
     * 会把整串当成**一条**目录 —— 每个候选都拼成不存在的路径、判据静默答「没有」。
     * 现场那台机的 PATH 是几十条 `;` 分隔的条目，所以这不是假想形态。 */
    const firstDir = String.raw`C:\Windows\system32`;
    const nodeDir = String.raw`D:\Program Files\nodejs`;
    const hostExe = String.raw`C:\Program Files\PowerShell\7\pwsh.EXE`;
    // 真正的 pnpm 在**第二条**上：分隔符切错就整串都命中不了。
    /* `findPnpm()` 用宿主（POSIX）的 `path.join` 拼候选，分隔符会是 `/`；
     * 而这里判的是 Windows 的**形态**。把两侧的分隔符归一，判据才不依赖宿主 ——
     * 与上面那条「大小写按 NTFS 不敏感处理」是同一条理由。 */
    const norm = (p: string) => p.replaceAll(/[\\/]+/g, "\\").toLowerCase();
    const onDisk = new Set(
      [nodeDir + String.raw`\pnpm`, nodeDir + String.raw`\pnpm.ps1`, hostExe].map(norm),
    );
    const r = findPnpm({
      platform: "win32",
      env: { PATH: `${firstDir};${nodeDir}`, PATHEXT: ".COM;.EXE;.BAT;.CMD" },
      isFile: (p: string) => onDisk.has(norm(p)),
      host: () => hostExe,
      probeRun: (cmd, args) => {
        // 真垫片语义：`pwsh -File pnpm.ps1 -v` 答版本；少了 `-v` 退非零。
        if (cmd === hostExe && args.includes("-v")) {
          return { command: cmd, args, out: "12.4.1" };
        }
        return null;
      },
    });
    expect(r.ok, "第二条 PATH 上的 pnpm 必须被找到（切错分隔符会整串当成一条）").toBe(true);
    expect(r.out).toBe("12.4.1");
  });

  it("只有 `.ps1` 在盘上时也被找到，且给出「宿主 + -File」的形态", () => {
    /* 盘上只有 `pnpm.PS1`（corepack 三个形态里唯一能被 Node 起的那一个）。
     * 大小写按判据拼出来的形态写：Windows 不敏感，而 CI 跑在 POSIX 上 ——
     * 写小写会让这条用例判的是宿主的大小写敏感，不是被测逻辑。 */
    const dir = "/bin";
    const ps1 = path.join(dir, "pnpm.PS1");
    const hostExe = path.join("/host", "pwsh.EXE");
    const onDisk = new Set([ps1.toLowerCase(), hostExe.toLowerCase()]);
    // 模拟 NTFS：不敏感大小写。
    const isFile = (p: string): boolean => onDisk.has(p.toLowerCase());
    const started: Array<[string, Array<string>]> = [];
    const r = findPnpm({
      platform: "win32",
      env: winEnv(dir),
      isFile,
      host: () => hostExe,
      probeRun: (cmd: string, args: Array<string>) => {
        started.push([cmd, args]);
        return { command: cmd, args, out: "12.4.1" };
      },
    });
    expect(r.ok, "`.ps1` 在盘上却没被解析出来").toBe(true);
    expect(r.out).toBe("12.4.1");
    // 真正要 spawn 的是宿主，不是那个 `.ps1` 自己。
    expect(r.command.toLowerCase()).toBe(hostExe.toLowerCase());
    expect(r.args).toContain("-File");
    expect(r.args).toContain(ps1);
    expect(started.length).toBe(1);
  });

  it("探 `.ps1` 时**把 `-v` 一并交给垫片**（少了它，唯一能用的形态会被判成起不来）", () => {
    /* `findPnpm()` 找出 `.ps1` 后 `usablePnpm` 会**真起一次**它；第一次写时只交了宿主前缀、
     * **忘了接 `-v`** ⇒ 垫片收到空参数，corepack 的 `pnpm.ps1` 裸跑打 usage 并**退非零**
     * （实测无参数退非零、`pnpm -v` 退 0），而 `runProbe` 按退出码判 ⇒ 唯一能用的形态被否掉。
     * 注入的 `probeRun` 一律成功，故探针参数对不上只有真机看得见 —— 这一条判的就是那串参数。 */
    const dir = "/bin";
    const ps1 = path.join(dir, "pnpm.PS1");
    const hostExe = path.join("/host", "pwsh.EXE");
    const onDisk = new Set([ps1.toLowerCase(), hostExe.toLowerCase()]);
    const calls: Array<[string, Array<string>]> = [];
    const r = findPnpm({
      platform: "win32",
      env: winEnv(dir),
      isFile: (p: string) => onDisk.has(p.toLowerCase()),
      host: () => hostExe,
      /* 复刻真垫片的语义：**没收到 `-v` 就退非零**（`pnpm` 裸跑打 usage）。
       * 少了这条模拟，探针参数丢了也照绿 —— 那正是这次漏网的原因。 */
      probeRun: (cmd: string, args: Array<string>) => {
        calls.push([cmd, args]);
        return args.includes("-v") ? { command: cmd, args, out: "12.4.1" } : null;
      },
    });
    expect(r.ok, "垫片没收到 -v ⇒ 被当成起不来 ⇒ 又报「pnpm 不可用」").toBe(true);
    expect(calls.length).toBeGreaterThan(0);
    for (const [, args] of calls) {
      expect(args, "探 `.ps1` 时 `-v` 没接在宿主前缀后面").toContain("-v");
      // 宿主前缀本身不许丢（丢了就变成「拿 .ps1 当可执行文件起」）。
      expect(args).toEqual(
        expect.arrayContaining(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1]),
      );
    }
  });

  it("`.CMD` 不被当成可用形态（它在 Windows 上只有 cmd.exe 解释得了）", () => {
    /* corepack 只剩 `.cmd` 的形态：判据必须**不**认它，改报「没有可用形态」——
     * 认了就等于把「起不来的命令」交给上层，失败推迟到下一个 stage、且报错不指真因。 */
    const dir = "/bin";
    const onDisk = new Set([path.join(dir, "pnpm.CMD").toLowerCase()]);
    const r = findPnpm({
      platform: "win32",
      env: winEnv(dir),
      isFile: (/** @type {string} */ p) => onDisk.has(p.toLowerCase()),
      host: () => null,
      /**
       * @param {string} cmd
       * @param {string[]} args
       */
      probeRun: (cmd, args) => ({ command: cmd, args, out: "should-not-run" }),
    });
    expect(r.ok).toBe(false);
  });

  it("`.CMD` + `.ps1` 并排时走 `.ps1`（同目录回退），不经 cmd.exe", () => {
    const dir = "/bin";
    const ps1 = path.join(dir, "pnpm.PS1");
    const hostExe = path.join("/host", "pwsh.EXE");
    const onDisk = new Set([
      path.join(dir, "pnpm.CMD").toLowerCase(),
      ps1.toLowerCase(),
      hostExe.toLowerCase(),
    ]);
    const probed: Array<string> = [];
    const r = findPnpm({
      platform: "win32",
      env: winEnv(dir),
      isFile: (p: string) => onDisk.has(p.toLowerCase()),
      host: () => hostExe,
      probeRun: (cmd: string, args: Array<string>) => {
        probed.push(cmd);
        return { command: cmd, args, out: "12.4.1" };
      },
    });
    expect(r.ok).toBe(true);
    // 一次都没往 `.CMD` 上真起过（起了也起不来）。
    expect(probed.some((c) => /\.cmd$/i.test(c))).toBe(false);
    expect(r.args).toContain(ps1);
  });

  it("盘上什么都没有时报不可用（这一档要红，不许静默放过）", () => {
    const r = findPnpm({
      platform: "win32",
      env: winEnv("/bin"),
      isFile: () => false,
      host: () => null,
      /**
       * @param {string} cmd
       * @param {string[]} args
       */
      probeRun: (cmd, args) => ({ command: cmd, args, out: "x" }),
    });
    expect(r.ok).toBe(false);
  });

  it("POSIX 上仍认无扩展名形态（判据不按平台之外的东西分叉）", () => {
    const dir = "/bin";
    const shim = path.join(dir, "pnpm");
    const r = findPnpm({
      platform: "linux",
      env: { PATH: dir },
      isFile: (p: string) => p === shim,
      host: () => null,
      probeRun: (cmd: string, args: Array<string>) => ({
        command: cmd,
        args,
        out: "12.4.1",
      }),
    });
    expect(r.ok).toBe(true);
    expect(r.command).toBe(shim);
    expect(r.args).toEqual(["-v"]);
  });

  it("`.cnb.yml` 那一步走的是它 —— 不是裸起 pnpm 名字的旧写法", () => {
    const yml = readFileSync(path.join(ROOT, ".cnb.yml"), "utf8");
    expect(yml).toContain("node scripts/ci-toolchain-selfcheck.mjs");
    /* 脚本自己也不许退回裸名字（那正是这一格红掉的形态）。 */
    const scriptSrc = readFileSync(
      path.join(ROOT, "scripts", "ci-toolchain-selfcheck.mjs"),
      "utf8",
    );
    const code = scriptSrc
      .split("\n")
      .map((line) => line.replace(/^\s*\/\/.*$/, ""))
      .join("\n");
    expect(
      /(?:spawn|spawnSync|exec|execFile)\s*\(\s*["'`]pnpm["'`]/.test(code),
      "又退回「裸起一个 pnpm 名字」的写法了",
    ).toBe(false);
  });
});

/**
 * 「装完必须复验」那一层（ISSUE #1961）。`playwright install` 是**下载**命令，有三种「退 0 但东西
 * 没落地」：传输截断、落点不可写、CDN 回错误页（HTTP 200 的 HTML，Playwright 不解析）。
 * 所以装完有一条**活判据**（按落点找 headless shell），与「装完回到 `findPython()` 再探」同一口径：装与判是两件事。这一组两个方向都真跑，并钉「复验那一行永远到得了」（`return 0` 提前返回是这类守卫最常见的失效形态）。
 */
describe("工具链自证：装完必须复验（ISSUE #1961）", () => {
  it("落点里有 headless shell ⇒ 判过；没有 / 读不到 ⇒ 判不过", async () => {
    const { browserExecutableExists } = await import("../scripts/ci-toolchain-selfcheck.mjs");
    const root = process.platform === "win32" ? String.raw`C:\x\ms-playwright` : "/x/ms-playwright";
    const exe =
      process.platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell";

    /* 「齐」那一半边用**真临时目录**跑：判据是**活的**（`findFileUnder` 真去读 fs），
     * 只喂目录名不算数 —— 而「真读盘」恰好是这一条要与实现同源的形态。 */
    const dir = mkdtempSync(path.join(tmpdir(), "pw-"));
    try {
      const rev = path.join(dir, "chromium_headless_shell-1243");
      const nested = path.join(rev, "chrome-headless-shell-linux64");
      mkdirSync(nested, { recursive: true });
      writeFileSync(path.join(nested, exe), "");
      const hit = browserExecutableExists({
        platform: process.platform,
        env: { PLAYWRIGHT_BROWSERS_PATH: dir },
      });
      expect(hit.ok, hit.out).toBe(true);
      expect(hit.out).toContain(exe);

      // 目录在、文件不在 ⇒ 判不过（**这一格就是「退 0 但没落地」**）。
      rmSync(path.join(nested, exe));
      const miss = browserExecutableExists({
        platform: process.platform,
        env: { PLAYWRIGHT_BROWSERS_PATH: dir },
      });
      expect(miss.ok).toBe(false);
      expect(miss.out).toContain(exe);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    // 一个 `chromium_headless_shell-*` 都没有（只装了完整 chromium 的机器）⇒ 判不过。
    const none = browserExecutableExists({
      platform: process.platform,
      env: { PLAYWRIGHT_BROWSERS_PATH: root },
      list: () => ["chromium-1243", "ffmpeg-1011"],
    });
    expect(none.ok).toBe(false);
    expect(none.out).toContain("chromium_headless_shell-");

    // 落点根读不到（盘符不在这台机上 / 权限）⇒ 判不过，且把根打出来。
    const unreadable = browserExecutableExists({
      platform: process.platform,
      env: { PLAYWRIGHT_BROWSERS_PATH: "/definitely/not/here" },
      list: () => {
        throw new Error("ENOENT");
      },
    });
    expect(unreadable.ok).toBe(false);
    expect(unreadable.out).toContain("/definitely/not/here");
  });

  it("落点根按平台推（不写死盘符 / 认环境变量）", async () => {
    const { playwrightBrowsersRoot } = await import("../scripts/ci-toolchain-selfcheck.mjs");
    /* ⚠️ 期望值一律用**目标平台**的 join 拼（`node:path` 是**宿主**那一份）。判据可注入 `platform`，
     * 这组会**在一种平台上判另一种平台** —— 拿宿主 `path.join` 会随跑判据的机器变（平台侧实测报
     * 「`expected` 反斜杠路径、`to be` 正斜杠路径」）。与 `executable-resolve.ts` 那句「大小写不敏感
     * 只按目标平台」同一口径。 */
    /* 包成箭头函数：直接传 `path.win32.join` 会被 `unbound-method` 判为「方法与
     * 自己的对象分了家」（`path.join` 本身不读 `this`，但规则看不出来）。 */
    const win = (...parts: Array<string>) => path.win32.join(...parts);
    const posix = (...parts: Array<string>) => path.posix.join(...parts);
    expect(
      playwrightBrowsersRoot({
        platform: "win32",
        env: { LOCALAPPDATA: String.raw`D:\Users\ci\AppData\Local` },
      }),
    ).toBe(win(String.raw`D:\Users\ci\AppData\Local`, "ms-playwright"));
    expect(
      playwrightBrowsersRoot({
        platform: "darwin",
        env: { HOME: "/h" },
      }),
    ).toBe(posix("/h", "Library", "Caches", "ms-playwright"));
    expect(playwrightBrowsersRoot({ platform: "linux", env: { HOME: "/h" } })).toBe(
      posix("/h", ".cache", "ms-playwright"),
    );
    // 显式指定就听它的（自托管那台机把用户数据放在 D: 盘）。
    expect(
      playwrightBrowsersRoot({
        platform: "win32",
        env: { PLAYWRIGHT_BROWSERS_PATH: String.raw`E:\pw` },
      }),
    ).toBe(String.raw`E:\pw`);
  });

  it("复验真的排在「装」之后，且不过要非零退出（不许提前 return 0）", () => {
    /* 浏览器那一层的实现住在 `scripts/ci-toolchain-browser.mjs`（§12.6 R5 的 900 行
     * 硬闸下拆出来的，与 `ci-toolchain-python.mjs` 同一条边界）。 */
    const src = readFileSync(path.join(ROOT, "scripts", "ci-toolchain-browser.mjs"), "utf8");
    const body = src.slice(
      src.indexOf("export function playwrightOnly("),
      src.indexOf("export function browserExecutableExists("),
    );
    const installAt = body.indexOf("runPlaywrightInstall({");
    /* ⚠️ **从 `installAt` 之后找**：函数里有两处 `browserExecutableExists` —— 一处是装**之前**
     * 「已装就跳过」（排在 `installAt` 前），一处才是复验。从函数头 `indexOf` 会命中前者，
     * 于是这条判据答的是「跳过那一支在装之前」而**照样会绿** —— 判据指到了同形的邻居上。 */
    const verifyAt = body.indexOf("browserExecutableExists({ env })", installAt);
    expect(installAt).toBeGreaterThan(0);
    expect(
      verifyAt,
      "复验那一行不见了 —— `playwright install` 退 0 就成了唯一判据，而它有三种「退 0 但没落地」的形态",
    ).toBeGreaterThan(installAt);
    // 复验不过的分支里必须退非零（只是打印一句不算）。
    const after = body.slice(verifyAt);
    expect(after).toContain("if (!present.ok)");
    expect(after).toContain("return 1");
  });
});

/**
 * 「退出码真的转出去了」（ISSUE #1961，本文件自己的第二个坑）。守卫此前是裸 `main();`，而它的
 * 返回值就是退出码 ⇒ `--python-only` / `--playwright-only` 里的 `return 1` **全被吞掉**，进程恒退 0。
 * 实测：复验指到空落点时它打了「报了成功，但那一件二进制不在盘上」并 `return 1`，退出码仍是 0 —— 那段话是给人看的，判据读的是退出码；这两步存在的意义就是「缺件时红」，而它们从来红不了。
 */
describe("工具链自证：退出码必须转出去（ISSUE #1961）", () => {
  it("守卫把 `main()` 的返回值交给 `process.exit()`", () => {
    const src = readFileSync(path.join(ROOT, "scripts", "ci-toolchain-selfcheck.mjs"), "utf8");
    /* 按源码形状钉：末尾那一段里必须有 `process.exit(main())`。
     * 裸 `main();` 正是被吞码的形态 —— 它的表现是「打了未通过、退出码 0」。 */
    const guard = src.slice(src.indexOf("import.meta.filename"));
    expect(
      /process\.exit\(\s*main\(\)\s*\)/.test(guard),
      "守卫又写成裸 `main();` 了 —— `--python-only` / `--playwright-only` 的 `return 1` 会被吞掉，进程恒退 0",
    ).toBe(true);
  });

  it("真起一次进程：`--playwright-only` 判不过时**退出码是 1**", () => {
    /* 真起子进程跑一次（不 import）：退出码只在**进程**那一层看得见。用「落点指空目录」造出
     * 「install 报成功、二进制不在盘上」那一态。补丁只打在 `ci-toolchain-browser.mjs`（两句都在
     * 那一份里），`ci-toolchain-selfcheck.mjs` 的守卫（`process.exit(main())`）走**真实现**。 */
    const empty = mkdtempSync(path.join(tmpdir(), "pw-empty-"));
    const browserProbe = path.join(ROOT, "scripts", "ci-toolchain-browser.mjs");
    const probe = path.join(ROOT, "scripts", ".tmp-exitcode-probe.mjs");
    const backup = path.join(tmpdir(), `browser-backup-${Date.now()}.mjs`);
    const browserSrc = readFileSync(browserProbe, "utf8");
    writeFileSync(backup, browserSrc);
    try {
      /* ⚠️ 三处补丁都是按源码**原文**替换的（`String.replace` 不匹配时**静默
       * no-op**），而 `ci-toolchain-browser.mjs` 会变 —— 实测过一次：`install` 那处
       * 在 `runPlaywrightInstall({` 多行化之后就没再匹配上，于是这一条不再判
       * 「退出码转没转出去」，退化成「这台机器装没装浏览器」（多数机器装得上 ⇒
       * **照样绿**）。所以三处各自判一次「真的改了」，缺一即红。 */
      writeFileSync(
        browserProbe,
        browserSrc
          // ① 装那一步假装成功（不动真落点、不下 100MB）。
          //    ⚠️ 锚点取**调用开头那半句**（后面是换行的参数列表），
          //    把 `runPlaywrightInstall({` 到它闭合的那一段整块换掉。
          .replace(
            / {2}const install = runPlaywrightInstall\(\{[\s\S]*?^ {2}\}\);\n/m,
            '  const install = { ok: true, out: "(probe: 假装 install 退 0)" };\n',
          )
          // ①′ 「已装就跳过下载」那一支也要让开：它按**真落点**判，而这一条的现场
          //     恰恰是「install 报成功、二进制不在盘上」—— 不让开的话它会先返回 0。
          .replace(
            "  const already = browserExecutableExists({ env });",
            "  const already = { ok: false, out: '(probe: 不跳过)' };",
          )
          // ①″ **自取成功那一支的提前返回**同病、更隐蔽：同样按**真落点**判，而本仓的 Linux 检出
          //     与自托管节点可能**预装**那一件 ⇒ 自取一「成」就当场返回 0，把「补丁只打在 `already`
          //     上」的现场顶掉（实测 `STATUS: 0`，输出停在「自取成功：已就位」）。
          //     锚点取**条件那半句**：`curly` 补 `{}` 后这里是两行，钉整句（含 ` return 0;`）会静默 no-op
          //     —— 那正是下面对账要抓的形态。
          .replace(
            "if (seeded.ok && browserExecutableExists({ env }).ok) {",
            "if (false && seeded.ok && browserExecutableExists({ env }).ok) {",
          )
          // ② 复验指向一个空落点 ⇒ 「退 0 但没落地」那一态
          .replace(
            "  const present = browserExecutableExists({ env });",
            `  const present = browserExecutableExists({ env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: ${JSON.stringify(
              empty,
            )} } });`,
          ),
      );
      /* **反向复算**：三处（installation / 两处早退）都必须真的落到盘上。
       * 少了任何一处，这一条就变成在测「这台机器装没装浏览器」——那是**恒真**的。 */
      const patchedSrc = readFileSync(browserProbe, "utf8");
      const planted: Array<[string, (s: string) => boolean]> = [
        ["安装那一步（①）", (t) => t.includes('const install = { ok: true, out: "(probe')],
        [
          "「已装就跳过」（①′）",
          (t) => t.includes("const already = { ok: false, out: '(probe: 不跳过)' }"),
        ],
        [
          "自取成功那条早退（①″）",
          (t) => t.includes("if (false && seeded.ok && browserExecutableExists"),
        ],
      ];
      for (const [label, hit] of planted) {
        expect(
          hit(patchedSrc),
          `补丁「${label}」没落到盘上 —— 这一条会退回成「这台机器装没装浏览器」` +
            "（那多半是装得上的，于是它**照样绿**）",
        ).toBe(true);
      }
      /* 子进程跑**真**的那个入口（它 import 的是补过的那份 browser 模块）。 */
      writeFileSync(
        probe,
        readFileSync(path.join(ROOT, "scripts", "ci-toolchain-selfcheck.mjs"), "utf8"),
      );
      const r = spawnSync(process.execPath, [probe, "--playwright-only"], {
        encoding: "utf8",
      });
      expect(
        r.status,
        "复验判不过时退出码仍是 0 —— 守卫把 `main()` 的返回值吞了，" +
          "而这一步存在全部意义就是「缺件时红」",
      ).toBe(1);
      expect(
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- spawnSync 起不来时 stdout/stderr 实测为 undefined，@types/node 按非空标，空串兜底保留
        `${r.stdout ?? ""}${r.stderr ?? ""}`,
        "判不过时得把那句话打出来（退出码与话术两件都要有）",
      ).toContain("不在盘上");
    } finally {
      /* 把真实现还原回去 —— 这一条**改的是盘上的实现文件**（判据必须在真进程里跑），
       * 所以还原进 `finally`，任何一条断言失败都不许把它留在改过的状态上。 */
      writeFileSync(browserProbe, readFileSync(backup, "utf8"));
      rmSync(backup, { force: true });
      rmSync(probe, { force: true });
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

/**
 * 装浏览器失败时给的是**读数**（ISSUE #1961，同一格第五个面）。此前只有「网络到 CDN 不通、或磁盘满」，而两种处置相反：
 * 不通要换镜像（`PLAYWRIGHT_DOWNLOAD_HOST`），没量完要放宽超时（`PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT`）。现场 `cnb-rkr-1k510rsgg` 是后者 —— 180 MiB 撞上 Playwright 默认 30s 套接字超时（`NET_DEFAULT_TIMEOUT`，原文 `timed out after 30000ms`）。
 * 判两条：真撞上下载失败时逐条点出试过的地址 + 两个出口；别的失败形态（pnpm 不可用、盘满）不许被塞这两条建议。
 */
describe("工具链自证：下载失败的读数是读数，不是又一句「装不上」（ISSUE #1961）", () => {
  it("下载超时的现场：逐条地址 + 两个环境变量出口", () => {
    const text = playwrightInstallHints(
      [
        "Downloading Chrome for Testing …",
        "Failed to install browsers",
        "Error: Request to https://cdn.playwright.dev/builds/cft/153.0.8010.12/win64/chrome-win64.zip timed out after 30000ms",
      ].join("\n"),
    ).join("\n");
    // 试着下过哪一件 —— 没有它，下一个人只能再猜一轮。
    expect(text).toContain("chrome-win64.zip");
    // 两个出口都是 Playwright 自己的键（本仓不发明第二套）。
    expect(text).toContain("PLAYWRIGHT_DOWNLOAD_HOST");
    expect(text).toContain("PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT");
    // 「不是结论」这一层要说出来：30s 是套接字超时，不是「这个地址不通」。
    expect(text).toContain("套接字");
  });

  it("别的失败形态不给这两条建议（读数只跟着它对得上的那一档）", () => {
    expect(playwrightInstallHints("pnpm 不可用，装不了浏览器")).toEqual([]);
    expect(playwrightInstallHints("")).toEqual([]);
  });

  it("`.cnb.yml` 把套接字超时放宽了（只关「多久放弃」，不改任何判据）", () => {
    const yml = read(".cnb.yml");
    /* 这一步是本档**唯一**能碰到「下载」这件事的地方：`env` 的键写错了不会有任何
     * 解析期报错，只会在下一次下载时以同一个形态（180 MiB 撞 30s）再红一次。 */
    expect(
      yml,
      "`浏览器安装` 没设 `PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT` —— 默认的 30s 是" +
        "**套接字**超时，180 MiB 的包在慢链路上会被它按时掐断",
    ).toContain("PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT");
  });

  it("同族域名被反复试时，出口是「给一个能通的根」而不是「再放宽一点」", () => {
    /* 第三次红（`cnb-gt1-1k513ill4`）的形态：日志里 5 条 `Downloading … from
     * cdn.playwright.dev`，然后 `Download failure, code=1`。Playwright 自己的三个内置
     * 镜像**全同族**（`cdn.playwright.dev` / `playwright.download.prss.microsoft.com`），
     * 这一族一起不通时它 `retryCount = 5` 的回退等于没有 —— 所以那一段读数必须点名
     * 「缺的是一条能通的根」，而不是把人引到「超时再改大一点」那条错路上。 */
    const text = playwrightInstallHints(
      [
        "Downloading Chrome for Testing 153.0.8010.12 (playwright chromium v1243) from https://cdn.playwright.dev/builds/cft/153.0.8010.12/win64/chrome-win64.zip",
        "Downloading Chrome for Testing 153.0.8010.12 (playwright chromium v1243) from https://cdn.playwright.dev/builds/cft/153.0.8010.12/win64/chrome-win64.zip",
        "Failed to install browsers",
        "Error: Request to https://cdn.playwright.dev/builds/cft/153.0.8010.12/win64/chrome-win64.zip timed out after 120000ms",
      ].join("\n"),
    ).join("\n");
    expect(text).toContain("同族");
    expect(text).toContain("PLAYWRIGHT_DOWNLOAD_HOST");
    // 同族那一档**不许**再给「放宽超时」那条建议 —— 它在这里没用（试过了）。
    expect(text).not.toContain("PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT=120000");
  });

  /**
   * **读数不许推荐已经做过的动作**（ISSUE #1966 续集，现场 `cnb-ald-1k51g8dt9`）。那一次 `.cnb.yml`
   * 已配 `PLAYWRIGHT_DOWNLOAD_HOST`、超时已放宽到 120000，而失败那趟用的**就是**那个根与 120000ms；
   * 旧话术照旧说「30s 是默认」并建议「放宽到 120000」，两句都指回做过的动作 ⇒ 照做再红一次（§13.5.3.5.1）。
   */
  it("配着的第三方根失败了 ⇒ 那两条常用出口点名为「已经做过」，并给出剩下的出路", () => {
    const out = [
      "下载根由 PLAYWRIGHT_DOWNLOAD_HOST 指定：https://cdn.npmmirror.com/binaries/playwright",
      "Downloading Chrome Headless Shell 153.0.8010.12 from https://cdn.npmmirror.com/binaries/playwright/builds/cft/153.0.8010.12/win64/chrome-headless-shell-win64.zip",
      "Downloading Chrome Headless Shell 153.0.8010.12 from https://cdn.npmmirror.com/binaries/playwright/builds/cft/153.0.8010.12/win64/chrome-headless-shell-win64.zip",
      "Failed to install browsers",
      "Error: Download failure, code=1",
      "Error: Request to https://cdn.npmmirror.com/binaries/playwright/builds/cft/153.0.8010.12/win64/chrome-headless-shell-win64.zip timed out after 120000ms",
    ].join("\n");
    const facts = playwrightInstallHintFacts({
      PLAYWRIGHT_DOWNLOAD_HOST: "https://cdn.npmmirror.com/binaries/playwright",
      PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT: "120000",
    });
    const text = playwrightInstallHints(out, facts).join("\n");
    /* ① 生效的超时值必须与现场对得上（旧话术在这里说的是「30s」）。 */
    expect(text, "读数里的超时值与现场对不上 —— 人照它改会改错方向").toContain("120000ms");
    expect(text).not.toContain("30s 是 Playwright 的默认");
    /* ② 那两条出口要**点名为已经做过**，而不是再建议一遍。 */
    expect(text).toContain("都已经做过了");
    expect(text, "又把「放宽到 120000」当建议给出来了 —— 那正是现场已经配着的值").not.toContain(
      "放宽：PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT=120000",
    );
    /* ③ 剩下的出路必须给出来（在宿主机 / 网络侧，不是仓库里）。 */
    expect(text).toContain("预先把 chromium-headless-shell 装进落点");
  });

  it("**实测那个数**才算数：超时还是缺省时，「放宽」那一条照旧给（反向复算）", () => {
    /* 现场是 30s（缺省）那一档 ⇒ 「放宽」是真的还没走过。
     * ⚠️ 判据按**实测的那个数**分岔，不按「env 里有没有提过这个键」：
     * 输出里那句 `timed out after <N>ms` 比 env 更贴现场（env 可能没传进子进程）。 */
    const out = [
      "Downloading Chrome Headless Shell 153.0.8010.12 from https://cdn.npmmirror.com/binaries/playwright/builds/cft/153.0.8010.12/win64/x.zip",
      "Failed to install browsers",
      "Error: Request to https://cdn.npmmirror.com/binaries/playwright/builds/cft/153.0.8010.12/win64/x.zip timed out after 30000ms",
    ].join("\n");
    const notRaised = playwrightInstallHints(
      out,
      playwrightInstallHintFacts({
        PLAYWRIGHT_DOWNLOAD_HOST: "https://cdn.npmmirror.com/binaries/playwright",
      }),
    ).join("\n");
    expect(notRaised, "缺省超时那一档把「放宽」也吞掉了 —— 那是还没走过的出口").toContain(
      "PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT",
    );
  });

  it("`playwrightInstallHintFacts()` 读的是**生效值**：0 / 空 / 非数字不算放宽", () => {
    expect(
      playwrightInstallHintFacts({
        PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT: "120000",
      }).timeoutMs,
    ).toBe(120_000);
    /* 与 Playwright 自己的算法同口径（`+(v || "0") || NET_DEFAULT_TIMEOUT`）：
     * 这类值会被它当成「没设」，读数里点它们只会把人指错。 */
    for (const raw of ["", "0", "abc"]) {
      expect(
        playwrightInstallHintFacts({
          PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT: raw,
        }).timeoutMs,
        `把 ${JSON.stringify(raw)} 当成了生效的超时值`,
      ).toBe(null);
    }
  });

  it("`.cnb.yml` 给了一个下载根 —— 同一族不通的节点上这是唯一的出路", () => {
    const yml = read(".cnb.yml");
    expect(
      yml,
      "`浏览器安装` 没给 `PLAYWRIGHT_DOWNLOAD_HOST`：Playwright 的三个内置镜像**同族**，" +
        "这一族不通时它自己的重试等于没有（实测 5 次全落在同一个域名上）",
    ).toContain("PLAYWRIGHT_DOWNLOAD_HOST");
  });
});

/**
 * 「已装就不下载」那一支（ISSUE #1961 第三次红）。这一跑 1732s 门禁全绿，最后红在这步下载，
 * 而机器上**什么都不缺**（浏览器早在盘上，只是这一步无条件又下了一遍）。判两层：装过的**不装**
 * （跳过而非重下），且跳过这一支仍判「东西落地了」—— 不许把「只装了一半」放过去。
 */
/**
 * 静音的打印三件套 —— 只判行为、不判话术的那些用例用。收成函数而不是各处写 `() => {}`：
 * 空箭头会被 `no-empty-function` 判红，而这几条关心的是**起没起进程**，不是打了什么。
 */
function silentPorts() {
  /* 用 `String` 当实现：它是**真调用**（不是空函数体），所以
   * `no-empty-function` 不会红，而这几条用例本来也不看打印。 */
  return { log: String, logError: String, section: String };
}

describe("工具链自证：装过的就不装（ISSUE #1961）", () => {
  /** 造一份「headless shell 已在落点」的假 env + 假落点。 */
  function readyEnv() {
    const dir = mkdtempSync(path.join(tmpdir(), "pw-ready-"));
    const exe =
      process.platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell";
    const nested = path.join(dir, "chromium_headless_shell-1243", "chrome-headless-shell-linux64");
    mkdirSync(nested, { recursive: true });
    writeFileSync(path.join(nested, exe), "");
    return dir;
  }

  it("落点里两件都齐 ⇒ 一次下载都不发起（`playwright install` 根本没被起过）", () => {
    const dir = readyEnv();
    try {
      /** @type {string[][]} */
      const spawned: Array<Array<string>> = [];
      const code = playwrightOnly({
        env: { PLAYWRIGHT_BROWSERS_PATH: dir },
        find: () => ({
          ok: true,
          command: "pnpm",
          prefixArgs: [],
          args: ["-v"],
          out: "12.4.1",
        }),
        seed: () => ({ ok: false, out: "（判据里不真取）" }),
        exec: (/** @type {string} */ _cmd, /** @type {string[]} */ args) => {
          spawned.push(args);
          return { ok: false, out: "(不该被调到)" };
        },
        ...silentPorts(),
      });
      expect(code).toBe(0);
      expect(
        spawned,
        "装过的机器上仍然去下了 —— 链路一抖，一条什么都不缺的流水线也会红在这里",
      ).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("只装了完整 chromium（没有 headless shell）⇒ 仍然要装，不许跳过", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pw-half-"));
    try {
      // 只有 `chromium-1243`：这是 headless 档**真正要用的那一件不在**的形态。
      mkdirSync(path.join(dir, "chromium-1243"), { recursive: true });
      /** @type {string[][]} */
      const spawned = [];
      const code = playwrightOnly({
        env: { PLAYWRIGHT_BROWSERS_PATH: dir },
        find: () => ({
          ok: true,
          command: "pnpm",
          prefixArgs: [],
          args: ["-v"],
          out: "12.4.1",
        }),
        /* ⚠️ **自取那条通道必须一起注入成「不装」**：缺省实现会去 CDN 真取 120 MiB（分片那条路
         * 在这台机器上 23 秒取完、装进这个临时落点），于是这条量到的是「自取成功 ⇒ 跳过老路」，
         * 与它要判的「只装了完整 chromium 时**不许跳过**」是两件事 —— 而它照样会红/绿。
         * 判据里也不许出网：`pnpm test` 在离线容器里要绿。 */
        seed: () => ({
          ok: false,
          out: "（判据里不真取：这一条判的是老路会不会被跳过）",
        }),
        exec: (/** @type {string} */ _cmd, /** @type {string[]} */ args) => {
          spawned.push(args);
          return { ok: false, out: "boom" };
        },
        ...silentPorts(),
      });
      expect(
        spawned.length,
        "只装了完整 chromium 就跳过了 —— headless 档用的是 chromium_headless_shell，" +
          "两者是 browsers.json 里的两个条目",
      ).toBeGreaterThan(0);
      expect(code).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * 「下载根从哪来」那一档（ISSUE #1961）。`PLAYWRIGHT_DOWNLOAD_HOST` 设了就**只用它**（人已知道该
 * 走哪儿，不必再陪 Playwright 挨试三档不通的内置镜像）；没设则回空宿主 = 走默认行为，**不替它挑**
 * 第三方镜像 —— 那等于把「哪面墙怎么过」写死在仓里，换台机器就静默失效。
 */
describe("工具链自证：下载根由外面给，不由本仓猜（ISSUE #1961）", () => {
  it("设了就只用它；没设就回退到 Playwright 的默认（不发明第二个镜像）", () => {
    expect(playwrightHostsToTry({ PLAYWRIGHT_DOWNLOAD_HOST: "https://m/x" })).toEqual([
      "https://m/x",
    ]);
    expect(playwrightHostsToTry({})).toEqual([undefined]);
  });

  /**
   * **「只用它」是一条判据，不是一句注释**（ISSUE #1961 第四次红）。现场 `cnb-g9d-1k515kvrq` 两条「正在从同一个根下载」后 `timed out after 120000ms` —— 同一个根被拆成两条。
   * 外面给的根替不掉它自己那一族，再试内置族不是多一条出路，还把 `playwrightInstallHints()` 两档读数搅坏；上面那条用例只钉函数返回值，钉不住 `runPlaywrightInstall()` 怎么用它们（换回循环里行为就回去）。
   * 故这一条改判**真响了几次**：设了根且量不到时恰好一次且就是它；补「先量一次再挑根」后前提变细 —— 只试一个根从「配了根」变成「配了根**且**量得到」，两分支处置相反、各判一条（`pickPlaywrightRoots()`）。
   */
  it("配着的根量得到 ⇒ 仍然只起一次、且用的就是它（别去试那些不通的）", () => {
    /** @type {Array<string | undefined>} */
    const hosts: Array<string | undefined> = [];
    const r = runPlaywrightInstall({
      env: { PLAYWRIGHT_DOWNLOAD_HOST: "https://m/x" },
      find: () => ({
        ok: true,
        command: "pnpm",
        prefixArgs: [],
        args: ["-v"],
        out: "12.4.1",
      }),
      /* 判据一律注入探测面：**这条用例不许出网**（缺省会真去量一圈候选，
       * 结论还取决于跑判据那台机器连不连得上 CDN —— 那种判据只会在别人机器上红）。 */
      probe: () => "HTTP 200",
      exec: (
        /** @type {string} */ _cmd,
        /** @type {string[]} */ _args,
        /** @type {string | undefined} */ host,
      ) => {
        hosts.push(host);
        return { ok: false, out: "Download failure, code=1" };
      },
    });
    expect(
      hosts[0],
      "配着的根本来就量得到，却还去试它替不掉的那一族 —— 同一次不通再花一遍时间，" +
        "而且试过的根一多，「同族被反复试」那档读数就再也不成立（实测被读成另一个方向）",
    ).toBe("https://m/x");
    expect(r.ok).toBe(false);
  });

  /**
   * 另一半：**配着的那个根量不到时，候选表接过去**（ISSUE #1959 第六跑，本格第六次红）。现场 `cnb-t3f-1k51ho0k2` 的 `环境前提 ✓`（`cdn.npmmirror.com` 200 / `cdn.playwright.dev` 307），四十秒后 `浏览器安装 ✗ timed out after 120000ms` —— 同一根、同一机、同一分钟。
   * 「哪个根到得了」早有读数，却与「装」之间没有执行者（结论只落在一行会滚走的读数里），同一句超时连着红三次（`cnb-gt1-1k513ill4` / `cnb-g9d-1k515kvrq` / `cnb-t3f-1k51ho0k2`）。
   * 这与「给上了就只用它」不冲突：那条反对**盲目重试同族**，这里试的根是**量出来的**（先 HEAD 一次，2xx 才进候选）。
   */
  it("配着的根量不到 ⇒ 量得到的那个接过去（这一步从「配一次」变成「量一次」）", () => {
    /** @type {Array<string | undefined>} */
    const hosts: Array<string | undefined> = [];
    const r = runPlaywrightInstall({
      env: { PLAYWRIGHT_DOWNLOAD_HOST: "https://m/x" },
      find: () => ({
        ok: true,
        command: "pnpm",
        prefixArgs: [],
        args: ["-v"],
        out: "12.4.1",
      }),
      /* 只有 npmmirror 那一个根量得到（现场就是这样：配着的那个超时、别的根 200）。 */
      probe: (url) =>
        url.includes("npmmirror.com/binaries") ? "HTTP 200" : "超时（8000ms 内没有响应）",
      exec: (
        /** @type {string} */ _cmd,
        /** @type {string[]} */ _args,
        /** @type {string | undefined} */ host,
      ) => {
        hosts.push(host);
        return { ok: true, out: "ok" };
      },
    });
    expect(r.ok).toBe(true);
    /* 配着的那个根（判为超时）**不再打头**：改从量得到的那个开始。
     * 断言的是「第一个换人了」，不是「恰好几次」—— 后面还能试几个由候选表说了算，
     * 写死次数等于把这张表的长度也钉进判据里（它本来就会随新增镜像变）。 */
    expect(
      hosts[0],
      "配着的根量不到、而别的根量得到 —— 装那一步却还是从配着的那个开始，它必然再红一次",
    ).toContain("npmmirror.com/binaries");
    /* 换根之后那一次就成功了 ⇒ 配着的那个根**一次都没被试过**（不是「试了两次」）。
     * 这正是与旧行为的分界：旧行为里 `hosts[0]` 恒是配着的那个。 */
    expect(hosts).not.toContain("https://m/x");
    expect(
      r.probes?.join("\n"),
      "换根这件事必须在读数里留痕（哪几个量到了、用的哪个）—— 否则下一次核对配置与日志时" +
        "会以为配置被吃掉了",
    ).toContain("https://m/x");
  });

  it("没设根时不许替它挑一个镜像（源码里不写死任何根）", () => {
    expect(
      playwrightDownloadRoots({}),
      "没设 `PLAYWRIGHT_DOWNLOAD_HOST` 时本仓自己给了一个根 —— 那等于把" +
        "「哪面墙怎么过」写死在仓里，换台机器就静默失效",
    ).toEqual([undefined]);
    expect(playwrightDownloadRoots({ PLAYWRIGHT_DOWNLOAD_HOST: "https://m/x" })).toEqual([
      "https://m/x",
    ]);
  });

  it("`runPlaywrightInstall` 把根逐次交给子进程（不是设一次全局）", () => {
    /** @type {Array<string | undefined>} */
    const hosts: Array<string | undefined> = [];
    const r = runPlaywrightInstall({
      env: { PLAYWRIGHT_DOWNLOAD_HOST: "https://m/x" },
      find: () => ({
        ok: true,
        command: "pnpm",
        prefixArgs: [],
        args: ["-v"],
        out: "12.4.1",
      }),
      exec: (
        /** @type {string} */ _cmd,
        /** @type {string[]} */ _args,
        /** @type {string | undefined} */ host,
      ) => {
        hosts.push(host);
        return { ok: true, out: "ok" };
      },
      /* 同上：注入探测面（配着的根量得到 ⇒ 只试它），这条用例**不出网**。 */
      probe: () => "HTTP 200",
    });
    expect(r.ok).toBe(true);
    expect(hosts[0]).toBe("https://m/x");
    expect(hosts).toHaveLength(1);
    // 命令行里**不许**出现探针参数（那是 `findPnpm().args` 的形态，拼进去只会打印版本）。
    expect(r.args).not.toContain("-v");
  });
});

/**
 * 失败后**当场量一次**「这台机器出得去哪些下载域」（ISSUE #1961 第四跑）。镜像那行是在别处量出来能用的（`cdn.npmmirror.com` 回 200、15s 收到 99 MiB），
 * 而平台节点上照旧 `timed out after 120000ms` ⇒「换个镜像」看起来做了、实际没解决。缺的不是再猜一个镜像，而是**一条关于这台机器的事实**。
 * 判据三条：每个候选都出一条结论（不吞）、三条结论分得开（超时 / 解析不了）、且**只打印不阻断**（真判据仍是「装完能起才放行」）。
 */
describe("工具链自证：下载失败时当场量「到得了哪」（ISSUE #1961）", () => {
  it("逐个候选都出一条结论，且「超时」与「解析不了」分得开", () => {
    const lines = playwrightReachability({
      candidates: ["https://ok/x", "https://slow/x", "https://nxdomain/x"],
      probe: (url) =>
        url.includes("ok")
          ? "HTTP 200"
          : url.includes("slow")
            ? "超时（8000ms 内没有响应）"
            : "ENOTFOUND：getaddrinfo",
      /* 量的是**真资源 URL**（`builds/cft/<版本>/<档>/<包>`）不是裸根 ——
       * 根对这几个地址都回 4xx（ISSUE #1966），所以这里把「根 → 真资源 URL」
       * 那一步钉成固定值，读数才可断言、且不依赖盘上的 `browsers.json`。 */
      probeUrlOf: (root: string) =>
        `${root}/builds/cft/TESTV/win64/chrome-headless-shell-win64.zip`,
      updateHost: "https://ok/x",
    }).join("\n");
    // 每个候选都要在读数里 —— 少一条，「哪条路走不通」就答不全。
    expect(lines).toContain(
      "https://ok/x/builds/cft/TESTV/win64/chrome-headless-shell-win64.zip → HTTP 200",
    );
    expect(lines).toContain(
      "https://slow/x/builds/cft/TESTV/win64/chrome-headless-shell-win64.zip → 超时",
    );
    /* 「连上了但不说话」与「域名都解析不了」是两件事（链路慢 / 被拦 vs DNS 被切），
     * 处置不同 —— 糊成一句「不通」等于把这一格又还回去。 */
    expect(lines).toContain(
      "https://nxdomain/x/builds/cft/TESTV/win64/chrome-headless-shell-win64.zip → ENOTFOUND",
    );
    // 当前值也打出来：它是「人配的那个」与「真能通的那个」对账的锚。
    expect(lines).toContain("当前 PLAYWRIGHT_DOWNLOAD_HOST: https://ok/x");
    // 判读那几句要说清「全都超时 ⇒ 换镜像也不会变」——不然人只会再换一个域名。
    expect(lines).toContain("换镜像也不会变");
  });

  it("探测本身出错也当成一条读数（不抛、不吞）", () => {
    const lines = playwrightReachability({
      candidates: ["https://x/y"],
      probe: () => {
        throw new Error("boom");
      },
    }).join("\n");
    expect(lines).toContain("探测本身出错");
    expect(lines).toContain("boom");
  });

  it("装失败时它真的被打印（不是写了没人调）", () => {
    /** @type {string[]} */
    const printed: Array<string> = [];
    const code = playwrightOnly({
      env: { PLAYWRIGHT_DOWNLOAD_HOST: "https://x" },
      find: () => ({
        ok: true,
        command: "pnpm",
        prefixArgs: [],
        args: ["-v"],
        out: "12.4.1",
      }),
      exec: () => ({ ok: false, out: "Download failure, code=1" }),
      probe: () => "超时（8000ms 内没有响应）",
      ...silentPorts(),
      log: (/** @type {string} */ line: string) => printed.push(line),
    });
    expect(code).toBe(1);
    expect(
      printed.join("\n"),
      "装失败时没有打「到得了哪」那份现场 —— 下一个动作就只能靠猜",
    ).toContain("这台机器出得去哪些下载域");
  });
});

/**
 * 「这个下载根**到不到得了**」：判据必须**真把字节取回来**（ISSUE #1966 续集）。立案现场 `cnb-ald-1k51g8dt9` —— HEAD 答的是「允不允许被取」。
 * HEAD 给 200，真实下载同一个 URL 却 `timed out after 120000ms`（**0 字节**），于是 `环境前提` 报绿、30 分钟后的失败原样放行。故在**真 HTTP 服务**上判（注入 `probe` 等于换掉要判的东西）：四种现场都造（206 / 302 / 有头无 body / 404），且 206 只取一小段、302 跟随、有头无 body 与连不上分开、404 有响应头也不算通。
 * ⚠️ 服务须起在**子进程**里：探测是 `spawnSync` 起的另一个 node 进程，容器里子进程够不到父进程监听的 localhost（实测同进程 `fetch` 通、`spawnSync` 起 `ECONNRESET`），兄弟子进程才通 ⇒ 服务用 `spawn` 起、探测用 `spawnSync` 起。
 */
/**
 * **等一条来自子进程 stdout 的读数，并给它一个失败上限**。`expect.poll` 等的是**同一进程**里的值，
 * 而这里的读数不在本进程（父亲够不到子进程的 stdout）；故真时间不是「赌多久能成」而是失败上限 ——
 * `match`（`1` 号捕获组当结果）一命中就 `clearTimeout` 返回，上限只负责让「子进程压根没起来」有可读失败、不挂死用例。
 */
function firstStdoutMatch(
  child: ChildProcess,
  match: RegExp,
  { timeoutMs = 5000, what }: { timeoutMs?: number; what: string },
): Promise<string> {
  // sleep-ok: 等的是**子进程 stdout 推上来的那一行**（父亲够不到，`expect.poll` 也够不着跨进程的流），
  // 定时器只当「子进程压根没起来」的失败上限，命中即 clear。
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${what} 没在 ${timeoutMs}ms 内报出来 —— 这条用例的夹具坏了`));
    }, timeoutMs);
    let buffered = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      buffered += String(chunk);
      const m = match.exec(buffered);
      if (!m) {
        return;
      }
      clearTimeout(timer);
      resolve(m.groups?.value ?? "");
    });
    child.on("error", (error: Error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

describe("下载根探测：HEAD 答不了「取得下来吗」，必须真取字节（ISSUE #1966）", () => {
  /** 现场类型 → 起在子进程里的那个握手服务。 */
  const SERVER_CASES: Record<string, string> = {
    /** 206 + 一段 body。 */
    ok: `res.writeHead(206, { "content-length": "4096" }); res.end(Buffer.alloc(4096, 7));`,
    /** 302 → 真资源（Playwright 自己也跟随）。 */
    redirect: `if (req.url === "/root/builds/cft/1/win64/x.zip") { res.writeHead(302, { location: "/real/x.zip" }); res.end(); return; } res.writeHead(200); res.end(Buffer.alloc(1024, 1));`,
    /** 响应头给了、body 一个字节都不给 —— 现场那一档。 */
    stall: `res.writeHead(200, { "content-length": "1048576" }); res.flushHeaders();`,
    /** 首跳 302 到一个**永不给 body** 的真资源 —— 「重定向那一跳卡住」的形态。 */
    redirectStall: `if (req.url === "/root/builds/cft/1/win64/x.zip") { res.writeHead(302, { location: "/stall/x.zip" }); res.end(); return; } res.writeHead(200, { "content-length": "1048576" }); res.flushHeaders();`,
    /** 404。 */
    missing: `res.writeHead(404); res.end("nope");`,
  };

  /**
   * 起一个**子进程**服务，把它的端口交给 `body`，一定收掉。端口由服务 `listen(0)` 自选后再打在
   * stdout 上，用例不猜端口 —— 猜端口在并行 / 端口被占时会变成一条**看起来像判据红**的假红。
   */
  async function withServer(kind: keyof typeof SERVER_CASES, body: (base: string) => void) {
    const script = `
      const { createServer } = require("node:http");
      const kind = ${JSON.stringify(SERVER_CASES[kind])};
      const s = createServer((req, res) => { ${SERVER_CASES[kind]} });
      s.listen(0, "0.0.0.0", () => { process.stdout.write(String(s.address().port) + "\\n"); });
    `;
    const child = spawn(process.execPath, ["-e", script], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    try {
      const port = await firstStdoutMatch(child, /^\s*(?<value>\d+)\s*$/m, {
        what: "本地服务的端口",
      });
      body(`http://127.0.0.1:${port}`);
    } finally {
      child.kill();
    }
    void kind;
  }

  it("206 + 一段 body ⇒ 判通，并把实收字节数报出来", async () => {
    await withServer("ok", (base) => {
      const verdict = httpDownloadProbe(`${base}/a.zip`);
      expect(verdict, "真取回字节却没判通").toMatch(/^HTTP 206/);
      expect(verdict, "读数里没有实收字节数 —— 人判不出「到底有没有量到东西」").toContain("字节");
      expect(isReachableVerdict(verdict)).toBe(true);
    });
  });

  it("**响应头来了、body 一个字节都不给** ⇒ 不通，且与「连不上」分得开", async () => {
    /* 现场那一档：TLS 握手能成、响应头也能回，**大 body 停住**。HEAD 在这一档上
     * 与好链路逐字同形 —— 这正是它被换掉的原因。 */
    await withServer("stall", (base) => {
      const verdict = httpDownloadProbe(`${base}/stall.zip`, {
        timeoutMs: 400,
      });
      expect(isReachableVerdict(verdict), "0 字节被判成了「通」").toBe(false);
      expect(verdict, "「连上了但 0 字节」与「压根没连上」必须分得开 —— 处置不同").toContain(
        "连上了但 0 字节",
      );
    });
  });

  it("3xx ⇒ 跟随（Playwright 自己也跟随，裸看会把 302 读成「没量到」）", async () => {
    await withServer("redirect", (base) => {
      const verdict = httpDownloadProbe(`${base}/root/builds/cft/1/win64/x.zip`);
      expect(
        verdict,
        "没跟随重定向 —— 候选根里 `registry.npmmirror.com/-/binary/playwright` 就回 302，" +
          "裸看会把它读成一个到不了的根",
      ).toMatch(/^HTTP 200/);
      expect(isReachableVerdict(verdict)).toBe(true);
    });
  });

  it("首跳重定向后面那一段卡住 ⇒ 仍然判得出「连上了但 0 字节」，且不拖过下一档的总时限", async () => {
    /* 这一条治**重定向之后**那一跳：镜像根常先回 302/307（`registry.npmmirror.com` 实测 302），真资源在下一跳。
     * 超时只看第一跳的话，卡在第二跳的链路会被读成「第一跳超时」（指错方向），或拖成每跳一个满额超时 × 重定向次数。
     * 判两条：结论**不算到得了**；总耗时 ≤ `timeoutMs × (maxRedirects + 1)`（**总闸**，不是每跳各给一份）。
     * ⚠️ 刻意**不**断言话术：本机实测这一档走 `res` 的 `error` 回调（而非 `end`），读数形如「响应出错了但 0 字节（200）」；要守的是「一个字节都没到 ⇒ 不许判通」，话术随时间会变。 */
    await withServer("redirectStall", (base) => {
      const started = Date.now();
      const verdict = httpDownloadProbe(`${base}/root/builds/cft/1/win64/x.zip`, {
        timeoutMs: 400,
        maxRedirects: 3,
      });
      const elapsed = Date.now() - started;
      expect(
        isReachableVerdict(verdict),
        `0 字节被判成了「通」（读数：${verdict}）—— 那一跳只是重定向，` + "真资源一个字节都没到",
      ).toBe(false);
      expect(
        elapsed,
        `这一档拖了 ${elapsed}ms —— 总闸应是 timeoutMs ×(重定向次数+1) 而不是每跳各给一份`,
      ).toBeLessThan(400 * 4 + 2500);
    });
  });

  it("4xx ⇒ 不通（拿到了响应头不等于量到了东西）", async () => {
    await withServer("missing", (base) => {
      const verdict = httpDownloadProbe(`${base}/missing.zip`);
      expect(verdict).toContain("404");
      expect(isReachableVerdict(verdict)).toBe(false);
    });
  });

  it("**收到第一批字节就收手** —— 它是判通不通，不是下载", async () => {
    /* 一个 8 MiB 的资源：探测若把 body 读完，这一步就从「几秒的前置判定」退化成
     * 一次真下载（而它跑在流水线最前）。服务端把「到底写了多少」报回来。 */
    const script = `
      const { createServer } = require("node:http");
      let written = 0;
      const chunk = Buffer.alloc(64 * 1024, 3);
      const s = createServer((req, res) => {
        res.writeHead(200);
        const timer = setInterval(() => {
          if (res.writableEnded || res.destroyed) { clearInterval(timer); return; }
          written += chunk.length;
          res.write(chunk);
        }, 0);
        res.on("close", () => clearInterval(timer));
        req.on("close", () => {
          clearInterval(timer);
          process.stdout.write("WRITTEN " + written + String.fromCharCode(10));
          process.exit(0);
        });
      });
      s.listen(0, "0.0.0.0", () => { process.stdout.write("PORT " + s.address().port + String.fromCharCode(10)); });
    `;
    const child = spawn(process.execPath, ["-e", script], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    try {
      const port = await firstStdoutMatch(child, /^PORT (?<value>\d+)/m, {
        what: "本地服务的端口",
      });
      const verdict = httpDownloadProbe(`http://127.0.0.1:${port}/big.zip`, {
        timeoutMs: 5000,
      });
      expect(isReachableVerdict(verdict), "8 MiB 的流没判通").toBe(true);
      /* 服务端在连接被切断时把它写了多少报回来（探测必须**先**把它切断）。 */
      const written = Number(
        await firstStdoutMatch(child, /WRITTEN (?<value>\d+)/m, {
          what: "服务端写出的字节数",
        }),
      );
      expect(
        written,
        "服务端没报回写入量 —— 这条用例量不到东西（夹具问题，不是判据问题）",
      ).toBeGreaterThan(0);
      expect(written, "探测把整个 body 读完了 —— 它不是下载，收到第一批字节就该收手").toBeLessThan(
        8 * 1024 * 1024,
      );
    } finally {
      child.kill();
    }
  });

  it("候选表按本档那一件的 `mirrors` 来，不许抄三档内置镜像那张表（否则恒 400）", () => {
    /* 上游对本档（Chromium 的 CfT 包）走 `cftUrl()`，它的 `mirrors` **只有 `cdn.playwright.dev` 一条**；
     * 三档那张 `PLAYWRIGHT_CDN_MIRRORS`（含两条 `…/dbazure/download/playwright`）服务的是老的
     * `builds/chromium/<revision>/…` 形状 —— 给它们接上 `builds/cft/…` 永远供不上（实测 400），
     * 而人照读数「换一个能通的根」就会换到那里去（现场 `cnb-oqf-1k51ifhis` 那两条逐字是 400）。 */
    const candidates /** @type {string[]} */ = /** @type {unknown} */ browserCandidates;
    for (const legacy of [
      "https://cdn.playwright.dev/dbazure/download/playwright",
      "https://playwright.download.prss.microsoft.com/dbazure/download/playwright",
    ]) {
      expect(
        candidates,
        `候选表里还有 \`${legacy}\` —— 它是老路径形状那一族，接上 \`builds/cft/…\` 恒 400`,
      ).not.toContain(legacy);
    }
    /* 正的那一条必须在（它就是这一件真正的内置镜像）。 */
    expect(candidates).toContain("https://cdn.playwright.dev");
    /* 与「量的是真资源」那条呼应：每一条都要能拼出 `builds/cft/…` 的地址。 */
    for (const c of candidates) {
      expect(playwrightProbeUrl(c)).toContain("/builds/cft/");
    }
  });

  it("不发 HEAD：载荷里没有 `HEAD` 这个动词，且带上了 `Range`", () => {
    /* 结构性一条：上面几条判的是行为，这条判的是「它没被改回去」——
     * HEAD 与 GET 在本地服务上可能都回 206，但真链路上完全不同。 */
    const src = read("scripts/ci-toolchain-browser-reach.mjs");
    expect(src, "浏览器探测又回到 HEAD 了 —— HEAD 答不了「取得下来吗」").not.toContain(
      'method: "HEAD"',
    );
    expect(src, "探测里没有 `Range` —— 那就不是「取一小段」的判法").toContain("Range");
    expect(src, "函数头里没了「为什么不发 HEAD」那条理由 —— 下一个人会把它改回去").toContain(
      "为什么不是 HEAD",
    );
  });
});

/**
 * 「自取那一件浏览器（分片 + 续传）」那一层（ISSUE #1959 第七跑）。这一格红了七跑、形态逐字相同：三个候选根全部 HTTP 206（实收几千~一万五字节），而 `playwright install` 同一个根 `timed out after 120000ms` —— 没有更好的根可挑。
 * 根因是 Playwright 自己那份下载**没有续传**：`browserFetcher.ts` 每次失败都 `unlink(zipPath)` + `removeFolders(browserDirectory)`，**从第 0 字节重来** ——「能握手、能吐前几 KB、然后停住」的链路永远到不了 114 MiB 尽头。
 * 故用只吐固定字节数就挂起的假链路判：片长须自适应退到最小档、已落盘字节一个不丢、整包**逐字节**等于声明长度；服务须在**子进程**（`spawnSync` 阻塞父进程事件循环）。zip 那层判可移植性：不再押「Windows 自带 tar 认 zip」（GNU tar 报 not a tar archive）。
 */
describe("工具链自证：自取浏览器要能续传（ISSUE #1959 第七跑）", () => {
  /**
   * 起一个「每次请求只稳吐 `burst` 字节、其余挂起」的假链路（**子进程**里）—— 现场那条链路的形状。
   * `burst` 小于片长时，只有**片长退到 `burst` 以下**才可能整片走完，自适应那一档因此被真量到，
   * 而不是靠注入假装。
   */
  async function withStallingLink(
    total: number,
    burst: number,
    body: (base: string) => Promise<void> | void,
  ) {
    const script = `
      const { createServer } = require("node:http");
      const TOTAL = ${total}, BURST = ${burst};
      const blob = Buffer.alloc(TOTAL, 7);
      const s = createServer((req, res) => {
        const m = /bytes=(\\d+)-(\\d*)/.exec(req.headers.range || "");
        const start = m ? Number(m[1]) : 0;
        const end = m && m[2] ? Number(m[2]) : TOTAL - 1;
        const len = end - start + 1;
        res.writeHead(206, {
          "content-range": "bytes " + start + "-" + end + "/" + TOTAL,
          "content-length": String(len),
        });
        if (len <= BURST) { res.end(blob.subarray(start, start + len)); return; }
        res.write(blob.subarray(start, start + BURST));
        setTimeout(() => { try { res.destroy(); } catch {} }, 120000);
      });
      s.listen(0, "127.0.0.1", () => { process.stdout.write("PORT " + s.address().port + String.fromCharCode(10)); });
    `;
    const child = spawn(process.execPath, ["-e", script], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    try {
      const port = await firstStdoutMatch(child, /^\s*PORT (?<value>\d+)\s*$/m, {
        what: "假链路的端口",
      });
      await body(`http://127.0.0.1:${port}`);
    } finally {
      child.kill();
    }
  }

  /* 这一格墙钟 = 停顿片数 × `chunkTimeoutMs`，天生**慢用例**：本机空载隔离单跑 17.9s、每日档 4 worker 并发 40.4s，
   * 而全局 `testTimeout` 是 30s ⇒ 后者必红且红得什么也没说（`cnb-vue-1k59blt4c`）。处置顺序要紧：**先降成本**
   * （700ms → 200ms，35.4s → 17.9s，判据一字未改），**再登记预算**（依据是上面两个实测数，不是「让它过去」；§11.13 禁的是拿预算换绿，与 `check-a11y-rules.test.ts` 的 `CONFIG_BUDGET` 同一处置）。120s 与同 describe 里「真起子进程」的格同档。
   */
  it(
    "**片长自适应地退档**：一条每次只吐 20 KB 的链路也能走完整包（逐字节对上）",
    { timeout: 120_000 },
    async () => {
      const TOTAL = 256 * 1024;
      await withStallingLink(TOTAL, 20 * 1024, (base) => {
        const dest = path.join(mkdtempSync(path.join(tmpdir(), "cnb-fetch-")), "x.bin");
        try {
          const res = fetchUrlResumable(`${base}/x.zip`, dest, {
            chunkBytes: 128 * 1024,
            /* 墙钟 = **停顿片数 × `chunkTimeoutMs`**（假链路对 `> BURST` 只吐 20 KB 就挂住，只能等客户端超时）。
             * 按 700ms 实测**隔离单跑 35.4s** > 全局 `testTimeout` 30s ⇒ 必然红（`cnb-vue-1k59blt4c`）。
             * 处置是**降成本**而非抬预算（§11.13）：判的是「片长退档 + 半成品不留盘」，只要求「片段在超时内收不齐」，
             * 与 700 还是 200 无关；降到 200ms 后实测约 10s，30s 预算留三倍余量。 */
            chunkTimeoutMs: 200,
            retries: 2,
          });
          expect(
            res.ok,
            "一条「每次只吐 20 KB」的链路把整包判成了取不到 —— 片长没有退档，或者退档之后" +
              "已落盘的部分被丢掉了（这正是 Playwright 那条路做不到的那一格）",
          ).toBe(true);
          expect(
            readFileSync(dest).length,
            "取回来的字节数**必须逐字节等于**声明长度：多了说明失败那一片的半成品被留在了" +
              "文件里（下一次重试与它重叠），少了说明收尾没接上",
          ).toBe(TOTAL);
          expect(
            readFileSync(dest).every((b) => b === 7),
            "内容不对 —— 说明片与片之间接错了位置（偏移算错）",
          ).toBe(true);
          expect(res.chunks, "一片都没记到 —— 这条用例没量到东西").toBeGreaterThan(1);
        } finally {
          rmSync(path.dirname(dest), { recursive: true, force: true });
        }
      });
    },
  );

  /* 墙钟同样是**停顿片数 × `chunkTimeoutMs`**（没有自己的预算登记 ⇒ 用全局 30s）。「已落盘 64 KiB /
   * 整包 128 KiB」决定要退两轮（64 → 32 → 16 KiB），从半路接时 16 KiB 一片正好 8 片、每片 2 次 × 700ms
   * ⇒ 本机空载 11.2s，负载下直接撞 30s（`cnb-7t8-1k60klj0p` 唯一一条红）。处置同一形状：先降成本
   * （700ms → 200ms，判的是「偏移没回到 0」「前缀没被覆盖」，与超时无关），再登记预算（120s，同档）。 */
  it(
    "**断了接着来**：已落盘的前缀不被重下（第二次调用从半路接）",
    { timeout: 120_000 },
    async () => {
      const dir = mkdtempSync(path.join(tmpdir(), "cnb-fetch-resume-"));
      const dest = path.join(dir, "x.bin");
      try {
        /* 第一次：只在盘上放前 64 KiB（模拟「上一次走到一半就被掐了」）。 */
        writeFileSync(dest, Buffer.alloc(64 * 1024, 5));
        const TOTAL = 128 * 1024;
        await withStallingLink(TOTAL, 16 * 1024, (base) => {
          /** @type {number[]} */
          const offsets: Array<number> = [];
          const res = fetchUrlResumable(`${base}/x.zip`, dest, {
            chunkBytes: 64 * 1024,
            chunkTimeoutMs: 200,
            retries: 2,
            fetchChunk: (
              /** @type {string} */ url,
              /** @type {string} */ d,
              /** @type {number} */ offset,
              /** @type {number} */ size,
              /** @type {number} */ timeoutMs,
              /** @type {{probeOnly?: boolean}} */ opts = {},
            ) => {
              /* 只记**取数据**那几次：上面那次 `Range: bytes=0-0` 是「问总长」，
               * 它当然从 0 开始 —— 把它算进来会让这条判据永远看着像「重下了」。 */
              if (opts.probeOnly !== true) {
                offsets.push(offset);
              }
              return fetchRangeToFile(url, d, offset, size, timeoutMs, opts);
            },
          });
          expect(res.ok, "接不上").toBe(true);
          expect(readFileSync(dest).length).toBe(TOTAL);
          expect(
            Math.min(...offsets),
            "第一次请求的偏移回到了 0 —— 已落盘的那 64 KiB 被重下了（那就不是「续传」）",
          ).toBeGreaterThanOrEqual(64 * 1024);
          expect(
            readFileSync(dest)
              .subarray(0, 64 * 1024)
              .every((b) => b === 5),
            "已落盘的前缀被后下的字节覆盖了",
          ).toBe(true);
        });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it("取不到总长时如实说「交给老路」，且一个字节都不落盘", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cnb-fetch-nolen-"));
    const dest = path.join(dir, "x.bin");
    try {
      const res = fetchUrlResumable("https://nope.invalid/x.zip", dest, {
        /* 注入面：这一次**一点网都不出**。 */
        fetchChunk: () => ({ bytes: -1, total: null, out: "ERR 连不上" }),
      });
      expect(res.ok).toBe(false);
      expect(res.out, "取不到总长时没说清「这一档交给老路」—— 人读到会以为整条路都断了").toContain(
        "老路",
      );
      expect(existsSync(dest), "总长都没取到却建了文件").toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("zip 解压**不押 Windows 的 tar**（GNU tar 不读 zip，实测就是这个错）", () => {
    /* `ci-toolchain-python.mjs` 那条路走 `tar -xf`（押的是 Windows 10 自带的 bsdtar
     * 认 zip）。而这一步是**全平台**的，GNU tar 对同一个包直接报
     * `This does not look like a tar archive`。所以这里自己读 zip 的 central directory。 */
    const src = read("scripts/ci-toolchain-browser-fetch.mjs");
    expect(
      src,
      "解压又回到 `tar -xf` 了 —— 那条路只在 bsdtar 上成立，Linux / macOS 上必红",
    ).not.toContain('spawnSync("tar"');
    expect(src, "没有读 zip 的 central directory").toContain("inflateRawSync");

    /* 行为那一条：造一个真 zip（deflate + store 两档），解出来逐字节对上。 */
    const dir = mkdtempSync(path.join(tmpdir(), "cnb-unzip-"));
    try {
      const zip = path.join(dir, "t.zip");
      const payload = Buffer.from("hello-续传".repeat(500), "utf8");
      writeFileSync(zip, makeZip([{ name: "a/b.txt", data: payload }]));
      const out = path.join(dir, "out");
      mkdirSync(out, { recursive: true });
      const failure = extractZipTo(zip, out);
      expect(failure, `解压失败：${failure}`).toBeNull();
      expect(readFileSync(path.join(out, "a", "b.txt"))).toEqual(payload);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("落点目录名用 `revision` 而不是 `browserVersion`（拿错号的后果是两边都像成功）", () => {
    /* 上游的目录名是 `chromium_headless_shell-<revision>`（`1243`），而 CDN 路径里用的是
     * `<browserVersion>`（`153.0.8010.12`）。拿错一个号不会报错：包解到一个没人会看的
     * 目录，Playwright 随即 `Removing unused browser` 把整包重下一遍 —— 自取白做，
     * 而日志两个方向都像成功。 */
    expect(browserDirName({ revision: "1243" })).toBe("chromium_headless_shell-1243");
    expect(
      browserDirName({ revision: "1243" }),
      "目录名里出现了 browserVersion —— 那一位不是目录名用的号",
    ).not.toContain("153");
    expect(browserDirName(null, "1243"), "读不到 browsers.json 时没用那档缺省").toBe(
      "chromium_headless_shell-1243",
    );
    expect(
      browserDirName(null),
      "两个号都读不到时给了一个**猜的**目录名 —— 那会装出一份没人会用的东西，而它看起来与成功同形",
    ).toBe("");
  });

  it("自取失败**不阻断**：它是一条尝试，不是判据（老路照走）", () => {
    /* 落点是一个**空目录**：自取这一条明确失败之后，老路必须照走（它有机会成功），
     * 而那一次成功之后复验才放行 —— 判据仍然只有「装完复验」这一条。 */
    const dir = mkdtempSync(path.join(tmpdir(), "pw-seedfail-"));
    try {
      /** @type {string[]} */
      const printed: Array<string> = [];
      /** @type {boolean} */
      let installCalled = false;
      const code = playwrightOnly({
        env: {
          PLAYWRIGHT_BROWSERS_PATH: dir,
          PLAYWRIGHT_DOWNLOAD_HOST: "https://m/x",
        },
        find: () => ({
          ok: true,
          command: "pnpm",
          prefixArgs: [],
          args: ["-v"],
          out: "12.4.1",
        }),
        /* 自取这一条**明确失败**。 */
        seed: () => ({ ok: false, out: "模拟：分片取不下来" }),
        exec: () => {
          installCalled = true;
          /* 老路也失败 —— 这一步该红，而红的原因是「复验没过」，不是「自取抛了」。 */
          return { ok: false, out: "模拟：老路也没成" };
        },
        probe: () => "超时（8000ms 内没有响应）",
        pickRoots: () => ({
          roots: ["https://m/x"],
          verdicts: [],
          probed: false,
          switched: false,
        }),
        log: (/** @type {string} */ line: string) => printed.push(line),
      });
      expect(
        installCalled,
        "自取失败之后没有交给 playwright install 的老路 —— 那等于把一条尝试当成了判据",
      ).toBe(true);
      expect(code, "自取失败时这一步应当由「装完复验」决定收场（这一跑老路也没成 ⇒ 红）").toBe(1);
      expect(printed.join("\n")).toContain("模拟：分片取不下来");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("自取成功 + 落点复验通过 ⇒ **不再交给老路**（它会顺手拉 ffmpeg，而那件取不回）", () => {
    /* 现场 `cnb-7oo-1k51r518b`：自取**成功**（119 MiB headless shell 落到落点、标记也写了），而
     * `playwright install` 照旧碰网拉 **ffmpeg**（chromium 依赖 ~2.5 MB），那一件在同一条链路 5 次
     * `timed out after 120000ms`、0 字节 ⇒ 红在一件已经装好的浏览器旁边，读起来像「浏览器没装成」。
     * 故判据：自取成功**且**落点复验通过（同一个 `browserExecutableExists()`）⇒ 直接放行；本档只要
     * headless shell，ffmpeg 只有录视频才用得上（`playwright.config.ts` 没开 `video`）。 */
    const dir = mkdtempSync(path.join(tmpdir(), "pw-seeded-"));
    try {
      const exe =
        process.platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell";
      /** @type {string[]} */
      const printed: Array<string> = [];
      /** @type {boolean} */
      let installCalled = false;
      const code = playwrightOnly({
        env: {
          PLAYWRIGHT_BROWSERS_PATH: dir,
          PLAYWRIGHT_DOWNLOAD_HOST: "https://m/x",
        },
        find: () => ({
          ok: true,
          command: "pnpm",
          prefixArgs: [],
          args: ["-v"],
          out: "12.4.1",
        }),
        /* 自取这一条**真把那件放到落点上**（那一层的判据就是「东西在不在」）。 */
        seed: () => {
          const exePath = path.join(
            dir,
            "chromium_headless_shell-1243",
            "chrome-headless-shell-win64",
            exe,
          );
          mkdirSync(path.dirname(exePath), { recursive: true });
          writeFileSync(exePath, "");
          return { ok: true, out: exePath };
        },
        exec: () => {
          installCalled = true;
          return { ok: false, out: "模拟：老路死在 ffmpeg 上" };
        },
        probe: () => "超时（8000ms 内没有响应）",
        pickRoots: () => ({
          roots: ["https://m/x"],
          verdicts: [],
          probed: false,
          switched: false,
        }),
        log: (/** @type {string} */ line: string) => printed.push(line),
      });
      expect(
        installCalled,
        "自取已经把那一件装好了，却还让 `playwright install` 去碰网 —— 它顺手要拉的 " +
          "ffmpeg 会把这一格判红（实测 cnb-7oo-1k51r518b：浏览器装好了、红在 ffmpeg 上）",
      ).toBe(false);
      expect(code, "落点上已经有那一件，这一步却报红").toBe(0);
      expect(printed.join("\n")).toContain("自取成功");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("`.cnb.yml` 那一步仍然只调这一条入口（没有另起一步手写逻辑）", () => {
    const yml = read(".cnb.yml");
    expect(yml).toContain("--playwright-only");

    /* 自取是那一步**内部**多出来的一条路，不是新 stage：多一个 stage 就多一处
     * 只在平台上跑、本地一条判据都测不到它的逻辑（§13.5.3.5 记过这一格）。 */
    expect(yml.match(/ci-toolchain-browser-fetch/g) ?? []).toHaveLength(0);
  });
});
