/** 「CI 的落点指到开发盘」那件事的**契约**（临时根 + 浏览器落点）。三行流水线级 env
 * （`TEMP` / `TMP` / `PLAYWRIGHT_BROWSERS_PATH`）随 #3504 的构建执行外迁而退役 ——
 * 本文件现在是**反向登记**（三行不许回来；构建格挂回本机时才恢复正向契约）。
 * 落点推导本身（`scripts/ci-toolchain-browser-root.mjs` 那一族）仍是活代码：
 * 本地开发机与将来任何自托管执行面都还在用同一份「装与判同源」。 */
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
 * YAML 双引号标量的**去引号 + 解转义**：只解本仓用到的 `\\` / `\"`（Windows 路径里的就是它们），
 * 其余转义原样留着（真出现时该换写法，而不是让这一段悄悄猜）。
 */
function unquote(raw: string): string {
  const t = raw.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    return t
      .slice(1, -1)
      .replaceAll(String.raw`\\`, "\\")
      .replaceAll(String.raw`\"`, '"');
  }
  if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) {
    return t.slice(1, -1).replaceAll("''", "'");
  }
  return t;
}

/**
 * `.cnb.yml` 的**流水线级** env（`.common` 锚点里那个 `env:`）的键值表。认「流水线级」而不是「第一个
 * `env:`」：文件里有两种 —— 流水线级（缩进 2 层，键在第 4 列）与**格级**（缩进 4 层，键在第 6 列），
 * 格级只对那一格可见，而这一组变量要的是**每一格都看到**；认错层就等于给格级 env 背书。
 */
