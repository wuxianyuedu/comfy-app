/**
 * standalone 载荷里「目标在场而 stat 走不通」的链接要被按原文本重建（审查台账 R8-01）。
 *
 * 立案现场：`pnpm run build` 的收尾冒烟报 `Cannot find package 'promise-limit'`，
 * 而那个包**就在产物里**。量到的形状是 —— 同一份 `.next/standalone/node_modules`，
 * 68 条链接里 16 条 `lstat` 说是链接、`readlink` 拿得到文本、目标目录 `existsSync` 为真，
 * 但 `fs.stat()` 报 `EPERM`；把这 16 条按原链接文本用 `fs.symlinkSync` 重建之后
 * 16/16 可跟随，冒烟转绿。开发树里 2089 条同类链接全部可跟随，所以病不在 pnpm 的形状，
 * 也不在长路径（`LongPathsEnabled=1`、最长 145 字符），而在**建链接的那一方**。
 *
 * 本文件判的是**决策**，不是系统调用：夹具能造出「指向不存在目标的链接」，造不出
 * 「目标在场而穿不过去」那一种（那是 `next build` 的 Rust 侧写出的 reparse 数据），
 * 所以「谁该被修 / 按什么文本修 / 修不好怎么报」用 `deps` 注入边界来钉，
 * 系统调用那一层由 `pnpm build` 链上的冒烟做真机执行者。
 *
 * 四条不许回退的形状：
 *   1. 可跟随的链接**一次都不重建**（重建会换掉链接自身的 mtime，而 mtime 是壳产物
 *      时效判据 `shell-gate.mjs` 的输入）；
 *   2. 重建用的是**原链接文本**，不是 resolve 之后的绝对路径 —— 产物要能整体搬走；
 *   3. 「目标其实在场但修不好」与「目标真不在」在输出里**分得开**（`targetExists` 两态），
 *      否则下一个人只会看到 `Cannot find package`，又去查一遍缺件；
 *   4. 没跑过 `next build` 时这一步**不报错**（与同链上的 `standalone-private-inputs.mjs` 同口径）。
 */
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  linkFollowability,
  listLinks,
  repairUnfollowableLinks,
  runLinkRepair,
  siblingVariantInstalled,
} from "../scripts/standalone-link-repair.mjs";
import { symlinkDir } from "./helpers/symlink-dir";

/** 夹具根：每条用例一份，`afterEach` 整棵删掉。 */
let root = "";
beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "standalone-links-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** 在夹具里造 `<root>/<…>` 这条路径（并返回它）。 */
function dir(...rel: Array<string>): string {
  const p = path.join(root, ...rel);
  mkdirSync(p, { recursive: true });
  return p;
}

