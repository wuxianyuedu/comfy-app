/**
 * 平台侧「装依赖」这一跳的**跳过判据**（ISSUE #1981 收尾）。
 *
 * 为什么这条判据必须有：`.cnb.yml` 里那一步的逻辑**一条判据都测不到它**（配置只在
 * 平台上跑，本地一个执行者都没有）—— 这条链上已经为此付过两次学费（§13.5.3.5 里
 * 那两段就地 PowerShell 都红过）。所以判定收在 `scripts/ci-install-deps.mjs`，
 * 这里用注入的「变更清单 + 盘上有没有 node_modules」直接跑它，不碰真网络、不碰真安装。
 *
 * 判的是三个方向，每一个都有自己的失效形态：
 *
 *   ① **该装的时候必须装** —— 依赖面被碰、`node_modules` 不在、拿不到变更清单。
 *      失效形态最贵：拿一个陈旧的 `node_modules` 去跑门禁，红法全在别处（§13.5.13 同族）。
 *   ② **不该装的时候必须跳过** —— 一行 `src/` 都不碰的 PR 不该为一跳空操作付钱。
 *      失效形态是「收窄看起来做了、其实一次都没生效」。
 *   ③ **「退 0 但清单为空」不等于「没变」** —— PR 事件上三点 diff 的空集形态退 0，
 *      照「退 0 就采信」会把它读成「什么都没变」（见 `changedFiles` 里那段 ⚠️）。
 *
 * 另有第四组（ISSUE #2010）：**全新 clone 上唯一真正生效的那道闸**是
 * 「装出来的那一套 ⇄ 现在的依赖面」的指纹比对 —— 平台侧每一次构建都是全新 clone，
 * 于是「依赖面没碰就跳过」这条判据此前**一次都没生效过**（实测固定 59~61s）。
 *
 * 口径见规范 §13.5.20。
 */
import fs from "node:fs";
import type { Dirent } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEP_FILES,
  FINGERPRINT_FILE,
  changedFiles,
  decideInstall,
  ensurePnpmOnPath,
  main,
  pnpmInstallFingerprint,
  readInstallFingerprint,
  runInstallWithSlot,
  writeInstallFingerprint,
} from "../scripts/ci-install-deps.mjs";

/** 造一个「git 调用」替身：按参数给出退出码与 stdout。 */
const gitStub =
  (byArgs: Record<string, { status: number; stdout: string }>) =>
  (args: string[]) => {
    /* 剥掉**全局旗标**那一对（`-c core.quotePath=false`，ISSUE #2272）：它是 git 的
     * 全局配置，不属于「这条 diff 是什么形状」⇒ 键要按形状算，替身才不会被
     * 「多了一个旗标」这件事顶掉。 */
    const shape = args[0] === "-c" ? args.slice(2) : args;
    return byArgs[shape.join(" ")] ?? { status: 1, stdout: "" };
  };

/** 造一个「安装」替身：只记有没有被调用。 */
function installStub() {
  let calls = 0;
  return {
    run: () => {
      calls += 1;
      return 0;
    },
    get calls() {
      return calls;
    },
  };
}

describe("依赖面清单", () => {
  it("覆盖 pnpm install 读的那几份（判窄了 = 拿陈旧 node_modules 跑门禁）", () => {
    for (const f of [
      "pnpm-lock.yaml",
      "package.json",
      "pnpm-workspace.yaml",
      "next.config.js",
    ]) {
      expect(DEP_FILES, `${f} 应在依赖面里`).toContain(f);
    }
  });
});

