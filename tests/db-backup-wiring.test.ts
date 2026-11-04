/**
 * 「备份 / 恢复真的被接到了该接的地方」——判据全落在**接线**上：`scripts/**` 里一个正确的函数没人调用，形态与「功能已做完」一样
 * （台账里「判据在场但无执行者」正是此形态）。三条缺一不可：`--force` 前必须备份（唯一删列/重建表、失误不可逆）；非 `--force`
 * 不许备份（否则 3 份保留量被一次正常启动挤掉）；三入口在起服务前应用待恢复。判据取源码文本 + 行号顺序（`createBackup` 先于 `ensureSchemaCurrent`）。
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
    expect(lineOf(src, "createBackup(")).toBeLessThan(lineOf(src, "ensureSchemaCurrent("));
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
  /* 编排器那一行的**实现**住在 `launcher-core/startup-gates.mjs`（ISSUE #1811
   * 拆 R5 超限文件）：`applyPendingRestoreAtBoot` 的调用点随预检桥段搬了过去，
   * 主文件只把它注进 `runStartupGates`。契约是「启动链路上换文件排在起服务之前」
   * —— 不是「这个调用写在哪份文件里」，所以这里按**实现那两份**判，主文件只判
   * 「它把这一步接上了」。 */
  const entries = [
    { file: "scripts/dev.mjs", label: "独立 pnpm dev" },
    { file: "scripts/start.mjs", label: "独立 pnpm start" },
    {
      file: "scripts/launcher-core/startup-gates.mjs",
      label: "双击启动编排",
    },
  ];

  for (const { file, label } of entries) {
    it(`${label} 调用了 applyPendingRestoreAtBoot`, () => {
      expect(read(file)).toContain("applyPendingRestoreAtBoot(");
    });
  }

  it("编排器主文件把这一步接上了（薄壳不许断线）", () => {
    const src = read("scripts/dev-launcher.mjs");
    expect(src).toContain("applyPendingRestoreAtBoot,");
    expect(src).toContain("runStartupGates(");
  });

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
    /* 用**调用点**而不是「某个名字第一次出现的行」：R5 拆分后入口文件把 `spawnDevServer` 做成一层再导出的薄包装
     * （写在主流程之前），「第一次出现」会指到包装上，断言就变成「换文件排在包装定义之前」—— 那是排版不是契约。
     * 契约是「换文件排在**真的起服务**之前」，而两处调用点已分居 `startup-gates.mjs` / `dev-boot.mjs`，
     * 故顺序判据落在执行顺序（编排 0~2 → 3 → … → 5~8）上，由下面「先于起服务」直接证明。 */
    const gates = read("scripts/launcher-core/startup-gates.mjs");
    expect(
      lineOf(gates, "applyPendingRestoreAtBoot("),
      "换文件必须在预检桥段里真的被调用",
    ).toBeGreaterThanOrEqual(0);
    // 起服务那一段（dev-boot）不许自己碰换文件：碰了就是「在开库之后才换」。
    const boot = read("scripts/launcher-core/dev-boot.mjs");
    expect(
      boot.includes("applyPendingRestoreAtBoot"),
      "起服务桥段里不许出现换文件（那时已有进程持有库）",
    ).toBe(false);
    // 编排器的执行顺序：预检桥段在任何起服务动作之前。
    const src = read("scripts/dev-launcher.mjs");
    expect(lineOf(src, "await runStartupGates(")).toBeLessThan(lineOf(src, "bootDevServerStage("));
  });

  it("三个入口排在任何会开库的东西之前：不得出现在 spawnSchemaSync 之后", () => {
    /* 反向断言（正面的三条上面已经各说一次）：任何一处把换文件挪到同步之后，
     * 都会有一处红 —— 那样换文件就发生在有进程持有这个库的时刻了。 */
    for (const { file, label } of entries) {
      const src = read(file);
      if (!src.includes("spawnSchemaSync(")) {
        /* 编排器的 schema 同步随起服务桥段搬进了 `dev-boot.mjs`：那一份里
         * **不许**出现换文件（正面那条已断），这里只断「它不在换文件之前」。 */
        expect(
          read("scripts/launcher-core/dev-boot.mjs").includes("applyPendingRestoreAtBoot"),
          `${label}: 换文件不许排在 schema 同步之后`,
        ).toBe(false);
        continue;
      }
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
    /* 视图的接线形态：一页到底之后不再是 `c.section === "backup"` 的条件渲染，
     * 而是 `sections` 映射里**按分区 id 取的一格**（ISSUE #1722）。判据仍落在
     * 「这一节真的被渲染出来」上：`backup:` 那一格存在，且它的值里有
     * `BackupSection`。 */
    const view = read("src/app/(main)/settings/SettingsPageView.tsx");
    expect(view).toMatch(/^\s*backup:\s*<BackupSection/m);
  });

  it("恢复**不是**「点完就换文件」：界面说的下一步是重启", () => {
    const section = read("src/app/(main)/settings/components/BackupSection.tsx");
    expect(section).toContain("重新启动应用后生效");
    /* 反向：不许出现「恢复成功」这类把人骗去刷新页面的文案。 */
    expect(section).not.toContain("已恢复");
  });
});