describe("真文件系统那一层（跨平台夹具）", () => {
  it("listLinks 列出链接本身，不穿进它背后", () => {
    const real = dir("real");
    writeFileSync(path.join(real, "index.js"), "1");
    writeFileSync(path.join(real, "package.json"), "2");
    const nm = dir("node_modules");
    symlinkDir(real, path.join(nm, "pkg"));

    const found = listLinks(nm).map((l) => l.rel);
    expect(found).toEqual(["pkg"]);
    // 「不穿链接」的实据：目标目录里那两个真文件一个都不出现在遍历结果里。
    expect(found.some((rel) => rel.includes("index.js"))).toBe(false);
  });

  it("嵌套目录里的链接也被列出来（走的是整棵 node_modules，不是只扫顶层）", () => {
    const inner = dir("node_modules", ".pnpm", "a@1.0.0", "node_modules");
    symlinkDir(dir("real"), path.join(inner, "a"));
    expect(listLinks(path.join(root, "node_modules")).map((l) => l.rel)).toEqual([
      ".pnpm/a@1.0.0/node_modules/a",
    ]);
  });

  it("可跟随判 follow、目标不在判 broken —— 这一步的判据就是一个 stat", () => {
    const kept = dir("kept");
    writeFileSync(path.join(kept, "index.js"), "1");
    const removed = dir("removed");
    writeFileSync(path.join(removed, "index.js"), "1");
    const nm = dir("node_modules");
    const good = path.join(nm, "good");
    const gone = path.join(nm, "gone");
    symlinkDir(kept, good);
    symlinkDir(removed, gone);
    // 只删 gone 的目标：两条链接的差别必须**只有目标在不在**这一个变量。
    rmSync(removed, { recursive: true, force: true });

    expect(linkFollowability(good)).toBe("follow");
    expect(linkFollowability(gone)).toBe("broken");
  });

  it("全部可跟随时零重建、零违规（而且不动可跟随链接自身的 mtime）", () => {
    const real = dir("real");
    writeFileSync(path.join(real, "index.js"), "1");
    const nm = dir("node_modules");
    const link = path.join(nm, "pkg");
    symlinkDir(real, link);
    const mtimeBefore = lstatSync(link).mtimeMs;

    const first = runLinkRepair(nm);
    expect(first.ran).toBe(true);
    expect(first.scanned).toBe(1);
    expect(first.repaired).toBe(0);
    expect(first.broken).toEqual([]);
    expect(first.lines.join("\n")).toContain("全部可跟随");
    expect(lstatSync(link).mtimeMs).toBe(mtimeBefore);
  });

  it("载荷目录不在 → 跳过而不是报错（这一步排在 next build 之后，产物可能根本没建）", () => {
    const result = runLinkRepair(path.join(root, "no-such-dir"));
    expect(result.ran).toBe(false);
    expect(result.broken).toEqual([]);
    expect(result.lines.join("\n")).toContain("跳过");
  });

  it("真文件系统那一层：同包的其它变体装了实体 ⇒ 那条死链算「非本平台变体」", () => {
    /* 造 pnpm 的真实形状：`.pnpm/<包>+<变体>@<ver>/node_modules/<包>/<变体>`。
     * 死链指向**没装实体**的那一支，同包的另一支（win32 那份）有实体。 */
    const nm = dir("node_modules");
    const scopeDir = dir("node_modules", ".pnpm", "libsql@0.5.29", "node_modules", "@libsql");
    // 同包的另一支：win32-x64-msvc，实体在。
    dir(
      "node_modules",
      ".pnpm",
      "@libsql+win32-x64-msvc@0.5.29",
      "node_modules",
      "@libsql",
      "win32-x64-msvc",
    );
    // 死链指向的那一支：目录在、实体不在。
    const dead = path.join(scopeDir, "darwin-arm64");
    symlinkDir(dir("nothing-here"), dead);
    rmSync(path.join(root, "nothing-here"), { recursive: true, force: true });

    const text = "..\\..\\..\\@libsql+darwin-arm64@0.5.29\\node_modules\\@libsql\\darwin-arm64";
    expect(siblingVariantInstalled(nm, text)).toBe(true);

    // 而「同包一个变体都没装」时，那才是真缺件。
    const lonelyNm = dir("lonely", "node_modules");
    const lonelyScope = dir(
      "lonely",
      "node_modules",
      ".pnpm",
      "gone@1.0.0",
      "node_modules",
      "gone",
    );
    const lonelyLink = path.join(lonelyScope, "variant");
    symlinkDir(dir("lonely", "nothing"), lonelyLink);
    rmSync(path.join(root, "lonely", "nothing"), {
      recursive: true,
      force: true,
    });
    expect(
      siblingVariantInstalled(
        lonelyNm,
        "..\\..\\..\\gone+variant@1.0.0\\node_modules\\gone\\variant",
      ),
    ).toBe(false);
  });
});

/** 注入用的一条链接（`text` 是它的链接文本；`abs` 不必真存在）。 */
interface FakeLink {
  abs: string;
  rel: string;
  text?: string;
}

/**
 * 「目标在场而穿不过去」的假象：判 broken、给相对文本、重建后变可跟随。
 *
 * @param input.links 要列出的链接
 * @param input.brokenRels 哪些 rel 判成穿不过去（默认全部）
 * @param input.rebuildResult 重建调用回什么（默认成功）
 * @param input.targetExists 目标在不在（默认在 —— 这才是本条发现ing的形状）
 */
