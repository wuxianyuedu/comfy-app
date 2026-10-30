/**
 * 契约：**版本化迁移与 `db:push` 产出同一份 schema**（ISSUE #1624 验收第 2 条）。
 *
 * 为什么要单独钉这一条：`drizzle/0000_*.sql` 是**生成物**，而生成它的那一刻
 * `schema.ts` 是什么样、用的 drizzle-kit 是哪一版，都可能与「下一次有人跑
 * `db:push`」不同。两条路一旦漂开，`db:migrate` 建出来的库就与代码期望的结构
 * 不一致 —— 而它**不会报错**（表都在、列名都对得上大半），只在某个业务写入上炸。
 *
 * 判据取**逐表逐列**的结构比对，不是「表数相同」：后者挡不住「少一列 / 类型不对 /
 * NOT NULL 丢了」这一类 —— 而那正是本仓反复踩过的形态（`db-push.mjs` 的
 * 第二次复核就是为「有表但结构不对」加的）。
 *
 * ⚠️ **「逐列」比的是列集，不是列的物理顺序**（ISSUE #2655）：`db:migrate` 给老表补新列
 * 只能走 `ALTER TABLE ADD COLUMN`（追加在表尾），`db:push` 按 `schema.ts` 的声明序建表 ——
 * 两条路**结构等价却永远产不出同一个顺序**。SQLite 里列序没有语义（本仓读侧全部按名取列，
 * drizzle 的 select 生成的也是列名列表），所以这一维不算劣化；名称 / 类型 / NOT NULL / 主键
 * 四维一个都没撤（`diffColumns` 报的是「谁缺了哪些 token」）。放弃那一维是否真的无损，
 * 由下面两条自证：一条拿构造样本钉「少列 / 换类型 / 丢 NOT NULL / 丢 PK 照样报」，
 * 一条往两个库各插**同一行**、按各自的物理序 SELECT、再按列名归一后逐字段比。
 * 这条放松因此不是「为了变绿把比较面改松」——`## Fixed` 那一类改动不许走那条路（§13.10.9）。
 *
 * 两条真跑路径都要付出起 drizzle 的代价（各 ~3-5s），所以这里**共用一次临时目录**
 * 与**一次** `db:push`：用例本身不是热路径，重复跑两遍 drizzle 只会让这个文件
 * 在 CI 上无谓地变慢（`check-test-concurrency` 也盯着并发档，别用 `it.concurrent`
 * 绕成本）。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acquireRepoDrizzle } from "./helpers/repo-drizzle-lock";

/** 一张表的可比结构：列（名/类型/非空/主键）+ 索引名。 */
interface TableShape {
  cols: string;
  idx: string;
}

let tmp: string;
/** `db:migrate` 建出来的库。 */
let migratedDb: string;
/** `db:push` 建出来的库（对照组）。 */
let pushedDb: string;

