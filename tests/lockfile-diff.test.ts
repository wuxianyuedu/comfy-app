/**
 * ISSUE #550：run-local.ps1 / quality-gate.ps1 只比对两个 lockfile 的 SHA256，
 * 只能回答「不一致」，回答不了「哪里不一致」——用户拿到的是「检测到依赖与
 * lockfile 不一致」，然后就没有下文了。
 *
 * 本用例锁两件事：
 *   1. scripts/lockfile/lock-diff.mjs 能从真实形态的 pnpm-lock.yaml 里解析出
 *      「哪个依赖加了 / 删了 / 版本变了」（直接喂真仓库 lockfile，不喂玩具样本）；
 *   2. 两个入口脚本在漂移分支里真的调用了差异渲染（防「细节又被删掉」回潮）。
 *
 * 差异定位的判据是 lockfile 段落，与 pnpm 内部结构解耦；
 * 不引入 YAML 依赖（standalone 产物里也不带第三方解析器）。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  diffLockfiles,
  isEmptyDiff,
  parseDependencyTable,
  parseLockfile,
  stripBundledSection,
} from "../scripts/lockfile/lock-diff.mjs";
import {
  renderDriftReport,
  renderLockDiff,
} from "../scripts/lockfile/render-lock-diff.mjs";

const ROOT = process.cwd();
const LOCK = readFileSync(join(ROOT, "pnpm-lock.yaml"), "utf8");
/** package.json 的声明范围：下面断言「lockfile 记的 specifier」时以它为准，
 *  而不是把某个版本号抄进用例 —— 抄字面量的那版在 next 升个小版本时就红了，
 *  而它要验的是**解析器**，不是「当前钉的是哪一版」。 */
const PKG = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  dependencies: Record<string, string>;
};

/**
 * 真 lockfile 的正文段：仓库 lockfile 头部含一段 pnpm 自举（bundled CLI）内容，
 * 末尾用 `---` 与正文分隔。**这是常态而非脏数据**——只取正文才是在拿真实形态
 * 的 lockfile 做用例。
 */
function lockBody(text: string): string {
  return stripBundledSection(text);
}

/**
 * 根 importer 里某个直接依赖的条目原文（包名 / specifier / version 三行）。
 *
 * 用例拿它当「改一处」的锚点。**别把版本号抄成字面量**：抄了等于把判据挂在
 * 「当前钉的是哪一版」上 —— 本文件已经被 `next` 与 `zod` 各绊过一次，升级依赖时
 * 打红的是一批与升级毫无关系的用例。锚点从真 lockfile 里现取，升到哪一版都成立。
 */
function importerEntry(body: string, name: string): string {
  const found = new RegExp(
    `^ {6}${name}:\\n^ {8}specifier: .*\\n^ {8}version: .*$`,
    "m",
  ).exec(body);
  if (!found) throw new Error(`lockfile 根 importer 里没有 ${name} 条目`);
  return found[0];
}

/** 只把条目的 version 一行换成新值（其余原样），供「版本变了」那一档用例使用。 */
function withEntryVersion(entry: string, version: string): string {
  return entry.replace(/^ {8}version: .*$/m, `        version: ${version}`);
}

const ZOD = importerEntry(lockBody(LOCK), "zod");
/** zod 在**当前** lockfile 里解析到的版本：渲染用例要断言它出现在报告里。 */
const ZOD_VERSION = /^ {8}version: (\S+)$/m.exec(ZOD)![1];

describe("stripBundledSection（pnpm 自举段必须剔除，否则差异报告全是噪声）", () => {
  it("仓库 lockfile 头部那段 pnpm 自举内容被剔掉，只留依赖正文", () => {
    const body = stripBundledSection(LOCK);
    expect(body.length).toBeLessThan(LOCK.length);
    // 正文段里不再出现「自举段才有」的 @pnpm/exe 包条目
    expect(body).not.toContain("@pnpm/exe.win32-x64@12.4.1");
    expect(body.startsWith("lockfileVersion")).toBe(true);
  });

  it("没有 `---` 分隔线的 lockfile 原样返回（node_modules 里那份就是如此）", () => {
    const plain = "lockfileVersion: '9.0'\n\nsettings:\n";
    expect(stripBundledSection(plain)).toBe(plain);
  });

  it("哈希判「一致」时差异报告也必须是空 —— 两份真 lockfile 的回归用例", () => {
    // 曾经的 bug：node_modules\.pnpm\lock.yaml（只有正文）与仓库 lockfile（带自举段）
    // 比对时报出「packages 新增 15 项 / snapshots 删除 1248 项」，而 SHA256 明明相等 →
    // 门禁说「一致」、明细说「天翻地覆」，用户被互相矛盾的两句话夹在中间。
    const installed = join(ROOT, "node_modules", ".pnpm", "lock.yaml");
    if (!existsSync(installed)) return;
    const installedText = readFileSync(installed, "utf8");
    expect(installedText).not.toContain("\n---\n"); // 前提：这份确实只有正文
    expect(stripBundledSection(LOCK)).toContain("zod"); // 断言不是在比两份空文件
    expect(isEmptyDiff(diffLockfiles(installedText, LOCK))).toBe(true);
  });
});