function fake(input: {
  brokenRels?: Array<string>;
  dirExists?: boolean;
  links: Array<FakeLink>;
  rebuildResult?: { error: string; ok: boolean; };
  siblingInstalled?: boolean;
  targetExists?: boolean;
  throwOnReadText?: boolean;
}) {
  const links = input.links;
  const brokenRels = new Set(input.brokenRels ?? links.map((l) => l.rel));
  /** @type {Array<{abs: string, linkText: string}>} */
  const rebuildCalls: Array<{ abs: string; linkText: string }> = [];
  const nowFollowable = new Set<string>();
  const deps = {
    list: () => links,
    readText: (abs: string) => {
      if (input.throwOnReadText) {
        throw Object.assign(new Error("不是链接"), { code: "EINVAL" });
      }
      return links.find((l) => l.abs === abs)?.text ?? "";
    },
    follow: (abs: string) => {
      const l = links.find((x) => x.abs === abs);
      if (!l) {
        return /* SAFETY: 类型断言已复核 */ "broken" as const;
      }
      if (nowFollowable.has(abs)) {
        return /* SAFETY: 类型断言已复核 */ "follow" as const;
      }
      return brokenRels.has(l.rel)
        ? /* SAFETY: 类型断言已复核 */ ("broken" as const)
        : /* SAFETY: 类型断言已复核 */ ("follow" as const);
    },
    rebuild: (abs: string, linkText: string) => {
      rebuildCalls.push({ abs, linkText });
      const r = input.rebuildResult ?? { ok: true, error: "" };
      if (r.ok) {
        nowFollowable.add(abs);
      }
      return r;
    },
    exists: (_p: string) => input.targetExists ?? true,
    /* 「产物目录在不在」与「目标在不在」是两个判据（分开注入的理由见脚本里的注释）。 */
    dirExists: (_p: string) => input.dirExists ?? true,
    sibling: (_nm: string, _text: string) => input.siblingInstalled ?? false,
  };
  return { deps, rebuildCalls };
}

