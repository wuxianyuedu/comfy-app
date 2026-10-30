/**
 * 「CI 的落点指到开发盘」那件事的**契约**（临时根 + 浏览器落点）。
 *
 * ## 它守的是哪两件事
 *
 * 这批改动把 CI 的两处落点从系统盘挪到开发盘（`G:`）：
 *
 *   · **临时根**（`TEMP` / `TMP`）—— 原来落在服务账号的 `systemprofile` 下（在 `C:` 上）；
 *   · **浏览器落点**（`PLAYWRIGHT_BROWSERS_PATH`）—— 原来按 `%LOCALAPPDATA%` 推，
 *     同样落在 `C:` 上；而检出工作区、pnpm store、缓存槽**早就在 `G:` 上**了
 *     （实测读数见 `docs/guides/dev-drive-refs.md` 的「CI 侧」那节）。
 *
 * 这两件事各自都能被「配置写了但没生效」悄悄废掉，而那种失效的红法极贵：
 *
 *   · 临时根不存在 ⇒ Node 仍把它当临时目录返回 ⇒ 第一笔写就 ENOENT，而日志里
 *     读不出「目录没了」；
 *   · 浏览器落点被**挪进某一格的 `env:`** ⇒ 装的那一格看得到、跑 E2E 的那一格看不到 ⇒
 *     **装好了，探不到** —— 而「明明装过」与「一件都没有」在日志里原本逐字同形。
 *
 * ⇒ 所以这里守的不是「路径写对了吗」，而是**三条形状**：
 * 三行在**流水线级** env 里、`TEMP` 与 `TMP` 成对且同卷、落点与配置**同源**。
 *
 * ## 为什么「同源」也归这一组
 *
 * 落点推导（`PLAYWRIGHT_BROWSERS_PATH` 优先、否则按平台推）只有一份实现
 * （`scripts/ci-toolchain-browser-root.mjs`）。**装**与**判**都从它拿根 —— 一旦
 * 某一处自己推一份，「装在 A、判在 B」就成立，而那正是「装了但探不到」的机制。
 * 所以第三组用例钉的是「落点推导只有一处实现」这件事本身。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

/* 落点的四个名字全从 `ci-toolchain-browser.mjs` 取 —— 它把落点模块那三个名字原样
 * 转出（旧调用点不必跟着改），而 `browserExecutableExists` 本来就住在那里。
 * 这一处 import 同时也证明了「转出」这件事没断。 */
import {
  browserExecutableExists,
  platformDefaultBrowsersRoot,
  playwrightBrowsersRoot,
  playwrightRootCandidates,
} from "../scripts/ci-toolchain-browser.mjs";
import { ensureDir } from "../scripts/ci-env-probe.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const CNB = path.join(ROOT, ".cnb.yml");

/** 读仓库根的 `.cnb.yml`。 */
function readCnb(): string {
  return readFileSync(CNB, "utf8");
}

/**
 * YAML 双引号标量的**去引号 + 解转义**。
 *
 * 只解本仓实际用到的那几个转义（`\\` / `\"`）—— Windows 路径里出现的就是它们；
 * 其余转义原样留着（真出现时该换写法，而不是让这一段悄悄猜）。
 */
function unquote(raw: string): string {
  const t = raw.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    return t.slice(1, -1).replace(/\\\\/g, "\\").replace(/\\"/g, '"');
  }
  if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) {
    return t.slice(1, -1).replace(/''/g, "'");
  }
  return t;
}

/**
 * `.cnb.yml` 的**流水线级** env（`.common` 锚点里那个 `env:`）的键值表。
 *
 * 为什么认「流水线级」而不是「第一个 `env:`」：文件里有**两种** env ——
 * 流水线级（缩进 2 层的 `env:`，键在第 4 列）与**格级**（缩进 4 层的 `env:`，
 * 键在第 6 列）。两者的作用面差着一整个语义：格级只对那一格可见，而这一组
 * 变量要的正是「**每一格都看到**」。认错了这一层，判据就变成在给格级 env 背书。
 */