describe("parseLockfile（吃真 lockfile 的结构）", () => {
  const parsed = parseLockfile(lockBody(LOCK));

  it("切出顶层段落（settings / overrides / importers / packages / snapshots）", () => {
    for (const name of [
      "settings",
      "overrides",
      "importers",
      "packages",
      "snapshots",
    ]) {
      expect(parsed.sections.has(name)).toBe(true);
    }
    expect(parsed.sections.get("packages")!.keys.size).toBeGreaterThan(100);
    // settings / overrides 是「键: 值」扁平段（无子行），要靠 raw 读
    expect(parsed.sections.get("settings")!.raw.length).toBeGreaterThan(0);
  });

  it("解析根 importer 的直接依赖（含 specifier 与解析版本）", () => {
    const deps = parsed.importer.get(".")!.get("dependencies")!;
    expect(deps.size).toBeGreaterThan(30);
    expect(deps.get("next")!.specifier).toBe(PKG.dependencies.next);
    expect(deps.get("next")!.version).toMatch(/^\d+\./);
    const dev = parsed.importer.get(".")!.get("devDependencies")!;
    expect(dev.has("vitest")).toBe(true);
  });

  it("引号包裹的包名键照常解析（packages/snapshots 段大量存在）", () => {
    const keys = [...parsed.sections.get("packages")!.keys.keys()];
    expect(keys.some((k) => k.startsWith("@"))).toBe(true);
  });

  it("摘掉成对引号，key 与 version 不带引号残留", () => {
    const table = parseDependencyTable([
      "      typescript:",
      "        specifier: npm:@typescript/typescript6@^6.0.2",
      '        version: "@typescript/typescript6@6.0.2"',
    ]);
    expect(table.get("typescript")!.version).toBe(
      "@typescript/typescript6@6.0.2",
    );
  });
});

describe("diffLockfiles（两份 lockfile 的差异）", () => {
  const body = lockBody(LOCK);

  it("同一份 lockfile 自身比对 → 判定为「无实质差异」", () => {
    expect(isEmptyDiff(diffLockfiles(body, body))).toBe(true);
  });

  it("直接依赖新增 / 删除 / 版本变更都能定位到具体包名", () => {
    const oldText = body.replace(
      ZOD,
      `${ZOD}\n      brand-new-pkg:\n        specifier: ^1.0.0\n        version: 1.2.3`,
    );
    // 新 lockfile：brand-new-pkg 没了、zod 版本变了、old-gone-pkg 出现在同一位置
    const newText = oldText
      .replace(
        "      brand-new-pkg:\n        specifier: ^1.0.0\n        version: 1.2.3\n",
        "",
      )
      .replace(
        ZOD,
        "      old-gone-pkg:\n        specifier: ^9.9.9\n        version: 9.9.9",
      );
    const diff = diffLockfiles(oldText, newText);
    const deps = diff.importers["."]!.dependencies!;
    expect(deps.added.map((a) => a.name)).toContain("old-gone-pkg");
    expect(deps.removed.map((r) => r.name)).toContain("brand-new-pkg");
    expect(isEmptyDiff(diff)).toBe(false);
  });

  it("settings / overrides 变更计入配置段", () => {
    const next = body.replace(
      "  excludeLinksFromLockfile: false",
      "  excludeLinksFromLockfile: true",
    );
    const diff = diffLockfiles(body, next);
    expect(diff.settings.changed.map((c) => c.key)).toContain(
      "excludeLinksFromLockfile",
    );
  });

  it("packages / snapshots 条目增删计入解析结果段", () => {
    const next = body.replace(
      "\npackages:\n",
      "\npackages:\n\n  '@some/fresh-pkg@1.0.0':\n    resolution: {integrity: sha512-x}\n",
    );
    const diff = diffLockfiles(body, next);
    expect(diff.packages.added).toContain("@some/fresh-pkg@1.0.0");
  });

  it("重复段落被识别出来（合并冲突 / install 写到一半的形态）", () => {
    const dup = body + "\n" + body; // 同段落出现两次
    const diff = diffLockfiles(body, dup);
    expect(diff.duplicates.new).toContain("importers");
    expect(diff.duplicates.old).toEqual([]);
  });

  it("版本变了能被定位到具体包（拿真 lockfile 改一处）", () => {
    const next = body.replace(ZOD, withEntryVersion(ZOD, "5.0.0"));
    expect(next).not.toBe(body);
    const diff = diffLockfiles(body, next);
    const changed = diff.importers["."]!.dependencies!.changed;
    expect(changed.map((c) => c.name)).toContain("zod");
    expect(changed.find((c) => c.name === "zod")!.to).toBe("5.0.0");
    expect(isEmptyDiff(diff)).toBe(false);
  });
});