/** 读一个库的全部用户表结构（排除 sqlite 内部表与 drizzle 账本表）。 */
function readShape(file: string): Record<string, TableShape> {
  const script = `
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(${JSON.stringify(file)}, { readOnly: true, open: true });
    const names = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations' ORDER BY name"
    ).all().map((r) => r.name);
    const out = {};
    for (const n of names) {
      const cols = db.prepare("PRAGMA table_info(" + n + ")").all()
        .map((c) => c.name + ":" + c.type + (c.notnull ? " NOT NULL" : "") + (c.pk ? " PK" : ""))
        .join(",");
      const idx = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name=? AND name NOT LIKE 'sqlite_%' ORDER BY name"
      ).all(n).map((r) => r.name).join(",");
      out[n] = { cols, idx };
    }
    db.close();
    console.log(JSON.stringify(out));
  `;
  const r = spawnSync(process.execPath, ["-e", script], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (r.status !== 0 || !r.stdout.trim()) {
    throw new Error(`读库结构失败：${r.stderr}`);
  }
  return /* SAFETY: 类型断言已复核 */ JSON.parse(r.stdout) as Record<string, TableShape>;
}

/**
 * 两条路的列集比对（ISSUE #2655）：报「谁缺了哪些列」，**不比列的物理顺序**。
 *
 * 每个 token 的形状是 `名:类型 [NOT NULL] [PK]` —— 名称 / 类型 / NOT NULL / 主键
 * 四个语义维都在这一个串里，所以「按 token 比集合」一维没撤；撤掉的只有
 * 「这些 token 的排列」。那一维在 SQLite 里没有语义：`ALTER TABLE ADD COLUMN`
 * 只能把新列追加在表尾，而 `db:push` 按 `schema.ts` 的声明序建表 ——
 * 两条路**结构等价却永远产不出同一个顺序**，把它算成不等价就是比较器的过严维度。
 *
 * 报 `missing` / `extra` 而不是「整串不等」：读者要能立刻看出少的是哪一列，
 * 而一条「两个长串不相等」的读数答不出这个问题（本仓 `db-push.mjs` 的第二次复核
 * 就是为了「有表但结构不对」那一族加的，这里同理）。
 *
 * @param leftCols `db:migrate` 那一侧的 token 串（物理序）
 * @param rightCols `db:push` 那一侧的 token 串（物理序）
 */
function diffColumns(
  leftCols: string,
  rightCols: string,
): { missing: Array<string>; extra: Array<string> } {
  const left = leftCols ? leftCols.split(",") : [];
  const right = rightCols ? rightCols.split(",") : [];
  return {
    /* `missing` = 只在右边有的（「migrate 侧缺什么」），`extra` = 只在左边有的。 */
    missing: right.filter((tok) => !left.includes(tok)),
    extra: left.filter((tok) => !right.includes(tok)),
  };
}

/**
 * 真 `drizzle/` 的独占锁（与 `tests/db-migrate-noninteractive.test.ts` 共用一把）。
 *
 * 那一份判「前提不成立」时要把真迁移目录整个挪开，而本文件两次 `db-migrate` 都**要靠
 * 它在场** —— 两个文件在不同 worker 里并行时，本文件的 `beforeAll` 会读到一个被改名走的
 * `drizzle/`，表现是「一条断言都没红、整个文件在 setup 里挂，话术写着没有可应用的迁移」。
 * 实测见规范 §11.19.2 与本轮的 `check:all` 日志。
 */
let releaseDrizzle: (() => void) | null = null;

beforeAll(async () => {
  releaseDrizzle = await acquireRepoDrizzle("db-migrate-equivalence");
  try {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "db-migrate-eq-"));
    migratedDb = path.join(tmp, "migrated.sqlite");
    pushedDb = path.join(tmp, "pushed.sqlite");

    const migrate = spawnSync(
      process.execPath,
      [path.join(process.cwd(), "scripts", "db-migrate.mjs")],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, DATABASE_URL: `file:${migratedDb}` },
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 300_000,
      },
    );
    if (migrate.status !== 0) {
      throw new Error(`db:migrate 失败：${migrate.stderr || migrate.stdout}`);
    }

    const push = spawnSync(process.execPath, [path.join(process.cwd(), "scripts", "db-push.mjs")], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: `file:${pushedDb}` },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 300_000,
    });
    if (push.status !== 0) {
      throw new Error(`db:push 失败：${push.stderr || push.stdout}`);
    }
  } catch (error) {
    /* 拿到锁之后的**任何**失败都要先放锁再抛：漏放会把这台检出后面每一次运行都顶成
     * 「等不到锁」，而那条红长得像并发问题（帮助文件里那句「主家没了才回收」是兜底，
     * 不是让人放心漏放的借口）。 */
    releaseDrizzle();
    releaseDrizzle = null;
    throw error;
  }
}, 600_000);

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  releaseDrizzle?.();
  releaseDrizzle = null;
});

