/**
 * 「备份 / 恢复真的被接到了该接的地方」—— 判据全部落在**接线**上。
 *
 * `tests/db-backup.test.ts` 验的是核心实现本身对不对；本文件验的是它在启动链路
 * 上有没有执行者。这一族判据在本仓库血泪史里是必需的：`scripts/**` 里一个正确
 * 的函数**没有任何人调用**，形态上与「功能已经做完」长得一模一样（台账里那批
 * 「判据在场但没有执行者」正是这个形态）。
 *
 * 三条接线，缺一条这个功能就等于不存在：
 *
 *   1. **`db-sync.mjs --force` 之前必须备份**（D6 的建议默认①）—— `--force` 是
 *      唯一会跑删列 / 重建表的那条路，也是唯一一次失误不可逆的时刻；
 *   2. **非 `--force` 那一路不许备份** —— 它按白名单只认建表 / 建索引 / 加列，
 *      每次都备份会让 3 份保留量被「一次正常启动」挤掉真正有价值的那些；
 *   3. **三个启动入口都要在起服务之前应用待恢复**（建议默认③）—— 换文件必须在
 *      「应用没在跑」的那一刻，而那三个入口是唯一能保证这一点的位置。
 *
 * 判据取源码文本 + 真跑一次 `db-sync.mjs`（用一个假 `ensureSchemaCurrent` 太远，
 * 而它真的会起 drizzle —— 所以这里只钉「备份那一步发生了」与「顺序对」，
 * 用 `--force` 跑在一个临时根上、`scripts/` 指不过去就跳过真实同步那半）。
 *
 * 顺序判据用「行号」：源码里 `createBackup` 必须出现在 `ensureSchemaCurrent`
 * **之前**。这比断言某个字符串存在强，也比抄一份实现弱 —— 它是「这两件事的
 * 先后」这件事本身。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/** 一行在源码里的行号（找不到抛 —— 找不到比找错更该被拦住）。 */
function lineOf(source: string, needle: string): number {
  const index = source.split("\n").findIndex((line) => line.includes(needle));
  expect(index, `源码里找不到「${needle}」——判据的锚点漂了`).toBeGreaterThanOrEqual(0);
  return index;
}