function pipelineEnv(text: string): Record<string, string> {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^\.common:\s*&common\s*$/.test(l));
  if (start < 0) {
    return {};
  }
  const out: Record<string, string> = {};
  let inEnv = false;
  for (const line of lines.slice(start + 1)) {
    /* 出了 `.common` 块（顶层键）就收工。 */
    if (/^\S/.test(line)) {
      break;
    }
    if (/^ {2}env:\s*$/.test(line)) {
      inEnv = true;
      continue;
    }
    if (!inEnv) {
      continue;
    }
    if (/^ {4}[A-Za-z_][A-Za-z0-9_]*:/.test(line)) {
      const m = /^ {4}([A-Za-z_][A-Za-z0-9_]*):[ \t]*(.*)$/.exec(line);
      if (m) {
        out[m[1]!] = unquote(m[2] ?? "");
      }
      continue;
    }
    /* 折叠标量的续行与注释行都跳过；缩进回到 2 层及更浅 ⇒ env 块收口。 */
    if (/^ {4}/.test(line)) {
      continue;
    }
    if (line.trim() === "" || line.trim().startsWith("#")) {
      continue;
    }
    inEnv = false;
  }
  return out;
}

/** 一个路径是不是绝对路径（Windows 盘符或 POSIX 根）。 */
function isAbsolutePath(p: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(p) || p.startsWith("/");
}

/** 一个路径所在的**卷根**（`G:\Temp` ⇒ `G:\`；`/tmp/x` ⇒ `/`）。 */
function volumeRootOf(p: string): string {
  if (/^[A-Za-z]:[\\/]/.test(p)) {
    return path.win32.parse(p).root.toLowerCase();
  }
  return path.posix.parse(p).root;
}