describe("decideInstall：该装 / 该跳过的三个方向", () => {
  it("依赖面被碰过 ⇒ 装（并点名碰了哪几个）", () => {
    const v = decideInstall({
      files: ["README.md", "pnpm-lock.yaml"],
      installed: true,
      fingerprint: "f",
      expected: "f",
    });
    expect(v.install).toBe(true);
    expect(v.why).toContain("pnpm-lock.yaml");
  });

  it("node_modules 不在 ⇒ 装（跳过的前提是它真在）", () => {
    expect(
      decideInstall({
        files: [],
        installed: false,
        fingerprint: "f",
        expected: "f",
      }).install,
    ).toBe(true);
  });

  it("拿不到变更清单 ⇒ 装（「不知道」不是「没变」）", () => {
    const v = decideInstall({
      files: null,
      installed: true,
      fingerprint: "f",
      expected: "f",
    });
    expect(v.install).toBe(true);
    expect(v.why).toContain("不知道");
  });

  it("只改了无关文件、且指纹对得上 ⇒ 跳过", () => {
    const v = decideInstall({
      files: ["src/lib/a.ts", "docs/README.md", "changelog.d/x.md"],
      installed: true,
      fingerprint: "f",
      expected: "f",
    });
    expect(v.install).toBe(false);
  });

  it("指纹对不上 ⇒ 装（全新 clone / 缓存里带着旧指纹：这是平台侧唯一的常态）", () => {
    const v = decideInstall({
      files: ["README.md"],
      installed: true,
      fingerprint: "old",
      expected: "new",
    });
    expect(v.install).toBe(true);
    expect(v.why).toContain("指纹");
  });

  it("没有指纹 / 算不出指纹 ⇒ 装（「没有证据」与「不知道」都不是「没变」）", () => {
    for (const state of [
      { fingerprint: null, expected: "new" },
      { fingerprint: "old", expected: null },
    ]) {
      const v = decideInstall({
        files: ["README.md"],
        installed: true,
        ...state,
      });
      expect(v.install, JSON.stringify(state)).toBe(true);
    }
  });
});

describe("changedFiles：清单为空与「命令退 0」不是同一件事", () => {
  it("三点 diff 退 0 但回空 ⇒ 继续试下一条，最终回 null（交给 decideInstall 去装）", () => {
    /* PR 事件上 `origin/<target>...HEAD` 在「源分支就基于目标分支」时是这个形状 ——
     * 照「退 0 就采信」会把它读成「什么都没变」，于是依赖面被碰过的那次 PR 跳过安装。 */
    const files = changedFiles(
      gitStub({
        "diff --name-only origin/master...HEAD": { status: 0, stdout: "" },
      }),
    );
    expect(files).toBeNull();
  });

  it("命中时保留清单并按 POSIX 分隔符归一（Windows 输出是反斜杠）", () => {
    const files = changedFiles(
      gitStub({
        "diff --name-only origin/master...HEAD": {
          status: 0,
          stdout: "pnpm-lock.yaml\r\nsrc\\lib\\a.ts\r\n",
        },
      }),
    );
    expect(files).toEqual(["pnpm-lock.yaml", "src/lib/a.ts"]);
  });
});