describe("renderLockDiff（给人看的措辞）", () => {
  it("说出新增/删除/变更的具体包名与版本，而不是只说「不一致」", () => {
    const body = lockBody(LOCK);
    const next = body.replace(
      ZOD,
      `${withEntryVersion(ZOD, "5.0.0")}\n      brand-new-pkg:\n        specifier: ^1.0.0\n        version: 1.2.3`,
    );
    const text = renderLockDiff(diffLockfiles(body, next)).join("\n");
    expect(text).toContain("brand-new-pkg");
    expect(text).toContain("zod");
    expect(text).toContain(ZOD_VERSION);
    expect(text).toContain("5.0.0");
  });

  it("条目过多时折叠，不把整份 lockfile 刷屏", () => {
    const body = lockBody(LOCK);
    const added = Array.from(
      { length: 30 },
      (_, i) =>
        `      bulk-pkg-${i}:\n        specifier: ^1.0.0\n        version: 1.0.0`,
    ).join("\n");
    const next = body.replace("      zod:", `${added}\n      zod:`);
    const lines = renderLockDiff(diffLockfiles(body, next), {
      maxPerSection: 5,
    });
    expect(lines.filter((l) => l.includes("bulk-pkg-")).length).toBe(5);
    expect(lines.some((l) => l.includes("另有 25 项"))).toBe(true);
  });

  it("包名/版本等「机器值」原样透出，不被转义或截断", () => {
    const body = lockBody(LOCK);
    const next = body.replace(
      "  '@alloc/quick-lru@5.2.0':\n    resolution:",
      "  '@scope/pkg@1.0.0':\n    resolution: {integrity: sha512-x}\n\n  '@alloc/quick-lru@5.2.0':\n    resolution:",
    );
    const lines = renderLockDiff(diffLockfiles(body, next));
    // 包名带 @ 与 /，是给人复制到命令里用的，必须原样出现
    expect(lines.some((l) => l.includes("@scope/pkg@1.0.0"))).toBe(true);
  });

  it("drift 报告首行讲清「对比的是哪两份文件」", () => {
    const body = lockBody(LOCK);
    const next = body.replace(
      "  excludeLinksFromLockfile: false",
      "  excludeLinksFromLockfile: true",
    );
    const text = renderDriftReport(diffLockfiles(body, next)).join("\n");
    expect(text).toContain("pnpm-lock.yaml");
    expect(text).toContain("最近一次安装");
  });

  it("无实质差异时给出「执行 pnpm install 对齐」的出口（不静默）", () => {
    const body = lockBody(LOCK);
    const text = renderDriftReport(diffLockfiles(body, body)).join("\n");
    expect(text).toContain("pnpm install");
  });
});

describe("漂移分支接线（防细节被删掉回潮）", () => {
  const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

  it("prepare-local-run.ps1 在漂移分支调用差异渲染", () => {
    const s = read("scripts/prepare-local-run.ps1");
    expect(s).toContain("lockfile\\diff-cli.mjs");
    expect(s).toContain("$drifted");
  });

  it("quality-gate.ps1 的依赖预检同样输出明细，且判决只用那份语义比较器", () => {
    const s = read("scripts/quality-gate.ps1");
    expect(s).toContain("lockfile\\diff-cli.mjs");
    // 断言打在**行为形状**上而不是函数名上：旧实现靠 `Write-DepDriftDetail` 再调一次
    // diff-cli，而那次调用的结论与判决阶段的结论可以不一致（ISSUE #1338 实测到的正是
    // 「判决说不一致、明细说实质一致」）。现在明细是判决那一次的转手输出 ——
    // 认名字会把正确的重构误报成「细节被删掉」。
    expect(s).toMatch(/\$Drift\.report\s*\|\s*ForEach-Object/);
    // 哈希比对恒为「不一致」（那两份文件本就不同形），所以这条本身就是判据的一部分。
    expect(s).not.toMatch(/Get-FileHash/);
  });

  it("同步指南写明「会打印差异明细」，避免文档与行为脱钩", () => {
    const s = read("docs/guides/sync-after-pull.md");
    expect(s).toContain("逐项打印");
  });
});