function pipelineEnv(text: string): Record<string, string> {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^\.common:\s*&common\s*$/.test(l));
  if (start === -1) {
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
      const m = /^ {4}(?<key>[A-Za-z_][A-Za-z0-9_]*):[ \t]*(?<value>.*)$/.exec(line);
      if (m) {
        out[m.groups?.key ?? ""] = unquote(m.groups?.value ?? "");
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

describe("CI 落点：临时根三行已随自托管执行面退役（#3504，反向登记）", () => {
  const env = pipelineEnv(readCnb());

  /**
   * #3504 把全部构建执行搬去 GA 之后，`TEMP` / `TMP` / `PLAYWRIGHT_BROWSERS_PATH`
   * 三行流水线级 env **没有消费者了**：它们存在的原因是「构建 / 浏览器安装在本机跑，
   * 临时目录与浏览器落点必须落在开发盘上，不能散进服务账号的 systemprofile」。
   * 那个前提消失后留着的害处是「配置看着像在本机干活」——读到这份配置的人会以为
   * 落点契约还活着，而真本机跑的格早已不存在。
   *
   * 退役是**反向判据**，不是删测试：谁把构建格挂回 `.cnb.yml`（那才是这三行的前提
   * 重新成立的时候），必须同批把这三行加回来并把本判据改回正向 —— 不然第一笔写
   * 临时文件就落在系统盘上，而红会落在别人的一条用例里（ISSUE #2939 的原案发形态）。
   */
  it("TEMP / TMP / PLAYWRIGHT_BROWSERS_PATH 三行不在配置的任何 env 里（正向 = 构建回本机时再加回）", () => {
    const text = readCnb();
    const offenders = text
      .split(/\r?\n/)
      .filter((line) => !line.trim().startsWith("#"))
      .map((line, no) => ({ line, no: no + 1 }))
      .filter(({ line }) => /^(?<indent>[ \t]*)(?:TEMP|TMP|PLAYWRIGHT_BROWSERS_PATH):/.test(line))
      .map(({ line, no }) => `${no}: ${line.trim()}`);
    expect(
      offenders,
      "`.cnb.yml` 里出现了 TEMP / TMP / PLAYWRIGHT_BROWSERS_PATH —— 这三行是**本机构建**的落点契约，" +
        "#3504 起构建格全部在 GA，触发口一格都不在本机跑；要挂回构建格就同批恢复三行并把本判据改回正向" +
        "（否则临时文件落进服务账号的 systemprofile，红落在别人的一条用例里，#2939）",
    ).toEqual([]);
    /* 双向钉：`pipelineEnv()` 在三行真的回来时要读得到 —— 否则上面那条反向判据
     * 与「将来恢复的正向判据」都读不到同一份事实。 */
    expect(
      Object.keys(env).length,
      "pipelineEnv() 连一行流水线级 env 都没读到 —— 解析器指错了地方",
    ).toBeGreaterThan(0);
  });

  it("`stages` 里**没有**「跑完再挪」那一格（平台那一刻没有可靠的收尾钩子）", () => {
    /* 把「为什么不做跑完再挪」变成机器判据，而不是只写在注释里：下一任执行者读到那条
     * 诉求时，最容易的动作就是往 `stages` 末尾加一格 `robocopy /MOVE`。那一格在
     * **红了 / 被掐了**的那一跑上永远不会执行（串行链 + 平台没有条件语法可依赖，
     * 实测读数见 `.cnb.yml` 的 `pull_request` 流水线段（#3478 起立案格内联于该流水线）)，于是它只会给绿的那一跑多付
     * 一次整树拷贝 —— 一个只在成功时生效的清理动作，是「看起来做了」的标本。 */
    const text = readCnb();
    const offenders = text
      .split(/\r?\n/)
      .map((line, i) => ({ line, no: i + 1 }))
      .filter(({ line }) => !line.trim().startsWith("#"))
      .filter(({ line }) => /\b(?:robocopy|Move-Item|Copy-Item)\b/.test(line))
      .map(({ line, no }) => `${no}: ${line.trim()}`);
    expect(
      offenders,
      "`.cnb.yml` 里出现了搬文件的动作 —— 「跑完再挪到 G:\\Temp」在本仓不做（临时根" +
        "本身就是一次性落点，挪过去的字节没有第二个读者），理由三格见规范 §13.5.3.4.4",
    ).toEqual([]);
  });

  it("落点目录必须事先存在（临时根不存在 ⇒ 第一笔写就 ENOENT）", () => {
    /* 这一条**只判形状**：节点上的目录在不在，由 `环境前提` 那一格去补并打印读数
     * （`ensureDir`），而它判的是「补不出来」那种真跑不下去的形态。
     * 模块仍是活代码：本地开发机与将来任何自托管执行面都还在用同一份落点推导。 */
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
          PLAYWRIGHT_BROWSERS_PATH: String.raw`G:\pw`,
          LOCALAPPDATA: String.raw`C:\Users\ci\AppData\Local`,
        },
      }),
    ).toBe(String.raw`G:\pw`);
    const withOverride = playwrightRootCandidates({
      platform: "win32",
      env: {
        PLAYWRIGHT_BROWSERS_PATH: String.raw`G:\pw`,
        LOCALAPPDATA: String.raw`C:\Users\ci\AppData\Local`,
      },
    });
    expect(withOverride.primary).toBe(String.raw`G:\pw`);
    expect(withOverride.fallback).toBe(
      platformDefaultBrowsersRoot({
        platform: "win32",
        env: { LOCALAPPDATA: String.raw`C:\Users\ci\AppData\Local` },
      }),
    );
    /* 没有覆盖时两者是同一个根 ⇒ 第二个候选根不存在（不必多问一遍盘）。 */
    const plain = playwrightRootCandidates({
      platform: "win32",
      env: { LOCALAPPDATA: String.raw`C:\Users\ci\AppData\Local` },
    });
    expect(plain.fallback).toBeNull();
  });

  it("生效落点空、而平台默认下有那一件 ⇒ 仍然判过不了，但读数点名「装了却探不到」", () => {
    /* 现场：生效落点 = 一个空目录；平台默认落点 = 真放了一份 headless shell。⚠️ 平台默认根**用被测的
     * 那份推导来布置**（`platformDefaultBrowsersRoot`）：这条判的是**诊断行为**，推导本身由
     * `tests/ci-toolchain-selfcheck.test.ts` 的「落点根按平台推」单独钉着；断言没有一处依赖「默认根
     * 算得对不对」，所以拿被测实现布置现场是安全的。 */
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