describe("CI 落点：临时根与浏览器落点都在开发盘上（契约）", () => {
  const env = pipelineEnv(readCnb());

  it("三行都在**流水线级** env 里（每一格都要看到它们）", () => {
    expect(
      env.TEMP,
      "`.cnb.yml` 的流水线级 env 里没有 `TEMP` —— CI 的临时目录于是落在服务账号的 " +
        "`systemprofile` 下（在系统盘上），与检出、store、缓存槽所在的那块盘分家",
    ).toBeTruthy();
    expect(
      env.TMP,
      "`TMP` 与 `TEMP` 必须成对（Node 只看 `TEMP`，另一些工具只看 `TMP`）",
    ).toBeTruthy();
    expect(
      env.PLAYWRIGHT_BROWSERS_PATH,
      "`.cnb.yml` 的流水线级 env 里没有 `PLAYWRIGHT_BROWSERS_PATH` —— 浏览器于是按 " +
        "`%LOCALAPPDATA%` 推，落在服务账号的系统盘那一侧",
    ).toBeTruthy();
  });

  it("这三行**只**在流水线级出现（挪进某一格 ⇒ 装了但探不到）", () => {
    const text = readCnb();
    const offLevel: Array<string> = [];
    for (const line of text.split(/\r?\n/)) {
      const m = /^([ \t]*)(TEMP|TMP|PLAYWRIGHT_BROWSERS_PATH):/.exec(line);
      if (!m) {
        continue;
      }
      const indent = m[1]!.replace(/\t/g, "    ").length;
      /* 流水线级 = 第 4 列；格级 = 第 6 列（`  - name:` ⇒ `    env:` ⇒ `      KEY:`）。 */
      if (indent !== 4) {
        offLevel.push(line.trim());
      }
    }
    expect(
      offLevel,
      "这三行必须只在流水线级 env 里（缩进第 4 列）：挪进某一格的 `env:` 之后，" +
        "装浏览器的那一格看得到、跑 E2E 的那一格看不到 ⇒ 装好了，探不到",
    ).toEqual([]);
  });

  it("`TEMP` 与 `TMP` 指向同一个目录，且三个落点同卷", () => {
    expect(env.TEMP).toBe(env.TMP);
    for (const key of /* SAFETY: 类型断言已复核 */ [
      "TEMP",
      "TMP",
      "PLAYWRIGHT_BROWSERS_PATH",
    ] as const) {
      const value = env[key]!;
      expect(
        isAbsolutePath(value),
        `${key} 必须写绝对路径（现在写的是 ${value}）—— 相对路径指的是作业目录，` +
          "而作业目录每跑换一个，临时文件就散在各个工作区里",
      ).toBe(true);
    }
    const roots = /* SAFETY: 类型断言已复核 */ (
      ["TEMP", "TMP", "PLAYWRIGHT_BROWSERS_PATH"] as const
    ).map((k) => volumeRootOf(env[k]!));
    expect(
      new Set(roots).size,
      `三个落点必须同卷（现在分别是 ${roots.join(" / ")}）—— 跨卷时「往落点里挪一个` +
        "文件」这类动作会直接 EXDEV 失败，而红会落在别人的一条用例里",
    ).toBe(1);
  });

  it("浏览器落点**不是**容器里那个路径（它在宿主上不存在）", () => {
    expect(env.PLAYWRIGHT_BROWSERS_PATH).not.toBe("/ms-playwright");
  });

  it("落点目录必须事先存在（临时根不存在 ⇒ 第一笔写就 ENOENT）", () => {
    /* 这一条**只判形状**：节点上的目录在不在，由 `环境前提` 那一格去补并打印读数
     * （`ensureDir`），而它判的是「补不出来」那种真跑不下去的形态。 */
    const tmp = mkdtempSync(path.join(tmpdir(), "ci-devdrive-"));
    try {
      const target = path.join(tmp, "Temp");
      const ensured = ensureDir(target);
      expect(ensured.ok).toBe(true);
      expect(ensured.created).toBe(true);
      expect(existsSync(target)).toBe(true);
      /* 幂等：已在就不该再报「刚补出来」。 */
      const again = ensureDir(target);
      expect(again.ok).toBe(true);
      expect(again.created).toBe(false);
      /* 相对路径不建（那与「临时根」的语义不符）。 */
      expect(ensureDir("relative-temp").ok).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("落点推导：装与判同源，且「装了却探不到」说得出来", () => {
  it("覆盖优先于平台默认；两者不同时才给第二个候选根", () => {
    expect(
      playwrightBrowsersRoot({
        platform: "win32",
        env: {
          PLAYWRIGHT_BROWSERS_PATH: "G:\\pw",
          LOCALAPPDATA: "C:\\Users\\ci\\AppData\\Local",
        },
      }),
    ).toBe("G:\\pw");
    const withOverride = playwrightRootCandidates({
      platform: "win32",
      env: {
        PLAYWRIGHT_BROWSERS_PATH: "G:\\pw",
        LOCALAPPDATA: "C:\\Users\\ci\\AppData\\Local",
      },
    });
    expect(withOverride.primary).toBe("G:\\pw");
    expect(withOverride.fallback).toBe(
      platformDefaultBrowsersRoot({
        platform: "win32",
        env: { LOCALAPPDATA: "C:\\Users\\ci\\AppData\\Local" },
      }),
    );
    /* 没有覆盖时两者是同一个根 ⇒ 第二个候选根不存在（不必多问一遍盘）。 */
    const plain = playwrightRootCandidates({
      platform: "win32",
      env: { LOCALAPPDATA: "C:\\Users\\ci\\AppData\\Local" },
    });
    expect(plain.fallback).toBeNull();
  });

  it("生效落点空、而平台默认下有那一件 ⇒ 仍然判过不了，但读数点名「装了却探不到」", () => {
    /* 现场：生效落点 = 一个空目录；平台默认落点 = 真放了一份 headless shell。
     *
     * ⚠️ 平台默认根**用被测的那份推导来布置**（`platformDefaultBrowsersRoot`）：
     * 这条用例判的是**诊断行为**，不是推导本身 —— 推导由
     * `tests/ci-toolchain-selfcheck.test.ts` 的「落点根按平台推」那一组单独钉着。
     * 拿被测实现布置现场在这里是安全的：断言里没有一处依赖「默认根算得对不对」。 */
    const tmp = mkdtempSync(path.join(tmpdir(), "ci-pwroot-"));
    try {
      const platform = process.platform;
      const exe = platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell";
      const primary = path.join(tmp, "primary");
      mkdirSync(primary, { recursive: true });
      /* 让平台默认根落在 tmp 里：win32 读 `LOCALAPPDATA`，另两个读 `HOME`。 */
      const env: Record<string, string> =
        platform === "win32"
          ? {
              PLAYWRIGHT_BROWSERS_PATH: primary,
              LOCALAPPDATA: path.join(tmp, "local"),
            }
          : { PLAYWRIGHT_BROWSERS_PATH: primary, HOME: path.join(tmp, "home") };
      const fallback = platformDefaultBrowsersRoot({ platform, env });
      const nested = path.join(fallback, "chromium_headless_shell-1243", "bin");
      mkdirSync(nested, { recursive: true });
      writeFileSync(path.join(nested, exe), "");

      const hit = browserExecutableExists({ platform, env });
      expect(hit.ok, hit.out).toBe(false);
      expect(hit.out).toContain(primary);
      expect(hit.out).toContain(fallback);
      expect(hit.out).toContain("装了却探不到");
      /* 判据**一个字没放宽**：默认根里有、而生效落点里没有 ⇒ 仍然判不过
       * （运行时只看生效落点，判过它才是假的）。 */
      expect(hit.out).toContain("运行时只看生效落点");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("生效落点里有那一件 ⇒ 判过（那一条不许被「另一个根也有」干扰）", () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "ci-pwroot2-"));
    try {
      const platform = process.platform;
      const exe = platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell";
      const primary = path.join(tmp, "primary");
      const nested = path.join(primary, "chromium_headless_shell-1243", "bin");
      mkdirSync(nested, { recursive: true });
      writeFileSync(path.join(nested, exe), "");
      const env: Record<string, string> =
        platform === "win32"
          ? {
              PLAYWRIGHT_BROWSERS_PATH: primary,
              LOCALAPPDATA: path.join(tmp, "local"),
            }
          : { PLAYWRIGHT_BROWSERS_PATH: primary, HOME: path.join(tmp, "home") };
      const hit = browserExecutableExists({ platform, env });
      expect(hit.ok, hit.out).toBe(true);
      expect(hit.out).toContain(exe);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("落点推导只有一处实现（装与判同源的前提）", () => {
  it("`ms-playwright` 这个字面量只住在落点模块里", () => {
    const literal = /["'`]ms-playwright["'`]/;
    const root = readFileSync(path.join(ROOT, "scripts", "ci-toolchain-browser-root.mjs"), "utf8");
    const browser = readFileSync(path.join(ROOT, "scripts", "ci-toolchain-browser.mjs"), "utf8");
    expect(literal.test(root)).toBe(true);
    expect(
      literal.test(browser),
      "`ci-toolchain-browser.mjs` 里又出现了一份落点推导 —— 装与判各推一份的话，" +
        "「装在 A、判在 B」就成立，而那正是「装了但探不到」的机制",
    ).toBe(false);
  });

  it("`ci-toolchain-browser.mjs` 从落点模块取那三个名字（不是自己抄一份）", () => {
    const src = readFileSync(path.join(ROOT, "scripts", "ci-toolchain-browser.mjs"), "utf8");
    expect(src).toContain('from "./ci-toolchain-browser-root.mjs"');
    for (const name of [
      "playwrightBrowsersRoot",
      "playwrightRootCandidates",
      "findBrowserExecutable",
    ]) {
      expect(src, `${name} 应当从落点模块来`).toContain(name);
    }
  });
});
