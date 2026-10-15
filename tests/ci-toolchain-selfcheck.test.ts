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
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  installPython,
  PYTHON_EMBED_VERSION,
  pythonForensics,
  wingetAtStandardLocation,
  wingetCandidates,
} from "../scripts/ci-toolchain-python.mjs";
import { nodeAllowed, parseVersion } from "../scripts/ci-toolchain-selfcheck.mjs";
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
  return p.replace(/\\/g, "/").replace(/\/{2,}/g, "/").toLowerCase();
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
  it("winget 不在 PATH 上时，仍按用户级标准落点再找一遍", () => {
    /* 现场：`winget` 常年在盘上却不在构建会话的 PATH 上（`WindowsApps` 那条按用户
     * 追加的路径要新会话才生效）。少了这一条，「机器上有 winget」会被读成「没有」。
     * 这里直判落点拼法（本机没有那个文件，所以 `installPython` 的分支由它决定）；
     * 真起 `winget` 那一档不可能在开发机上判 —— 由这段拼法本身承担。 */
    /* 被测实现用平台的 `path.join` 拼，所以落点身份按**归一形态**比。 */
    const want = norm(path.join("/L", "Microsoft", "WindowsApps", "winget.exe"));
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
    expect(has("C:\\Users\\other\\AppData\\Local\\Microsoft\\WindowsApps\\winget.exe")).toBe(
      true,
    );
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
      platform: "win32",
      env: { LOCALAPPDATA: "/L" } as unknown as NodeJS.ProcessEnv,
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

  it("两条 scope 都试过仍拿不到解释器时，把「试过什么」写进 reason", () => {
    const r = installPython({
      platform: "win32",
      env: { LOCALAPPDATA: "/L" } as unknown as NodeJS.ProcessEnv,
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

describe("工具链自证：`.cnb.yml` 真的在跑它", () => {
  it("那一步走的是这份脚本，不再手写就地 PowerShell", () => {
    const yml = read(".cnb.yml");
    expect(yml).toContain("node scripts/ci-toolchain-selfcheck.mjs");
    // 老形态的两件特征：就地 winget、就地递归找安装根。
    expect(yml).not.toContain("winget install");
    expect(yml).not.toContain("Get-ChildItem");
  });
});
