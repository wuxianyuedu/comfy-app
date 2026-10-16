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
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  installPython,
  PYTHON_EMBED_VERSION,
  pythonForensics,
  wingetAtStandardLocation,
  wingetCandidates,
} from "../scripts/ci-toolchain-python.mjs";
import {
  findPnpm,
  pnpmForensics,
  nodeAllowed,
  parseVersion,
  playwrightInstallHints,
  runPlaywrightInstall,
} from "../scripts/ci-toolchain-selfcheck.mjs";
import {
  pythonCandidates,
  pythonProbeArgs,
} from "../src/lib/process/python-candidates";

/** 浏览器那一层的直接导出（下载根两个 / 「已装就不装」那一支）。 */
const { playwrightDownloadRoots, playwrightHostsToTry, playwrightOnly } =
  await import("../scripts/ci-toolchain-browser.mjs");

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

/**
 * 断言「探了哪条路径」时用的**归一形态** —— 分隔符归一 + 折叠重复 + 小写。
 *
 * 被测脚本用平台的 `path.join` 拼落点，所以期望值**不能写成 POSIX 字面量**：
 * POSIX 宿主上 `path.join("/L", "Programs")` 给 `/L/Programs`，而 Windows 节点上
 * 给 `\\L\\Programs`（正斜杠被当成普通字符保留、反斜杠成了分隔符）。
 * 判的是「探了哪个落点」，不是「分隔符长什么样」—— 写死一侧等于让这条判据只在
 * 那一侧的宿主上成立（本文件最初就是这么写的，在自托管 Windows 节点上红了 6 条）。
 *
 * 用 `path.join` 拼期望值只是把问题挪了个位置（跨宿主跑时就对不上），所以这里
 * 统一按**归一后的正斜杠形态**比。
 */