describe("决策面（注入边界，任何平台都判得动）", () => {
  it("可跟随的链接一次都不重建（「不许扰动 mtime」那条护栏）", () => {
    const { deps, rebuildCalls } = fake({
      links: [
        { abs: "N/good", rel: "good", text: "..\\r\\node_modules\\good" },
        { abs: "N/bad", rel: "bad", text: "..\\r\\node_modules\\bad" },
      ],
      brokenRels: ["bad"],
    });
    const out = repairUnfollowableLinks("N", deps);
    expect(out.scanned).toBe(2);
    expect(out.repaired).toBe(1);
    expect(rebuildCalls.map((c) => c.abs)).toEqual(["N/bad"]);
  });

  it("重建用的是**原链接文本**，不是 resolve 之后的绝对路径", () => {
    const { deps, rebuildCalls } = fake({
      links: [{ abs: "N/pkg", rel: "pkg", text: "..\\pkg@1.0.0\\node_modules\\pkg" }],
    });
    repairUnfollowableLinks("N", deps);
    expect(rebuildCalls).toEqual([{ abs: "N/pkg", linkText: "..\\pkg@1.0.0\\node_modules\\pkg" }]);
  });

  it("「目标在场但修不好」进 broken 且 targetExists=YES —— 不许与缺件同形", () => {
    const { deps } = fake({
      links: [
        {
          abs: "N/promise-limit",
          rel: "promise-limit",
          text: "..\\promise-limit@2.7.0\\node_modules\\promise-limit",
        },
      ],
      rebuildResult: { ok: false, error: "EPERM (no privilege)" },
    });
    const out = repairUnfollowableLinks("N", deps);
    expect(out.repaired).toBe(0);
    expect(out.broken).toHaveLength(1);
    expect(out.broken[0]?.targetExists).toBe(true);
    expect(out.broken[0]?.error).toContain("EPERM");
  });

  it("目标真不在时 targetExists=NO：报的是「修好了也仍不可跟随」这一格", () => {
    const { deps } = fake({
      links: [{ abs: "N/gone", rel: "gone", text: "..\\nope\\node_modules\\nope" }],
      targetExists: false,
      rebuildResult: { ok: false, error: "ENOENT (no such file)" },
    });
    const out = repairUnfollowableLinks("N", deps);
    expect(out.broken).toHaveLength(1);
    expect(out.broken[0]?.targetExists).toBe(false);
    expect(out.broken[0]?.error).toContain("ENOENT");
  });

  it("readlink 拿不到文本时不猜、不动手，只点名", () => {
    const { deps, rebuildCalls } = fake({
      links: [{ abs: "N/weird", rel: "weird" }],
      throwOnReadText: true,
    });
    const out = repairUnfollowableLinks("N", deps);
    expect(out.repaired).toBe(0);
    expect(out.broken[0]?.error).toContain("readlink 失败");
    expect(out.broken[0]?.linkText).toBe("");
    expect(rebuildCalls).toEqual([]);
  });

  it("有没修好的链接时，输出逐条点名并说出后果", () => {
    const { deps } = fake({
      links: [{ abs: "N/pkg", rel: "pkg", text: "..\\x\\node_modules\\pkg" }],
      rebuildResult: { ok: false, error: "EPERM" },
    });
    const out = runLinkRepair("N", deps);
    const text = out.lines.join("\n");
    expect(out.broken).toHaveLength(1);
    expect(text).toContain("重建后仍有 1 条穿不过去");
    expect(text).toContain("pkg");
    expect(text).toContain("目标存在=YES");
    // 话术必须点名「表现」，否则下一个人只会看到 Cannot find package。
    expect(text).toContain("Cannot find package");
  });

  it("目标不在 + 同包其它变体已安装 ⇒ 判「非本平台变体死链」，不阻断但要点名", () => {
    /* win32 上必然出现的形态：pnpm 给 optionalDependencies 的**每个**平台变体都建了链接，
     * 但只装本平台那一份 ⇒ 别的平台那几条的目标必然不存在（不是缺件）。 */
    const { deps } = fake({
      links: [
        {
          abs: "N/.pnpm/libsql@0.5.29/node_modules/@libsql/darwin-arm64",
          rel: ".pnpm/libsql@0.5.29/node_modules/@libsql/darwin-arm64",
          text: "..\\..\\..\\@libsql+darwin-arm64@0.5.29\\node_modules\\@libsql\\darwin-arm64",
        },
      ],
      targetExists: false,
      rebuildResult: { ok: false, error: "ENOENT (no such file)" },
      siblingInstalled: true,
    });
    const out = runLinkRepair("N", deps);
    const text = out.lines.join("\n");
    expect(out.broken).toHaveLength(1);
    expect(out.broken[0]?.variantDead).toBe(true);
    /* 阻断的那一档必须是空的 —— 否则本机 `pnpm build` 永远过不去这一格。 */
    expect(out.blocking).toEqual([]);
    expect(text).toContain("非本平台变体死链");
    expect(text).toContain("darwin-arm64");
    expect(text).not.toContain("重建后仍有");
  });

  it("目标不在 + 同包没有别的变体 ⇒ 那才是真缺件，仍然阻断", () => {
    const { deps } = fake({
      links: [
        {
          abs: "N/.pnpm/foo@1.0.0/node_modules/foo",
          rel: ".pnpm/foo@1.0.0/node_modules/foo",
          text: "..\\..\\..\\foo@1.0.0\\node_modules\\foo",
        },
      ],
      targetExists: false,
      rebuildResult: { ok: false, error: "ENOENT (no such file)" },
      siblingInstalled: false,
    });
    const out = runLinkRepair("N", deps);
    expect(out.broken[0]?.variantDead).toBe(false);
    expect(out.blocking).toHaveLength(1);
    expect(out.lines.join("\n")).toContain("重建后仍有 1 条穿不过去");
  });
});

describe("接线在位", () => {
  it("这一步挂在 pnpm build 链上，且顺序是 修链接 → 数产物 → 冒烟", () => {
    const pkg = /* SAFETY: 类型断言已复核 */ JSON.parse(
      readFileSync(path.resolve(__dirname, "../package.json"), "utf8"),
    ) as { scripts: { build: string } };
    const build = pkg.scripts.build;
    const order = [
      "next build",
      "scripts/standalone-link-repair.mjs",
      "scripts/check-standalone-contents.cjs",
      "scripts/smoke-executor-host-standalone.mjs",
    ].map((s) => build.indexOf(s));
    for (const idx of order) {
      expect(idx).toBeGreaterThanOrEqual(0);
    }
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("退出码只由「还有真缺件」决定（不许把违规吞成日志，也别让死链把整条链掐断）", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../scripts/standalone-link-repair.mjs"),
      "utf8",
    );
    /* `blocking` = 扣掉「非本平台变体死链」之后的那一档（那类死链不阻断，见文件头）。 */
    expect(source).toMatch(/return result\.blocking\.length > 0 \? 1 : 0;/);
  });
});
