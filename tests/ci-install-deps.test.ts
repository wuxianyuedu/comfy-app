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
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEP_FILES,
  FINGERPRINT_FILE,
  changedFiles,
  decideInstall,
  main,
  pnpmInstallFingerprint,
  readInstallFingerprint,
  runInstallWithSlot,
  writeInstallFingerprint,
} from "../scripts/ci-install-deps.mjs";

/** 造一个「git 调用」替身：按参数给出退出码与 stdout。 */
const gitStub =
  (byArgs: Record<string, { status: number; stdout: string }>) =>
  (args: string[]) =>
    byArgs[args.join(" ")] ?? { status: 1, stdout: "" };

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
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("同一份依赖面 ⇒ 同一个指纹；锁文件改一个字 ⇒ 变", () => {
    const a = pnpmInstallFingerprint(tmp);
    expect(a).toBe(pnpmInstallFingerprint(tmp));
    fs.appendFileSync(path.join(tmp, "pnpm-lock.yaml"), "changed\n");
    expect(pnpmInstallFingerprint(tmp)).not.toBe(a);
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

  it("main 先算指纹再装、装成功才落盘（半套不许被记成已验证）", () => {
    const seen: Array<string | null> = [];
    const failing = main({
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

    const passing = main({
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

  it("跳过时不调用安装，且退 0", () => {
    const inst = installStub();
    const code = main({
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

  it("要装时调用一次安装，退出码原样透出", () => {
    let calls = 0;
    const code = main({
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

  it("开关没拨：照常装，且把「按策略不接槽」打出来", () => {
    const stub = installStub();
    const out = collector();
    const code = runInstallWithSlot(null, {
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

  it("只有 `1` 算拨开：写成 `0` 走的是同一句策略话术，而不是一句「接不上」", () => {
    const out = collector();
    const code = runInstallWithSlot(null, {
      env: { COMFY_CI_SLOT: "0" },
      write: out.write,
      install: () => 0,
    });
    expect(code).toBe(0);
    expect(out.text).toContain("开关没拨");
  });

  it("env 从注入读，不读进程全局（否则单测会随本机开关变结论）", () => {
    process.env.COMFY_CI_SLOT = "not-1";
    try {
      const out = collector();
      runInstallWithSlot(null, {
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