function norm(p: string): string {
  return p
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .toLowerCase();
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
    /* 候选表随 Python 那一层拆到了 `ci-toolchain-python.mjs`（selfcheck 的 900 行
     * 硬闸要求把「机制」与「编排」分开）—— 扫描面跟着走，别指到已经搬走的地方。 */
    const text = read("scripts/ci-toolchain-python.mjs");
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
    const text = read("scripts/ci-toolchain-python.mjs");
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
      account: "RUNNER\\svc",
      existing: (p) => p === lRoot,
      listDirs: (p) => (p === lRoot ? [path.join(p, "Python312")] : []),
    });
    const text = lines.join("\n");
    expect(text).toContain("执行账号: RUNNER\\svc");
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
    const probed: string[] = [];
    pythonForensics({
      env: {
        // 只用分号当分隔符（Windows 形态）—— 这里的 env 是合成的 PATH，不是本机的。
        PATH: "C:\\Windows\\system32;D:\\Program Files\\nodejs",
        LOCALAPPDATA: "C:\\srv\\AppData\\Local",
        ProgramFiles: "C:\\Program Files",
      },
      account: "NT AUTHORITY\\SYSTEM",
      existing: (p) => {
        probed.push(p);
        return false;
      },
      /* 只让 `D:` 盘那根 Users 列举出一个 profile —— 其余 Users 根返回空。
       * 判「是不是 D: 盘的 Users 根」按**归一后的正斜杠形态**，不写字面量：
       * 脚本用平台的 `path.join` 拼，POSIX 宿主上会得到 `D:\/Users` 这种混种形态，
       * 写死会漂（这是判据自身的可移植性，不是被测逻辑的形态）。 */
      listDirs: (p) =>
        /^d:\/+users\/?$/i.test(p.replace(/\\/g, "/"))
          ? ["D:\\Users\\yuedu"]
          : [],
    });
    /* 一律按**归一后的正斜杠形态**断言落点身份 —— 脚本用平台 `path.join` 拼，
     * POSIX 宿主上会出现 `D:\/...` 这类混种分隔符；判的是「探了哪个落点」，
     * 不是「分隔符长什么样」。 */
    const norm = (x: string) =>
      x
        .replace(/\\/g, "/")
        .replace(/\/{2,}/g, "/")
        .toLowerCase();
    const set = new Set(probed.map(norm));
    // 标准落点仍在（不能为了新形态把既有的四个丢了）。
    expect(set.has(norm("C:\\srv\\AppData\\Local\\Programs\\Python"))).toBe(
      true,
    );
    // 这台机 PATH 上出现过的盘符下的同类位置也探了（不是只探 C:）。
    expect(set.has("d:/program files/python")).toBe(true);
    expect(set.has("d:/python")).toBe(true);
    // 别人的按用户安装 —— 最初的症状就在这一格。
    expect(set.has("d:/users/yuedu/appdata/local/programs/python")).toBe(true);
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
   *
   * 两个「判到哪一步」的用例此前只注入了 `findExe` —— 而 `installPython` 在一个
   * `run` 全报成功的世界里会**继续往下走三条通道**，最后那条 embed 通道默认是
   * **真去 python.org 下载、真解压、真写盘**：
   *
   *   · 自托管节点上它跑成了真动作 ⇒ `python-embeded/python.exe` 落进检出，
   *     于是「两条 scope 都失败 ⇒ `installed === false`」这条断言在下一次运行里
   *     读到**上一跑留下的目录**，实测红成 `expected true to be false`；
   *   · 同一次运行里另一条只是慢：下载 + 解压墙钟随网络走，冷节点上一次跨过
   *     全局 30s，红出来的形态是 `Test timed out in 30000ms` —— 与上一条是
   *     同一个病（判据的动作泄漏到真网络 / 真盘），只是话术不同。
   *
   * 所以接缝按「会不会碰外部世界」列全：`run` / `findExe`（命令与查找）、
   * `existing`（盘）、`download` / `unzip` / `mkdir` / `cwd`（第三条通道的落点）。
   * 判据的结论从此只取决于用例自己造的东西。
   */
  const noExternalAction = {
    platform: "win32" as NodeJS.Platform,
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
    const want = norm(
      path.join("/L", "Microsoft", "WindowsApps", "winget.exe"),
    );
    const existing = (p: string) => norm(p) === want;
    expect(
      norm(wingetAtStandardLocation({ LOCALAPPDATA: "/L" }, existing) ?? ""),
    ).toBe(want);
    // 盘上真没有时不编一个路径出来（那会让下面的 `winget install` 以 ENOENT 失败）。
    expect(
      wingetAtStandardLocation({ LOCALAPPDATA: "/L" }, () => false),
    ).toBeNull();
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
      { PATH: "D:\\x;", LOCALAPPDATA: "/L", ProgramFiles: "/PF" },
      (root) => (root === "C:\\Users" ? ["C:\\Users\\other"] : []),
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
    expect(
      has(
        "C:\\Users\\other\\AppData\\Local\\Microsoft\\WindowsApps\\winget.exe",
      ),
    ).toBe(true);
    /* 盘符从 PATH 反推的 —— `D:` 盘上的程序目录也在候选里（写死 `C:` 就会漏）。 */
    expect(has("D:\\Program Files\\WindowsApps\\winget.exe")).toBe(true);
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
    const ran: string[] = [];
    const linux = installPython({
      platform: "linux",
      run: (cmd, args) => {
        ran.push(`${cmd} ${args.join(" ")}`);
        // 只有 dnf 在盘上：其余两个连 `--version` 都不答。
        if (cmd === "dnf") return { ok: true, out: "" };
        return { ok: false, out: "" };
      },
    });
    expect(ran[0]).toBe("apt-get --version");
    expect(ran).toContain("dnf --version");
    expect(ran).toContain("dnf install -y python3");
    // 刻意**不**替人 sudo：权限那一层归平台侧的人（无人值守里一次提示 = 一次挂死）。
    expect(ran.some((c) => c.includes("sudo"))).toBe(false);
    expect(linux.reason === null || typeof linux.reason === "string").toBe(
      true,
    );

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
    const brewRan: string[] = [];
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
    const scopes: string[] = [];
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
    /* 这一格是「接缝齐了、但有一处直呼模块实现」的现场：`findExe`（扫全部安装根）
     * 与 `findExeUnder`（某个 root 下）双层都已可注入，而 `winget` 分支在
     * 「按 winget 链接目录再找一遍」那一档**直接调**了模块级的 `findExeUnder` ——
     * 又是**第二个通到真 fs 的口**。实测复现（两个接缝都注入 `() => null`）：
     * 链接目录下**真放**一个 `python.exe` 时，`installed` 仍然是 `true`，
     * path 指向那个真文件 —— 判据的结论又变回取决于「跑判据的机器上碰巧有什么」。
     *
     * 用真文件而不是 mock `fs`：这一格判的正是「还有没有人去问真 fs」，
     * mock 掉 fs 等于把判据自己关掉。 */
    const localAppData = mkdtempSync(path.join(tmpdir(), "selfcheck-links-"));
    try {
      const links = path.join(localAppData, "Microsoft", "WinGet", "Links");
      mkdirSync(links, { recursive: true });
      writeFileSync(path.join(links, "python.exe"), "");
      const r = installPython({
        ...noExternalAction,
        env: { LOCALAPPDATA: localAppData } as unknown as NodeJS.ProcessEnv,
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
        args.includes("--scope")
          ? { ok: false, out: "boom" }
          : { ok: true, out: "" },
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
    platform: "win32" as NodeJS.Platform,
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
    const downloaded: string[] = [];
    const unzipped: string[] = [];
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
    expect(read("scripts/ci-toolchain-selfcheck.mjs")).not.toContain(
      "/latest/",
    );
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
 * 「pnpm 不可用」时的取证（ISSUE #1961）。
 *
 * ## 为什么加的是取证，不是又一条候选规则
 *
 * 那一步报 `pnpm 不可用` 之后，**两次猜测**都没修好它：先以为是「谁解析这个名字」
 * （加了 cmd.exe 退路，仍红），再以为是「扩展名候选不全」（`findPnpm` 补了 `.PS1`
 * 与同目录回退，仍红）。而**历史上**同一次构建里 `Install dependencies` 用
 * `pnpm install` 是跑得通的 —— 两条读数放在一起，「缺一条候选规则」解释不通。
 *
 * 缺的是一条**读数**：这一步看到的 `PATH` 是什么、逐条命中在哪些目录上。
 * 人答得出来而这里答不出来，只可能是执行上下文不同（服务账号读机器 PATH、
 * 子进程继承的 PATH 不是同一份）—— 取证把这件事变成可读的事实，而不是再猜一轮。
 */
describe("工具链自证：pnpm 找不到时要有取证（ISSUE #1961）", () => {
  it("逐条打印 PATH，并点名 pnpm* 在各目录的命中", () => {
    const lines = pnpmForensics({
      platform: "win32",
      env: { PATH: "C:\\Windows;C:\\Program Files\\nodejs" },
      isFile: () => false,
    });
    const text = lines.join("\n");
    // PATH 的两条都要打出来（人是照它判「这个账号看得见什么」的）。
    expect(text).toContain("C:\\Windows");
    expect(text).toContain("C:\\Program Files\\nodejs");
    // 零命中时要说清「是这个账号 PATH 上没有」，而不是留一片空白。
    expect(text).toContain("一个都没命中");
  });

  it("命中时逐条点名（形态一起打，人才判得出「名字在但起不来」）", () => {
    /* 形态大小写按**判据自己拼出来的**写（后缀表用 `PATHEXT` 的大写惯例）——
     * 写小写会让这条用例判的是宿主的大小写敏感，不是被测逻辑（同文件其它用例
     * 对 `.PS1` / `.CMD` 的处理一致）。 */
    const lines = pnpmForensics({
      platform: "win32",
      env: { PATH: "C:\\Program Files\\nodejs" },
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
      env: { PATH: "C:\\Windows;C:\\nodejs" },
      isFile: () => false,
    });
    const text = lines.join("\n");
    expect(text).toContain("C:\\Windows");
    expect(text).toContain("C:\\nodejs");
    // 拆坏之后会留下孤立的 `C` 与 `\Windows` 两行。
    expect(text).not.toMatch(/^  C$/m);
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
      isFile: (p: string) =>
        p.toLowerCase() === path.join(dir, "pnpm.ps1").toLowerCase(),
      tried,
      hostFound: false,
    });
    const text = lines.join("\n");
    for (const c of tried) expect(text).toContain(c);
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

  it("`findPnpm()` 失败时把试过的候选与宿主结论一起交出来", () => {
    /* 读数不能只活在取证函数里 —— 它得由**判据自己**在失败路径上产出，
     * 否则 `main()` 拿不到「这一跑试了什么」。这条钉住那条数据链。 */
    const dir = "/bin";
    const r = findPnpm({
      platform: "win32",
      env: { PATH: dir, PATHEXT: ".COM;.EXE;.BAT;.CMD" },
      // 盘上有两个形态，而两个都起不来。
      isFile: (p: string) =>
        [".ps1", ".cmd"].some(
          (e) => p.toLowerCase() === path.join(dir, `pnpm${e}`),
        ),
      host: () => null,
      probeRun: () => null,
    });
    expect(r.ok).toBe(false);
    expect(r.tried ?? [], "试过的候选一条都没记下来").not.toHaveLength(0);
    expect(r.hostFound, "宿主没有却报找到了").toBe(false);
  });
});

/**
 * 「浏览器安装」那一步的命令行（ISSUE #1961，自托管节点首次真跑到 E2E）。
 *
 * ## 这一格红过一次，而且红得最坏：**绿着不干活**
 *
 * `findPnpm()` 交出来的 `args` 是「**探一趟** pnpm」的完整形态 —— 宿主形态时它是
 * `[…] -File pnpm.ps1 -v`，直接命中时是 `["-v"]`。装浏览器那一步照着 `args` 拼，
 * 于是真跑的是：
 *
 *     pnpm -v exec playwright install chromium chromium-headless-shell
 *
 * 实测：那句只**打印版本号并退 0**（`12.11.2`），浏览器一个都没装。后果是这条 stage
 * 报绿、E2E 照旧报「浏览器二进制不在」—— 看日志的人会以为浏览器装好了，
 * 比让它直接红难查得多。
 *
 * 所以 `findPnpm()` 另外交一份 `prefixArgs`（**去掉探针参数**的宿主前缀），
 * 真命令一律用它拼。下面两条钉住这件事：一条判命令行里没有 `-v`，一条判宿主前缀
 * 一件不少（少了就变成「拿 .ps1 当可执行文件起」）。
 */
describe("工具链自证：浏览器安装的命令行（ISSUE #1961）", () => {
  const hostPrefix = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    "/bin/pnpm.PS1",
  ];

  it("真命令里**不带**探针参数 `-v`（带上就变成「只打版本、什么都不装」）", () => {
    const calls: string[][] = [];
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
    expect(args).toEqual([
      ...hostPrefix,
      "exec",
      "playwright",
      "install",
      "chromium",
      "chromium-headless-shell",
    ]);
  });

  it("宿主前缀一件不少（少了就变成「拿 .ps1 当可执行文件起」）", () => {
    const seen: Array<[string, string[]]> = [];
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
    for (const one of hostPrefix) expect(seen[0]?.[1]).toContain(one);
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

  it("两件浏览器都要装（只装 chromium 时 headless 档会报 Executable doesn't exist）", () => {
    let args: string[] = [];
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
    expect(args).toContain("chromium");
    expect(args).toContain("chromium-headless-shell");
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
 * 「注入面只堵了一半」的结构判据（ISSUE #1961）。
 *
 * ## 它挡的是什么
 *
 * `installPython` 是**三条按序**的通道，而「注入面」此前是按「用例传了什么」攒出来的
 * —— 攒漏一个，那一半就直取模块实现去读真 fs / 真网络。实测：只注入 `run` 时，
 * `viaScoop` 自己起 `spawnSync("scoop", …)` 并用**模块内**的 `findExeUnder` 读真 fs
 * （注入的 `findExe` 管不到它）。这类红的形态与「用例写慢了」逐字同形，所以缺的不是
 * 纪律。
 *
 * ## 为什么按**源码结构**判，而不是按用例数它传没传
 *
 * 后者要维护一张会过期的名单（「还有哪个接缝没堵」这件事本身没人看着），前者跟着
 * 实现走：只要通道内部出现了直取模块级实现，它就红。
 */
describe("工具链自证：安装通道的注入面按结构判（ISSUE #1961）", () => {
  const script = readFileSync(
    path.join(ROOT, "scripts", "ci-toolchain-python.mjs"),
    "utf8",
  );

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
    expect(scoop, "viaScoop 没有接 findExeUnder 注入面").toContain(
      "findExeUnder",
    );
    expect(
      /(?<![.\w])findExeUnder\s*\(/.test(
        scoop.replace(/findExeUnder:\s*findExe/, ""),
      ),
      "viaScoop 又直接调了模块级的 findExeUnder（读真 fs）：注入面形同虚设",
    ).toBe(false);

    /* `listDirs` 是 `wingetCandidates` 的第二个参数：漏传它，那一步会真去列盘上目录。 */
    const shell = script.slice(
      script.indexOf("function viaWinget("),
      script.indexOf("function installViaWinget("),
    );
    expect(shell, "viaWinget 没把 listDirs / existing 透传给实现").toContain(
      "listDirs",
    );
    expect(shell).toContain("existing");
  });

  it("Windows 分支的每个调用点都带 noExternalAction()", () => {
    /* 只判 **Windows** 分支：POSIX 那条只经 `run` 起包管理器，没有网络与解压
     * 那两截 —— 只注入 `run` 在那里是真的够，判它等于误报。 */
    const self = readFileSync(fileURLToPath(import.meta.url), "utf8");
    const calls = [
      ...self.matchAll(/installPython\(\{([\s\S]*?)\n\s{0,6}\}\);/g),
    ].map((m) => m[1] ?? "");
    const winCalls = calls.filter((args) =>
      args.includes("...noExternalAction"),
    );
    expect(
      winCalls.length,
      "没扫到 Windows 分支的调用点，判据失效了",
    ).toBeGreaterThan(1);
    expect(
      calls.some((args) => args.includes('platform: "linux"')),
      "POSIX 分支的调用点不见了（判据的另一半）",
    ).toBe(true);
  });
});

/**
 * 「工具链自证」的 pnpm 那一格（ISSUE #1961）。
 *
 * ## 现场
 *
 * 自托管 Windows 节点上第一步就红：
 *
 * ```
 * == OS ==    win32 x64 v24.20.0
 * == git ==   git version 2.53.0.windows.2
 * == node ==  v24.20.0
 * == pnpm ==  (pnpm 不可用)          ← 而同一台机器上 `pnpm install` 跑得好好的
 * == python == python : python Python 3.12.10
 * ```
 *
 * `git` / `node` / `python` 都答得出来，只有 `pnpm` 说没有 —— 于是整条流水线在
 * 第 1 秒停在一个**不成立的结论**上（后面 30 个 stage 全部 skipped）。
 *
 * ## 根因：裸起一个名字在 Windows 上问的不是同一个问题
 *
 * `run("pnpm", ["-v"])` 是把裸名字交给 CreateProcess —— 而 corepack 摆在盘上的
 * 形态里，Node **一个都起不来**：无扩展名 shim 是 `#!/usr/bin/env node`（libuv
 * 不解析 shebang）、`.cmd` 只有 cmd.exe 解释（实测 `EINVAL`）、唯一能用的 `.ps1`
 * 要 PowerShell 宿主。三个形态里能跑的那一个，恰好是最「绕」的那一个。
 *
 * 对照：`git` / `node` / `python` 都是 `.exe`，裸名字直接命中 —— 这也解释了
 * 为什么只有 pnpm 这一格红（同一个 `run()`，不同的可得形态）。
 *
 * 所以判据是「**按 PATH × 扩展名解析**，取第一个真的能起的形态」，与
 * `whichCommand()` 同一套；下判的是「`.ps1` 这一形态能不能被它找到并给出
 * 可 spawn 的命令」。
 */
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
    const norm = (p: string) => p.replace(/[\\/]+/g, "\\").toLowerCase();
    const onDisk = new Set(
      [
        nodeDir + String.raw`\pnpm`,
        nodeDir + String.raw`\pnpm.ps1`,
        hostExe,
      ].map(norm),
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
    expect(
      r.ok,
      "第二条 PATH 上的 pnpm 必须被找到（切错分隔符会整串当成一条）",
    ).toBe(true);
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
    const started: Array<[string, string[]]> = [];
    const r = findPnpm({
      platform: "win32",
      env: winEnv(dir),
      isFile,
      host: () => hostExe,
      probeRun: (cmd: string, args: string[]) => {
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
    /* ── 这一格是「修完候选表、红的形状原地复现」的现场 ────────────────────────
     *
     * `findPnpm()` 把 `.ps1` 找出来之后，`usablePnpm` 会**真起一次**它 ——
     * 而第一次写这段时只把宿主前缀（`-NoProfile … -File <shim>`）交了过去，
     * **忘了把探针的 `-v` 接在后面**。于是垫片收到的是**空参数**：
     * corepack 的 `pnpm.ps1` 裸跑会打 usage 并**退非零**（实测无参数 `pnpm` 退
     * 非零、`pnpm -v` 退 0），而 `runProbe` 正是以退出码判「起没起来」——
     * 唯一能用的那个形态被否掉，最后照旧报「pnpm 不可用」。
     *
     * 单测当时全绿，因为注入的 `probeRun` 一律返回成功 —— **探针参数对不上**这件事
     * 只有真机看得见。所以这一条判的就是那串参数本身：`.ps1` 那一支必须带着 `-v`。 */
    const dir = "/bin";
    const ps1 = path.join(dir, "pnpm.PS1");
    const hostExe = path.join("/host", "pwsh.EXE");
    const onDisk = new Set([ps1.toLowerCase(), hostExe.toLowerCase()]);
    const calls: Array<[string, string[]]> = [];
    const r = findPnpm({
      platform: "win32",
      env: winEnv(dir),
      isFile: (p: string) => onDisk.has(p.toLowerCase()),
      host: () => hostExe,
      /* 复刻真垫片的语义：**没收到 `-v` 就退非零**（`pnpm` 裸跑打 usage）。
       * 少了这条模拟，探针参数丢了也照绿 —— 那正是这次漏网的原因。 */
      probeRun: (cmd: string, args: string[]) => {
        calls.push([cmd, args]);
        return args.includes("-v")
          ? { command: cmd, args, out: "12.4.1" }
          : null;
      },
    });
    expect(r.ok, "垫片没收到 -v ⇒ 被当成起不来 ⇒ 又报「pnpm 不可用」").toBe(
      true,
    );
    expect(calls.length).toBeGreaterThan(0);
    for (const [, args] of calls) {
      expect(args, "探 `.ps1` 时 `-v` 没接在宿主前缀后面").toContain("-v");
      // 宿主前缀本身不许丢（丢了就变成「拿 .ps1 当可执行文件起」）。
      expect(args).toEqual(
        expect.arrayContaining([
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          ps1,
        ]),
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
    const probed: string[] = [];
    const r = findPnpm({
      platform: "win32",
      env: winEnv(dir),
      isFile: (p: string) => onDisk.has(p.toLowerCase()),
      host: () => hostExe,
      probeRun: (cmd: string, args: string[]) => {
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
      probeRun: (cmd: string, args: string[]) => ({
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
 * 「装完必须复验」那一层（ISSUE #1961）。
 *
 * `playwright install` 是一条**下载**命令，而下载有三种「退 0 但东西没落地」的形态：
 * 传输被截断、落点不可写、CDN 回了一份错误页（HTTP 200 的 HTML，Playwright 不解析它
 * ——既没报错也没装上）。自托管节点是台长期存在的机器，盘满与代理拦都不是稀奇事。
 *
 * 所以装完有一条**活判据**（按落点找 headless shell），与 `installAndReverify()` 的
 * 「装完回到 `findPython()` 再探一遍」逐字同一条口径：**装与判是两件事**。
 * 这一组把两个方向都真跑一次，并钉住「复验那一行永远到得了」（`return 0` 提前返回
 * 是这类守卫最常见的失效形态）。
 */
describe("工具链自证：装完必须复验（ISSUE #1961）", () => {
  it("落点里有 headless shell ⇒ 判过；没有 / 读不到 ⇒ 判不过", async () => {
    const { browserExecutableExists } =
      await import("../scripts/ci-toolchain-selfcheck.mjs");
    const root =
      process.platform === "win32"
        ? "C:\\x\\ms-playwright"
        : "/x/ms-playwright";
    const exe =
      process.platform === "win32"
        ? "chrome-headless-shell.exe"
        : "chrome-headless-shell";

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
    const { playwrightBrowsersRoot } =
      await import("../scripts/ci-toolchain-selfcheck.mjs");
    /* ⚠️ 期望值一律用**目标平台**的 join 拼，不用宿主的 `path.join`（`node:path`
     * 是宿主那一份）。判据是可注入的 `platform`，所以这组会**在一种平台上判另一种
     * 平台** —— 拿宿主 `path.join` 去拼会跟着跑判据的那台机器变：平台侧实测报过
     *
     * 断言原文是「`expected` 一个反斜杠路径、`to be` 一个正斜杠路径」那句。
     * （Windows 节点上拼 `darwin` 得到的全反斜杠），而那与被判的实现无关。
     * 这与 `executable-resolve.ts` 那句「大小写不敏感只按目标平台」是同一条口径。 */
    /* 包成箭头函数：直接传 `path.win32.join` 会被 `unbound-method` 判为「方法与
     * 自己的对象分了家」（`path.join` 本身不读 `this`，但规则看不出来）。 */
    const win = (...parts: string[]) => path.win32.join(...parts);
    const posix = (...parts: string[]) => path.posix.join(...parts);
    expect(
      playwrightBrowsersRoot({
        platform: "win32",
        env: { LOCALAPPDATA: "D:\\Users\\ci\\AppData\\Local" },
      }),
    ).toBe(win("D:\\Users\\ci\\AppData\\Local", "ms-playwright"));
    expect(
      playwrightBrowsersRoot({
        platform: "darwin",
        env: { HOME: "/h" },
      }),
    ).toBe(posix("/h", "Library", "Caches", "ms-playwright"));
    expect(
      playwrightBrowsersRoot({ platform: "linux", env: { HOME: "/h" } }),
    ).toBe(posix("/h", ".cache", "ms-playwright"));
    // 显式指定就听它的（自托管那台机把用户数据放在 D: 盘）。
    expect(
      playwrightBrowsersRoot({
        platform: "win32",
        env: { PLAYWRIGHT_BROWSERS_PATH: "E:\\pw" },
      }),
    ).toBe("E:\\pw");
  });

  it("复验真的排在「装」之后，且不过要非零退出（不许提前 return 0）", () => {
    /* 浏览器那一层的实现住在 `scripts/ci-toolchain-browser.mjs`（§12.6 R5 的 900 行
     * 硬闸下拆出来的，与 `ci-toolchain-python.mjs` 同一条边界）。 */
    const src = readFileSync(
      path.join(ROOT, "scripts", "ci-toolchain-browser.mjs"),
      "utf8",
    );
    const body = src.slice(
      src.indexOf("export function playwrightOnly("),
      src.indexOf("export function browserExecutableExists("),
    );
    const installAt = body.indexOf("runPlaywrightInstall({ find, exec, env })");
    /* ⚠️ **从 `installAt` 之后找**，别从函数头找：函数里现在有**两处**
     * `browserExecutableExists` —— 一处是装**之前**「已装就跳过下载」那一支
     * （它排在 `installAt` **前面**），一处才是装完的复验。从函数头 `indexOf`
     * 会命中前面那个，于是这条判据答的是「跳过那一支在装之前」，
     * 与它要守的「复验在装之后」是两件事 —— 而它**照样会绿**。
     * 这类「判据指到了同形的邻居上」正是本仓反复记的那一格（判据在，但判错了对象）。 */
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
 * 「退出码真的转出去了」（ISSUE #1961，本文件自己的第二个坑）。
 *
 * 守卫此前是裸 `main();`，而 `main()` 的返回值就是退出码 —— 于是
 * `--python-only` / `--playwright-only` 里那些 `return 1` **全部被吞掉**，进程恒退 0。
 * 实测：把 `浏览器安装` 的复验指到一个空落点，它明明打了「报了成功，但那一件二进制
 * 不在盘上」并 `return 1`，**退出码仍是 0** —— 那一段话是给人看的，判据读的是退出码。
 *
 * 这与本文件反复在修的形态**是同一个**：`Python 可用性` 与 `浏览器安装` 这两步
 * 存在的全部意义就是「缺件时红」，而它们**从来红不了**。
 */
describe("工具链自证：退出码必须转出去（ISSUE #1961）", () => {
  it("守卫把 `main()` 的返回值交给 `process.exit()`", () => {
    const src = readFileSync(
      path.join(ROOT, "scripts", "ci-toolchain-selfcheck.mjs"),
      "utf8",
    );
    /* 按源码形状钉：末尾那一段里必须有 `process.exit(main())`。
     * 裸 `main();` 正是被吞码的形态 —— 它的表现是「打了未通过、退出码 0」。 */
    const guard = src.slice(src.indexOf("fileURLToPath(import.meta.url)"));
    expect(
      /process\.exit\(\s*main\(\)\s*\)/.test(guard),
      "守卫又写成裸 `main();` 了 —— `--python-only` / `--playwright-only` 的 `return 1` 会被吞掉，进程恒退 0",
    ).toBe(true);
  });

  it("真起一次进程：`--playwright-only` 判不过时**退出码是 1**", () => {
    /* 真起子进程跑一次（不 import）：退出码只在**进程**那一层看得见，
     * 而这正是本组要判的东西。用「落点指到一个空目录」造出「install 报成功、
     * 二进制不在盘上」那一态 —— 判据是复验，不动真落点。
     *
     * 判的是**两条**：装那一步假成功、复验指到一个空落点，然后看进程的退出码。
     * 补丁只打在 `ci-toolchain-browser.mjs` 上（那两句都在那一份里）；而
     * `ci-toolchain-selfcheck.mjs` 的守卫（`process.exit(main())`）走**真实现**
     * —— 这正是本组要验的那一段。 */
    const empty = mkdtempSync(path.join(tmpdir(), "pw-empty-"));
    const browserProbe = path.join(ROOT, "scripts", "ci-toolchain-browser.mjs");
    const probe = path.join(ROOT, "scripts", ".tmp-exitcode-probe.mjs");
    const backup = path.join(tmpdir(), `browser-backup-${Date.now()}.mjs`);
    const browserSrc = readFileSync(browserProbe, "utf8");
    writeFileSync(backup, browserSrc);
    try {
      writeFileSync(
        browserProbe,
        browserSrc
          // ① 装那一步假装成功（不动真落点、不下 100MB）
          .replace(
            "  const install = runPlaywrightInstall({ find, exec, env });",
            '  const install = { ok: true, out: "(probe: 假装 install 退 0)" };',
          )
          // ①′ 「已装就跳过下载」那一支也要让开：它按**真落点**判，而这一条的现场
          //     恰恰是「install 报成功、二进制不在盘上」—— 不让开的话它会先返回 0。
          .replace(
            "  const already = browserExecutableExists({ env });",
            "  const already = { ok: false, out: '(probe: 不跳过)' };",
          )
          // ② 复验指向一个空落点 ⇒ 「退 0 但没落地」那一态
          .replace(
            "  const present = browserExecutableExists({ env });",
            `  const present = browserExecutableExists({ env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: ${JSON.stringify(
              empty,
            )} } });`,
          ),
      );
      /* 子进程跑**真**的那个入口（它 import 的是补过的那份 browser 模块）。 */
      writeFileSync(
        probe,
        readFileSync(
          path.join(ROOT, "scripts", "ci-toolchain-selfcheck.mjs"),
          "utf8",
        ),
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
 * 装浏览器失败时给的是**读数**（ISSUE #1961，同一格上的第五个面）。
 *
 * 上面那组把「退码转不转得出去」收干净之后，`浏览器安装` 这一格就**会红**了 ——
 * 而红的时候日志里得能读出**为什么**。此前那句话只有「常见成因：网络到 CDN 不通、
 * 或磁盘满」，而那两种成因的处置完全相反：
 *
 *   · 「不通」要换镜像（`PLAYWRIGHT_DOWNLOAD_HOST`）；
 *   · 「没量完」要放宽多久算超时（`PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT`）。
 *
 * 现场那一跑（`cnb-rkr-1k510rsgg`）正是后一种 —— 180 MiB 的包撞上 Playwright 默认
 * 的 30s **套接字**超时（`NET_DEFAULT_TIMEOUT`）：
 *
 *     （原文）Error: Request to https://cdn.playwright.dev/…/win64/chrome-win64.zip timed out after 30000ms
 *
 * 判据两条：真撞上「下载失败」时逐条点出试过的地址 + 两个出口；别的失败形态
 * （pnpm 不可用、盘满）不许被塞这两条建议 —— 凑上去只会让人往错的方向看。
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
 * 「已装就不下载」那一支（ISSUE #1961 第三次红）。
 *
 * 第三次红的性质与前两次不同：**它不是配置写错，也不是判据缺失** —— 1732s 的门禁
 * 全绿，最后红在这一步的下载上，而那时机器上**什么都不缺**（浏览器早就在盘上，
 * 只是这一步无条件又去下了一遍）。
 *
 * 所以判据要钉两层：装过的**不装**（跳过而不是重下），且跳过这一支判的仍然是
 * 「东西落地了」那一条 —— 它不许把「只装了一半」放过去。
 */
/**
 * 静音的打印三件套 —— 只判行为、不判话术的那些用例用。
 *
 * 收成一个函数而不是各处写 `() => {}`：空箭头会被 `no-empty-function` 判红，
 * 而这几条用例关心的是**起没起进程**，不是打了什么。
 *
 * @returns {{log: (line: string) => void, logError: (line: string) => void,
 *            section: (title: string) => void}}
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
      process.platform === "win32"
        ? "chrome-headless-shell.exe"
        : "chrome-headless-shell";
    const nested = path.join(
      dir,
      "chromium_headless_shell-1243",
      "chrome-headless-shell-linux64",
    );
    mkdirSync(nested, { recursive: true });
    writeFileSync(path.join(nested, exe), "");
    return dir;
  }

  it("落点里两件都齐 ⇒ 一次下载都不发起（`playwright install` 根本没被起过）", () => {
    const dir = readyEnv();
    try {
      /** @type {string[][]} */
      const spawned: string[][] = [];
      const code = playwrightOnly({
        env: { PLAYWRIGHT_BROWSERS_PATH: dir },
        find: () => ({
          ok: true,
          command: "pnpm",
          prefixArgs: [],
          args: ["-v"],
          out: "12.4.1",
        }),
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
 * 「下载根从哪来」那一档（ISSUE #1961）。
 *
 * `PLAYWRIGHT_DOWNLOAD_HOST` 设了就**只用它**：那说明人已经知道该走哪儿，不必再陪
 * Playwright 挨个试三档不通的内置镜像。没设时回一条空宿主 = 走它的默认行为，
 * **不替它挑一个第三方镜像写进代码** —— 那等于把「哪面墙怎么过」写死在仓里，
 * 换台机器就静默失效。
 */
describe("工具链自证：下载根由外面给，不由本仓猜（ISSUE #1961）", () => {
  it("设了就只用它；没设就回退到 Playwright 的默认（不发明第二个镜像）", () => {
    expect(playwrightHostsToTry({ PLAYWRIGHT_DOWNLOAD_HOST: "https://m/x" })).toEqual(
      ["https://m/x"],
    );
    expect(playwrightHostsToTry({})).toEqual([undefined]);
  });

  /**
   * **「只用它」是一条判据，不是一句注释**（ISSUE #1961，这一格的第四次红）。
   *
   * 现场（`cnb-g9d-1k515kvrq`）：日志里逐字两条「正在从同一个根下载 chromium 的
   * win64 zip」（就是外面给的那个 npmmirror 根），然后 `timed out after 120000ms`
   * —— **同一个根被拆成两条**。而外面给的那个根替不掉的正是它自己那一族，
   * 所以「再接着试内置族」既不是多一条出路，还把 `playwrightInstallHints()`
   * 那两档读数搅坏（实测那一档再也不成立，下一动作被指反）。
   *
   * 上面那条用例只钉两个函数的返回值，**钉不住 `runPlaywrightInstall()` 怎么用它们**
   * —— 把 `playwrightHostsToTry(env)` 换回循环里，两个函数照旧各自正确、行为却回去了。
   * 这一条改判**真响了几次**：设了根就恰好一次，且那次就是它。
   */
  it("设了根，`playwright install` 就**只起一次**、且用的就是它", () => {
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
        return { ok: false, out: "Download failure, code=1" };
      },
    });
    expect(
      hosts,
      "给上了下载根却还去试它替不掉的那一族 —— 同一次不通再花一遍时间，" +
        "而且试过的根一多，「同族被反复试」那档读数就再也不成立（实测被读成另一个方向）",
    ).toEqual(["https://m/x"]);
    expect(r.ok).toBe(false);
  });

  it("没设根时不许替它挑一个镜像（源码里不写死任何根）", () => {
    expect(
      playwrightDownloadRoots({}),
      "没设 `PLAYWRIGHT_DOWNLOAD_HOST` 时本仓自己给了一个根 —— 那等于把" +
        "「哪面墙怎么过」写死在仓里，换台机器就静默失效",
    ).toEqual([undefined]);
    expect(
      playwrightDownloadRoots({ PLAYWRIGHT_DOWNLOAD_HOST: "https://m/x" }),
    ).toEqual(["https://m/x"]);
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
    });
    expect(r.ok).toBe(true);
    expect(hosts).toEqual(["https://m/x"]);
    // 命令行里**不许**出现探针参数（那是 `findPnpm().args` 的形态，拼进去只会打印版本）。
    expect(r.args).not.toContain("-v");
  });
});