describe("db:migrate ⇄ db:push 的 schema 等价", () => {
  it("两条路建出的库都不空（否则下面的等价断言是空对空）", () => {
    const a = readShape(migratedDb);
    const b = readShape(pushedDb);
    expect(Object.keys(a).length, "migrate 没建出表").toBeGreaterThan(10);
    expect(Object.keys(b).length, "push 没建出表").toBeGreaterThan(10);
  });

  it("表集合一致", () => {
    const a = Object.keys(readShape(migratedDb)).sort();
    const b = Object.keys(readShape(pushedDb)).sort();
    expect(a).toEqual(b);
  });

  it("逐表逐列一致（列名 / 类型 / NOT NULL / 主键；**不比列序**，ISSUE #2655）", () => {
    const a = readShape(migratedDb);
    const b = readShape(pushedDb);
    const mismatches: Array<string> = [];
    for (const name of Object.keys(a)) {
      /* `noUncheckedIndexedAccess` 下 `a[name]` 是 `T | undefined` —— 这里用
       * 解构取出来并显式收窄，而不是 `!` 断言：断言会把「键不在」这类真问题
       * 一起咽掉（上面那条 `!b[name]` 的 continue 已经表达了「只在两边都有时比」）。 */
      const left = a[name];
      const right = b[name];
      if (!left || !right) {
        continue;
      }
      const diff = diffColumns(left.cols, right.cols);
      if (diff.missing.length || diff.extra.length) {
        mismatches.push(
          `${name}:\n  migrate 侧缺 ${JSON.stringify(diff.missing)}\n` +
            `  push   侧缺 ${JSON.stringify(diff.extra)}`,
        );
      }
    }
    expect(mismatches, "迁移生成物与 schema.ts 漂开了").toEqual([]);
  });

  it("比较器本体：语义四维照样报，只有**列序**不报（放松的那一维要能自证）", () => {
    /* 这一条是 #2655 的**反面**，缺了它，上面那一改就只是「把比较面改松让红消失」。
     * 三个断言分别对应本仓反复踩过的那三种真劣化（少列 / 类型换 / NOT NULL 丢），
     * 第四个才是被放弃的那一维：同一批 token 换个顺序不算漂。 */
    expect(diffColumns("a:TEXT NOT NULL", "a:TEXT NOT NULL,b:INTEGER")).toEqual({
      missing: ["b:INTEGER"],
      extra: [],
    });
    /* `missing` 恒指「migrate 侧缺的」（= 只在 push 那一边出现的 token），
     * `extra` 恒指「push 侧缺的」—— 类型换掉时两侧各出现一条，这才是真漂移的形状。 */
    expect(diffColumns("a:TEXT", "a:INTEGER")).toEqual({
      missing: ["a:INTEGER"],
      extra: ["a:TEXT"],
    });
    expect(diffColumns("a:TEXT NOT NULL", "a:TEXT")).toEqual({
      missing: ["a:TEXT"],
      extra: ["a:TEXT NOT NULL"],
    });
    expect(diffColumns("a:TEXT NOT NULL PK,b:TEXT", "b:TEXT,a:TEXT NOT NULL PK")).toEqual({
      missing: [],
      extra: [],
    });
    /* 主键那一维单独确认一次：`PK` 在 token 里，丢了它两条就不等。 */
    expect(diffColumns("a:TEXT PK", "a:TEXT").missing).toEqual(["a:TEXT"]);
  });

  it("同一行数据在两个库里**按名取回**逐字段一致（列序无语义这件事的行为证据）", () => {
    /* 「SQLite 列序没有语义」不靠一句教条：这里给两条路各插**同一行**（每列按类型给值），
     * 再按各自的列序拼 SELECT、取回后按**列名**比对。两个库的物理列序不同（上面那三张
     * 漂过的表就是证据），而按名取值的结果必须逐字段相同 —— 那才是本仓读侧真正依赖的事
     * （drizzle 的 select 生成的也是列名列表，没有一个位置取值）。 */
    const tables = ["production", "task", "workshopSession"];
    for (const t of tables) {
      /* 取结构时把「表不在」显式抛出来，而不是留一个 `| undefined` 到处 `!`：
       * 断言写不出「为什么没有这张表」，而这一条的失败信息必须是「migrate 侧没有它」。 */
      const shapeOf = (file: string): TableShape => {
        const s = readShape(file)[t];
        if (!s) {
          throw new Error(`${t} 不在 ${file} 里 ⇒ 这条用例没有对象`);
        }
        return s;
      };
      const a = shapeOf(migratedDb);
      const b = shapeOf(pushedDb);
      const tokens = (s: TableShape): Array<string> => s.cols.split(",");
      /* token 形状是 `名:类型 [NOT NULL] [PK]` —— 取名就是切到第一个冒号为止。 */
      const namesOf = (s: TableShape): Array<string> =>
        tokens(s).map((tok) => tok.slice(0, tok.indexOf(":")));
      const values = tokens(a).map((tok) => (tok.includes(":INTEGER") ? 7 : "probe"));
      /**
       * 在这个库里插同一行、再按 `selectList`（**这一侧自己的物理列序**）取回，
       * 还原成 `名=值` 的有序串 —— 顺序进、名字出，两边才能直接比。
       */
      const readBack = (file: string, selectList: Array<string>) => {
        const script = [
          'const { DatabaseSync } = require("node:sqlite");',
          `const db = new DatabaseSync(${JSON.stringify(file)}, { open: true });`,
          /* node:sqlite 默认**开着**外键，而这里要插的是「一行孤立数据」——它的
           * `userId` / `projectId` 之类的引用列在临时库里没有对应行。本格判的是
           * 「列按名取回的结果与物理列序无关」，不是约束（约束另有 `db-migrate`
           * 那批用例与索引集合那条守着），所以取样时把 FK 关掉，且只动临时库。 */
          'db.prepare("PRAGMA foreign_keys=OFF").run();',
          `const cols = ${JSON.stringify(namesOf(a))};`,
          `db.prepare("DELETE FROM ${t}").run();`,
          `db.prepare("INSERT INTO ${t} (" + cols.join(",") + ") VALUES ("` +
            `  + cols.map(() => "?").join(",") + ")").run(...${JSON.stringify(values)});`,
          `const row = db.prepare("SELECT ${selectList.join(",")} FROM ${t}").get();`,
          "db.close();",
          'console.log(cols.map((c) => c + "=" + row[c]).join("|"));',
        ].join("\n");
        const r = spawnSync(process.execPath, ["-e", script], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
        expect(r.status, `在 ${t} 上取样失败：${r.stderr || r.stdout}`).toBe(0);
        return r.stdout.trim();
      };
      /* 两条路的物理列序**确实**不同 —— 这一点当场成立这条用例才不是空对空：
       * 哪天两条路连顺序都一致了（例如基线迁移被重建成建表序），这里会红并说清原因。 */
      expect(
        a.cols,
        `${t} 两边列序已一致 ⇒ 这条用例失去意义（那不是坏消息，但要把 #2655 这条一起收掉）`,
      ).not.toBe(b.cols);
      /* 各按自己的物理序 SELECT，再按名归一：两个串必须逐字段相等。 */
      expect(readBack(migratedDb, namesOf(a))).toBe(readBack(pushedDb, namesOf(b)));
    }
  });

  it("索引集合一致", () => {
    const a = readShape(migratedDb);
    const b = readShape(pushedDb);
    const mismatches: Array<string> = [];
    for (const name of Object.keys(a)) {
      const left = a[name];
      const right = b[name];
      if (!left || !right) {
        continue;
      }
      if (left.idx !== right.idx) {
        mismatches.push(`${name}: migrate=[${left.idx}] push=[${right.idx}]`);
      }
    }
    expect(mismatches, "索引漂开（外键/唯一约束常在这里暴露）").toEqual([]);
  });

  it("迁移是幂等的：连跑两次第二次不改结构", () => {
    const before = readShape(migratedDb);
    const r = spawnSync(process.execPath, [path.join(process.cwd(), "scripts", "db-migrate.mjs")], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: `file:${migratedDb}` },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 300_000,
    });
    expect(r.status, "第二次迁移必须是 no-op 且 exit 0").toBe(0);
    expect(readShape(migratedDb)).toEqual(before);
  }, 300_000);
});