describe("依赖面指纹：记的是「这次装用的输入」，不是「文件长什么样」", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ci-deps-"));
    for (const f of [
      "pnpm-lock.yaml",
      "package.json",
      "pnpm-workspace.yaml",
      "next.config.js",
    ]) {
      fs.writeFileSync(path.join(tmp, f), "# " + f + "\n");
    }
    /* `package.json` 是真 JSON：键面要解析它才能摘 `scripts`（ISSUE #2489）。 */
    fs.writeFileSync(
      path.join(tmp, "package.json"),
      `${JSON.stringify(
        {
          name: "fixture",
          dependencies: { leftpad: "1.0.0" },
          scripts: { postinstall: "node scripts/install-git-hooks.mjs" },
        },
        null,
        2,
      )}\n`,
    );
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const readPkg = () =>
    /* SAFETY: 类型断言已复核 */ JSON.parse(fs.readFileSync(path.join(tmp, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      scripts: Record<string, string>;
    };

  it("同一份依赖面 ⇒ 同一个指纹；锁文件改一个字 ⇒ 变", () => {
    const a = pnpmInstallFingerprint(tmp);
    expect(a).toBe(pnpmInstallFingerprint(tmp));
    fs.appendFileSync(path.join(tmp, "pnpm-lock.yaml"), "changed\n");
    expect(pnpmInstallFingerprint(tmp)).not.toBe(a);
  });

  it("只改 scripts ⇒ 指纹不变：它不在安装闭包里（ISSUE #2489）", () => {
    const before = pnpmInstallFingerprint(tmp);
    const pkg = readPkg();
    pkg.scripts["setup:comfy-cli-venv"] =
      "node scripts/setup-comfy-cli-venv.mjs";
    fs.writeFileSync(
      path.join(tmp, "package.json"),
      `${JSON.stringify(pkg, null, 2)}\n`,
    );
    expect(
      pnpmInstallFingerprint(tmp),
      "scripts 变也换键 ⇒ 白付一次整装，而槽的内容逐字不变",
    ).toBe(before);
  });

  it("改依赖 ⇒ 指纹变（判宽只是少省，判窄是拿旧树跑门禁）", () => {
    const before = pnpmInstallFingerprint(tmp);
    const pkg = readPkg();
    pkg.dependencies.leftpad = "1.0.1";
    fs.writeFileSync(
      path.join(tmp, "package.json"),
      `${JSON.stringify(pkg, null, 2)}\n`,
    );
    expect(pnpmInstallFingerprint(tmp)).not.toBe(before);
  });

  it("package.json 读不动（非法 JSON）⇒ null —— 与「读不到」同一出口，不猜成「没变」", () => {
    fs.writeFileSync(path.join(tmp, "package.json"), "{ not json\n");
    expect(pnpmInstallFingerprint(tmp)).toBeNull();
  });

  it("patches/ 也算依赖面（换一个补丁，装出来的产物就不同）", () => {
    const before = pnpmInstallFingerprint(tmp);
    fs.mkdirSync(path.join(tmp, "patches"));
    fs.writeFileSync(path.join(tmp, "patches", "a.patch"), "diff --git\n");
    expect(pnpmInstallFingerprint(tmp)).not.toBe(before);
  });

  it("读不到锁文件 / 配置 ⇒ null（调用方据此真装，不许猜成「没变」）", () => {
    fs.rmSync(path.join(tmp, "pnpm-lock.yaml"));
    expect(pnpmInstallFingerprint(tmp)).toBeNull();
  });

  it("落盘 / 读回是同一个值；没有文件时读回 null", () => {
    const value = pnpmInstallFingerprint(tmp);
    expect(readInstallFingerprint(tmp)).toBeNull();
    expect(writeInstallFingerprint(tmp, value!)).toBe(true);
    expect(readInstallFingerprint(tmp)).toBe(value);
    expect(fs.existsSync(path.join(tmp, FINGERPRINT_FILE))).toBe(true);
  });

  it("main 先算指纹再装、装成功才落盘（半套不许被记成已验证）", async () => {
    const seen: Array<string | null> = [];
    const failing = await main({
      root: tmp,
      run: gitStub({
        "diff --name-only origin/master...HEAD": {
          status: 0,
          stdout: "README.md\n",
        },
      }),
      install: (fingerprint) => {
        seen.push(fingerprint ?? null);
        return 1;
      },
    });
    expect(failing).toBe(1);
    expect(seen[0], "装之前就要算、且交出去").toBe(pnpmInstallFingerprint(tmp));
    expect(
      readInstallFingerprint(tmp),
      "非零退出时不许落指纹：那一套是半成品",
    ).toBeNull();

    const passing = await main({
      root: tmp,
      run: gitStub({
        "diff --name-only origin/master...HEAD": {
          status: 0,
          stdout: "README.md\n",
        },
      }),
      install: (fingerprint) => {
        seen.push(fingerprint ?? null);
        return 0;
      },
    });
    expect(passing).toBe(0);
    expect(readInstallFingerprint(tmp)).toBe(pnpmInstallFingerprint(tmp));
  });
});

describe("main：装 / 跳过两条出口的退出码", () => {
  let tmp: string;
  beforeEach(() => {
    /* 隔离到临时根：原用例不传 root、直接断言宿主实时盘（#2030 的假红来源——并行
     * 满载下 `node_modules/.ci-deps-fingerprint` 偶发读抛错成 null，就走「装」而假红，
     * 且写回还会污染宿主检出）。这里造一个「已按这份依赖面装好」的根，状态确定。 */
    tmp = makeInstalledRoot();
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("跳过时不调用安装，且退 0", async () => {
    const inst = installStub();
    const code = await main({
      root: tmp,
      run: gitStub({
        "diff --name-only origin/master...HEAD": {
          status: 0,
          stdout: "docs/README.md\n",
        },
      }),
      install: inst.run,
    });
    expect(code).toBe(0);
    /* 依赖面没碰、node_modules 在场、指纹对得上 ⇒ 跳过（状态来自临时根，不读宿主）。 */
    expect(inst.calls).toBe(0);
  });

  it("要装时调用一次安装，退出码原样透出", async () => {
    let calls = 0;
    const code = await main({
      root: tmp,
      run: gitStub({
        "diff --name-only origin/master...HEAD": {
          status: 0,
          stdout: "pnpm-lock.yaml\n",
        },
      }),
      install: () => {
        calls += 1;
        return 1;
      },
    });
    expect(calls).toBe(1);
    expect(code).toBe(1);
  });
});

/** 造一个「已按这份依赖面装好」的临时根：依赖面四份文件齐、`.modules.yaml` 在场、
 * 指纹对得上。用来隔离 `main()` 用例，不让它去断言宿主实时盘（#2030）。 */
function makeInstalledRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ci-deps-skip-"));
  for (const f of [
    "pnpm-lock.yaml",
    "package.json",
    "pnpm-workspace.yaml",
    "next.config.js",
  ]) {
    fs.writeFileSync(path.join(root, f), "# " + f + "\n");
  }
  /* `package.json` 要是真 JSON：键面会解析它来摘 `scripts`（ISSUE #2489）。 */
  fs.writeFileSync(
    path.join(root, "package.json"),
    `${JSON.stringify({ name: "installed-fixture" }, null, 2)}\n`,
  );
  fs.mkdirSync(path.join(root, "node_modules"), { recursive: true });
  fs.writeFileSync(path.join(root, "node_modules", ".modules.yaml"), "{}");
  writeInstallFingerprint(root, pnpmInstallFingerprint(root)!);
  return root;
}

/**
 * 执行档的三条出口都在日志里（规范 §13.5.3.4.3 那句「往上读收益时，出处只能是那几句打印」）。
 *
 * 这一组钉的是**读数在场**，不是收益大小：每日那一格现在按策略不接槽（ISSUE #2081），
 * 而旧实现里「开关没拨」这一条**什么都不打印** —— 于是它在日志里与「什么都没发生」逐字同形，
 * 下一个人分不清「按策略不接」与「配了槽却没接管」，只能靠猜。
 * 少一次读数比少一次收益更难查，所以这一句必须响亮。
 */
describe("接槽执行档的三条出口", () => {
  /** 收齐打印的替身。 */
  function collector() {
    const lines: string[] = [];
    return {
      write: (s: string) => lines.push(s),
      get text() {
        return lines.join("");
      },
    };
  }

  it("开关没拨：照常装，且把「按策略不接槽」打出来", async () => {
    const stub = installStub();
    const out = collector();
    const code = await runInstallWithSlot(null, {
      env: {},
      write: out.write,
      install: stub.run,
    });
    expect(code).toBe(0);
    expect(stub.calls, "开关没拨也要真装一次 —— 每日那一格靠的就是这一跳").toBe(
      1,
    );
    expect(out.text).toContain("槽未接管（开关没拨");
    expect(out.text).toContain("⇒ 照常装");
  });

  it("只有 `1` 算拨开：写成 `0` 走的是同一句策略话术，而不是一句「接不上」", async () => {
    const out = collector();
    const code = await runInstallWithSlot(null, {
      env: { COMFY_CI_SLOT: "0" },
      write: out.write,
      install: () => 0,
    });
    expect(code).toBe(0);
    expect(out.text).toContain("开关没拨");
  });

  it("env 从注入读，不读进程全局（否则单测会随本机开关变结论）", async () => {
    process.env.COMFY_CI_SLOT = "not-1";
    try {
      const out = collector();
      await runInstallWithSlot(null, {
        env: {},
        write: out.write,
        install: () => 0,
      });
      // 注入的是「没有这个键」，而进程里那条垃圾值不该把它读成别的档。
      expect(out.text).toContain("槽未接管（开关没拨");
    } finally {
      delete process.env.COMFY_CI_SLOT;
    }
  });
});

/**
 * pnpm 的落点发现（ISSUE #2281）。
 *
 * ## 现场
 *
 * 同一台自托管节点、同一个时刻：开发者会话里 `pnpm -v` 一直正常（`C:\Users\…\pnpm`
 * 在 PATH 上），而平台上十几格齐刷刷写「pnpm 不可用」—— 那些格跑在**服务账号会话**
 * 里，它的 PATH 一条也不含 pnpm。两句话都对，所以「再补一条判据」读不懂这件事：
 * 缺的是「把 pnpm 放回 PATH」这一步。
 *
 * ## 钉住的四件事
 *
 * ① PATH 上本来就能跑 ⇒ **一次都不动 PATH**（不许为了省事无条件前插）；
 * ② PATH 上一个能跑的都没有、而 corepack 的落点里有 `pnpm-native.exe` ⇒ 把它的
 *    目录拼到最前，并且**真的起得来**（`-v` 退 0 且打出版本号才算）；
 * ③ 候选存在但起不来（shebang / `.cmd` 那一族）⇒ 不许当选，继续往后找；
 * ④ 哪儿都没有 ⇒ 如实报「问过哪几处」，并且**不装**（装是机器上的动作）。
 */
describe("pnpm 落点发现：服务账号的 PATH 上没它就是没装吗", () => {
  /* 「盘上还有哪些**目录**」—— 落点必须先存在，里面才谈得上有没有候选。
   * `exists` 同时回答这两问（真盘上 `fs.existsSync` 也是同一个判据）。 */
  const dirs = new Set<string>();
  /** 一个假的盘：`existing` 是「盘上有这些文件」，`working` 是「这些起得来」。 */
  const mount = (files: Record<string, { ok: boolean }>) => ({
    exists: (p: string) => files[p] !== undefined || dirs.has(p),
    spawn: (cmd: string) => {
      const hit = files[cmd];
      if (!hit)
        return { status: null, stdout: "", stderr: "", error: "ENOENT" };
      if (!hit.ok) {
        return { status: 1, stdout: "", stderr: "usage", error: null };
      }
      return { status: 0, stdout: "12.4.1\n", stderr: "", error: null };
    },
  });

  const LOCAL = path.join("C:", "Users", "svc", "AppData", "Local");
  const baseEnv = () =>
    /* SAFETY: 类型断言已复核 */ ({ LOCALAPPDATA: LOCAL, PATH: "" }) as unknown as NodeJS.ProcessEnv;
  /** 只造得出 `isDirectory` 的那几项 —— 被测判据只用它，别的字段与结论无关。 */
  const dirEntry = (name: string) =>
    /* SAFETY: 类型断言已复核 */ ({ name, isDirectory: () => true }) as unknown as Dirent;

  it("PATH 上本来就能跑 ⇒ 不动 PATH（不许无条件前插）", () => {
    dirs.clear();
    const dir = path.join(LOCAL, "pnpm");
    dirs.add(dir);
    const exe = path.join(dir, "pnpm.exe");
    const { exists, spawn } = mount({ [exe]: { ok: true } });
    const env = { ...baseEnv(), PATH: dir };
    const before = env.PATH;
    const r = ensurePnpmOnPath({
      platform: "win32",
      env,
      exists,
      spawn,
      write: () => undefined,
    });
    expect(r.bootstrapped).toBe(false);
    expect(r.dir).toBeNull();
    expect(env.PATH, "本来就能跑却改了 PATH").toBe(before);
  });

  it("PATH 上只有起不来的形态时，改用 corepack 落点里的 .exe 并拼到最前", () => {
    /* corepack 摆在盘上的是三个同名不同扩展：无扩展名 `pnpm` 是 shebang（Node 起不了）、
     * `pnpm-native.exe` 才是真的可执行 —— 而同目录里**没有** `.cmd`。 */
    dirs.clear();
    const bin = path.join(LOCAL, "pnpm");
    const shim = path.join(bin, "pnpm");
    const store = path.join(LOCAL, "node", "corepack", "v1", "pnpm");
    const v12 = path.join(store, "12.4.1");
    const v11 = path.join(store, "11.25.0");
    dirs.add(bin);
    dirs.add(store);
    const native12 = path.join(v12, "pnpm-native.exe");
    const native11 = path.join(v11, "pnpm-native.exe");
    const { exists, spawn } = mount({
      [shim]: { ok: false },
      [native12]: { ok: true },
      [native11]: { ok: true },
    });
    const env = { ...baseEnv(), PATH: bin };
    const lines: string[] = [];
    const r = ensurePnpmOnPath({
      platform: "win32",
      env,
      exists,
      spawn,
      readDir: (p: string) =>
        p === store ? [dirEntry("11.25.0"), dirEntry("12.4.1")] : [],
      write: (s) => lines.push(s),
    });
    expect(r.bootstrapped).toBe(true);
    // 版本取最高那一版（`12.4.1` 而不是字典序更大的 `11.25.0`）。
    expect(r.dir).toBe(v12);
    expect(env.PATH.startsWith(`${v12};`), `PATH 没被前插：${env.PATH}`).toBe(
      true,
    );
    // 起不来的那个必须留一条读数 —— 否则「为什么没用 PATH 上那个」无从回答。
    expect(r.consulted.join("\n")).toContain(shim);
    expect(lines.join("")).toContain("PATH 上没有可用的 pnpm");
  });

  it("落点里有候选但一个都起不来 ⇒ 不当选，也不装", () => {
    dirs.clear();
    const store = path.join(LOCAL, "node", "corepack", "v1", "pnpm");
    const v12 = path.join(store, "12.4.1");
    dirs.add(store);
    const { exists, spawn } = mount({
      [path.join(v12, "pnpm-native.exe")]: { ok: false },
      [path.join(v12, "bin", "pnpm.cjs")]: { ok: false },
    });
    const env = { ...baseEnv() };
    const r = ensurePnpmOnPath({
      platform: "win32",
      env,
      exists,
      spawn,
      readDir: (p: string) => (p === store ? [dirEntry("12.4.1")] : []),
      write: () => undefined,
    });
    expect(r.bootstrapped).toBe(false);
    expect(r.probing, "起不来的候选被当成了结论").toBeNull();
    expect(env.PATH, "什么都没找到却改了 PATH").toBe("");
    expect(r.consulted.join("\n")).toContain("退 1");
  });

  it("问过的每一处都留读数（下一动作是照着它去机器上核，不是再猜一轮）", () => {
    dirs.clear();
    const r = ensurePnpmOnPath({
      platform: "win32",
      env: { ...baseEnv() },
      exists: () => false,
      spawn: () => ({ status: null, stdout: "", stderr: "", error: "ENOENT" }),
      write: () => undefined,
    });
    expect(r.probing).toBeNull();
    const text = r.consulted.join("\n");
    expect(text).toContain("corepack");
    expect(text).toContain("目录不在");
  });
});

/**
 * 入口层不许绕过槽闸（ISSUE #2439）。
 *
 * 这条判据读的是**源码形状**，因为出事的那一笔（#2286）恰好是单测测不到的形态：
 * `main` 的 `install` 依赖有默认值（`runInstallWithSlot`），而入口层用 `{ install }`
 * 把它覆盖成裸 `runInstall` —— 单测都在测注入路径，谁也没传这个覆盖，于是
 * `.cnb.yml` 的开关还置着、`applySlot` 却在平台侧一次都不被问，每格退回全量安装。
 * 源码形状在这里是唯一测得到的现场。
 */
describe("入口层不许绕过槽闸", () => {
  const source = fs.readFileSync(
    fileURLToPath(new URL("../scripts/ci-install-deps.mjs", import.meta.url)),
    "utf8",
  );

  it("入口层的 install 必须是 runInstallWithSlot 的包装，探测结果作为依赖传进去", () => {
    expect(source).toContain("runInstallWithSlot(boot.probing ?? null");
  });

  it("不许再把裸 runInstall 直接当 main 的 install 依赖（#2286 的出事形状）", () => {
    expect(source).not.toMatch(/install = \(\) => runInstall\(/);
  });
});
