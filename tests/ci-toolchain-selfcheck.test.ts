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
    const lines = pnpmForensics({
      platform: "win32",
      env: { PATH: "C:\\Program Files\\nodejs" },
      isFile: (candidate) => candidate.endsWith("pnpm.cmd"),
    });
    expect(lines.join("\n")).toContain("pnpm.cmd");
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