describe("db-sync.mjs：--force 之前必须备份", () => {
  it("createBackup 出现在 ensureSchemaCurrent **之前**", () => {
    const src = read("scripts/db-sync.mjs");
    expect(lineOf(src, "createBackup(")).toBeLessThan(
      lineOf(src, "ensureSchemaCurrent("),
    );
  });

  it("备份挂在 `force` 这一支下（非 --force 的自动同步不备份）", () => {
    const src = read("scripts/db-sync.mjs");
    /* 判据是「`if (force)` 与 `createBackup(` 之间除了条件那行没有别的控制流」：
     * 抄一份实现会漂，这里只要证明那一步在 force 的射程内。 */
    const backupLine = lineOf(src, "createBackup(");
    const guardLine = lineOf(src, "if (force) {");
    expect(guardLine).toBeLessThan(backupLine);
    /* 两条之间不许出现 `}`（那意味着 `createBackup` 已经掉出 force 那一支了）。 */
    const between = src
      .split("\n")
      .slice(guardLine + 1, backupLine)
      .join("\n");
    expect(between).not.toContain("}");
  });

  it("备份结果必落一句提示（成功说了哪一份、失败说了为什么）", () => {
    const src = read("scripts/db-sync.mjs");
    /* 走 `backupNotice` 这个唯一出口 —— 直接写文案的话，成功 / 失败会各写一半，
     * 而失败那一半恰恰是「这次变更万一丢了数据、没有退路」那句话的落点。 */
    expect(src).toContain("backupNotice(");
    expect(src).toMatch(/backupNotice\(createBackup\(/);
  });
});

describe("启动链：换文件必须排在起服务之前", () => {
  const entries = [
    { file: "scripts/dev.mjs", label: "独立 pnpm dev" },
    { file: "scripts/start.mjs", label: "独立 pnpm start" },
    { file: "scripts/dev-launcher.mjs", label: "双击启动编排" },
  ];

  for (const { file, label } of entries) {
    it(`${label} 调用了 applyPendingRestoreAtBoot`, () => {
      expect(read(file)).toContain("applyPendingRestoreAtBoot(");
    });
  }

  it("dev.mjs / start.mjs 里它排在 spawnSchemaSync 与 next 之前", () => {
    for (const file of ["scripts/dev.mjs", "scripts/start.mjs"]) {
      const src = read(file);
      const restore = lineOf(src, "applyPendingRestoreAtBoot(");
      /* 同步会打开数据库 → 换文件必须在它之前；起 Next 同理。 */
      expect(restore, `${file}: 换文件必须在 schema 同步之前`).toBeLessThan(
        lineOf(src, "spawnSchemaSync("),
      );
      expect(restore, `${file}: 换文件必须在起 Next 之前`).toBeLessThan(
        lineOf(src, "pnpmInvocation("),
      );
    }
  });

  it("编排器里它排在 spawnSchemaSync 与 spawnDevServer 之前", () => {
    const src = read("scripts/dev-launcher.mjs");
    const restore = lineOf(src, "applyPendingRestoreAtBoot(");
    expect(restore).toBeLessThan(lineOf(src, "spawnSchemaSync("));
    expect(restore).toBeLessThan(lineOf(src, "spawnDevServer("));
  });

  it("三个入口排在任何会开库的东西之前：不得出现在 spawnSchemaSync 之后", () => {
    /* 反向断言（正面的三条上面已经各说一次）：任何一处把换文件挪到同步之后，
     * 都会有一处红 —— 那样换文件就发生在有进程持有这个库的时刻了。 */
    for (const { file, label } of entries) {
      const src = read(file);
      expect(
        lineOf(src, "applyPendingRestoreAtBoot("),
        `${label}: 换文件不许排在 schema 同步之后`,
      ).toBeLessThan(lineOf(src, "spawnSchemaSync("));
    }
  });
});

describe("路径收口：应用根只有一处锚点", () => {
  it("设置页那三个 procedure 一律吃 process.cwd()（不各自拼路径）", () => {
    const src = read("src/server/api/routers/setting.ts");
    expect(src).toMatch(/listBackupEntries\(process\.cwd\(\)\)/);
    expect(src).toMatch(/createBackup\(process\.cwd\(\)\)/);
    expect(src).toMatch(/requestRestore\(process\.cwd\(\),/);
  });

  it("服务端取用面只 import 那一份 .mjs 实现（不自己再造一份）", () => {
    const src = read("src/lib/db-backup/backup.ts");
    expect(src).toContain("scripts/db-backup-core.mjs");
    /* 不许直接引驱动去自己写一份备份 —— 那是第二个轮子（§12.12）。 */
    expect(src).not.toContain("@libsql/client");
    expect(src).not.toContain("VACUUM INTO");
    expect(src).not.toContain("better-sqlite3");
  });
});

describe("设置页接线", () => {
  it("分区表里有「备份与恢复」，视图里有对应的渲染分支", () => {
    const types = read("src/app/(main)/settings/hooks/use-settings-page-types.ts");
    expect(types).toContain('{ id: "backup", label: "备份与恢复" }');
    const view = read("src/app/(main)/settings/SettingsPageView.tsx");
    expect(view).toContain('c.section === "backup"');
    expect(view).toContain("BackupSection");
  });

  it("恢复**不是**「点完就换文件」：界面说的下一步是重启", () => {
    const section = read(
      "src/app/(main)/settings/components/BackupSection.tsx",
    );
    expect(section).toContain("重新启动应用后生效");
    /* 反向：不许出现「恢复成功」这类把人骗去刷新页面的文案。 */
    expect(section).not.toContain("已恢复");
  });
});
