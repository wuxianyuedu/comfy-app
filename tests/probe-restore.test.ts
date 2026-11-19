/**
 * 探针还原共享件的自证（ISSUE #2593）：进用例之前就是脏的那份工作，跑完还得是那一版 —— 「还原的凭据是快照，不是 git 索引」；现场与因果见 `tests/helpers/probe-restore.ts` 文件头。
 * 前四格落在**临时目录**（口径同 ISSUE #2415 对 `doc:render` 的改造）——为了防丢工作而拿真实工作区测这件事，自己就成了那次丢工作。
 * 后四格扫 `tests/**` 的**文本**：性质只住注释里下一个换写法就绕过去（§11.23）；其中两格是量具自证，三种被禁形状各自要认得出（含 `git checkout HEAD -- <文件>`），相邻正当写法不许误伤。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stripComments } from "./helpers/strip-comments.ts";
import {
  realProbeIo,
  restoreToSnapshot,
  snapshotPaths,
  type ProbeIo,
} from "./helpers/probe-restore.ts";

const REPO_ROOT = resolve(process.cwd());

let work = "";
const target = (name: string) => join(work, name);

beforeEach(() => {
  work = join(
    tmpdir(),
    `probe-restore-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(work, { recursive: true });
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

describe("探针还原 —— 凭据是快照，不是索引", () => {
  it("进用例之前就脏的那份工作，跑完还原的仍是那份脏（不是 HEAD 那一版）", () => {
    const abs = target("doc.md");
    /* 「进之前就在做的活」：文件已存在，内容与已提交的那版不同。旧实现唯一的误判
     * 就在这 —— 它拿 `git status` 说「这是探针留的脏」。 */
    const inProgress = "# 文档（本次分支正在写的那一版）\n\n新增 92 行里的一段。\n";
    writeFileSync(abs, inProgress, "utf8");

    const snap = snapshotPaths([abs], realProbeIo);
    /* 探针动手：追加一行只在测试期间存在的文本（真实用例就是这么写的）。 */
    writeFileSync(abs, `${inProgress}\n探针：这一行只在测试期间存在。\n`, "utf8");

    const { restored, failed } = restoreToSnapshot(snap, realProbeIo);
    expect(failed).toEqual([]);
    expect(restored).toEqual([abs]);
    expect(readFileSync(abs, "utf8")).toBe(inProgress);
  });

  it("探针新建的文件（快照里没有）被删掉；没动过的格子一次写都不做", () => {
    const untouched = target("keep.md");
    writeFileSync(untouched, "本来就有，也没人碰\n", "utf8");
    const created = target("probe-new.md");

    const snap = snapshotPaths([untouched, created], realProbeIo);
    writeFileSync(created, "探针造出来的文件\n", "utf8");

    let writes = 0;
    const counting: ProbeIo = {
      ...realProbeIo,
      write: (abs, bytes) => {
        writes += 1;
        realProbeIo.write(abs, bytes);
      },
    };
    expect(restoreToSnapshot(snap, counting).failed).toEqual([]);
    expect(existsSync(created)).toBe(false);
    expect(readFileSync(untouched, "utf8")).toBe("本来就有，也没人碰\n");
    /* 「一致就什么都不写」不是省时间：一次多余的写会把 mtime 与文件锁递给别人的工作，
     * 而这一族守的恰恰是「别碰别人的未提交」。 */
    expect(writes).toBe(0);
  });

  it("写不进去 ⇒ 落在 `failed` 里并点名路径（不许静默，也不许顺手退回 HEAD）", () => {
    const abs = target("locked.md");
    writeFileSync(abs, "快照里的那一版\n", "utf8");
    const snap = snapshotPaths([abs], realProbeIo);
    writeFileSync(abs, "探针改过\n", "utf8");

    const stuck: ProbeIo = {
      ...realProbeIo,
      write: () => {
        throw new Error("UNKNOWN: unknown error, open");
      },
    };
    const { failed, restored } = restoreToSnapshot(snap, stuck);
    expect(restored).toEqual([]);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.abs).toBe(abs);
    expect(failed[0]?.why).toContain("UNKNOWN");
    /* 失败之后文件保持「探针改过」那一版，红会把它指出来 —— 静默回退成 HEAD
     * 才是本单要拦的那一步。 */
    expect(readFileSync(abs, "utf8")).toBe("探针改过\n");
  });

  it("「本来不存在」与「空文件」是两种状态：前者删、后者不写", () => {
    const never = target("never-existed.md");
    const snap = snapshotPaths([never], realProbeIo);
    let removes = 0;
    const counting: ProbeIo = {
      ...realProbeIo,
      remove: (abs) => {
        removes += 1;
        realProbeIo.remove(abs);
      },
    };
    /* 快照与现状都是「不存在」⇒ 一次删除都不该发生。 */
    expect(restoreToSnapshot(snap, counting).failed).toEqual([]);
    expect(removes).toBe(0);
    /* 探针留下一个空文件时，它必须被删掉 —— 把 `null` 与 `Buffer.alloc(0)` 混成一格，
     * 表现就是「探针造的文件留在了仓库里，而还原自称干净」。 */
    writeFileSync(never, "", "utf8");
    const r = restoreToSnapshot(snap, counting);
    expect(r.restored).toEqual([never]);
    expect(existsSync(never)).toBe(false);
  });
});

describe("口径要有执行者 —— 拿索引/HEAD 清工作区这种写法不再出现", () => {
  /**
   * 被禁是「把入库文件退回索引/HEAD」带**路径参数**的 git 形态 —— 索引之上那层正是人的未提交工作。
   * 三种形状要认：数组形 `"checkout", "--"`、字符串形 `checkout HEAD -- <路径>`（见 `freshness-ledger-backend.test.ts`）、`restore --`。
   * 相邻写法（`checkout -b`、`--track <远端>`）不误伤；`--` 必须**独立一格**，否则 `["checkout","--quiet","-b",…]` 会被当成 `checkout --`（`premerge-push-trigger.test.ts` 被误伤过）。
   */
  const DESTRUCTIVE =
    /(?:checkout|restore)(?:\s+HEAD)?\s+--(?=\s|$)|(?:checkout|restore)["']\s*,\s*["']--(?=["']|\s|$)/;

  /* 被禁形状一律**拼接**写出来：本文件自己也在这条判据的扫描面上，原样写着的夹具与
   * 红话会把自己算成命中（这条判据的第一失效模式就是自匹配；同一族的标本见
   * `tests/strip-comments-single-source.test.ts` 里 `DEFINITION_MARK` 那段）。
   * 拼出来的**值**与原字面量逐字相同 —— 由下面「被禁的三种形状各自命中」那格证明。 */
  const CHECKOUT = "check" + "out";
  const RESTORE = "rest" + "ore";
  const HEADSEP = "-" + "-";

  /** 命中就回报这一格；**先剥注释** —— 口径的叙述里必然出现被禁的形态本身（§11.23）。 */
  function hit(src: string, label: string): string | null {
    return DESTRUCTIVE.test(stripComments(src)) ? `  · ${label}` : null;
  }

  function tsFiles(dir: string): Array<string> {
    const out: Array<string> = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, e.name);
      if (e.isDirectory()) {
        out.push(...tsFiles(abs));
      } else if (e.isFile() && e.name.endsWith(".ts")) {
        out.push(abs.slice(REPO_ROOT.length + 1).replaceAll("\\", "/"));
      }
    }
    return out;
  }

  it("tests/** 里没有一处用 git 索引/HEAD 清理工作区", () => {
    const hits = tsFiles(join(REPO_ROOT, "tests"))
      .map((rel) => hit(readFileSync(join(REPO_ROOT, rel), "utf8"), rel))
      .filter((h): h is string => h !== null);
    expect(
      hits,
      `这几份用例在拿 git 索引/HEAD 清理工作区 —— 它会把同一分支上未提交的合法改动一起退回 HEAD（#2593 / §11.16.2）：\n${hits.join("\n")}\n出路：改用 tests/helpers/probe-restore.ts（进用例前拍字节，还原也只回那份字节）。`,
    ).toEqual([]);
  });

  it("被禁的三种形状各自命中（数组形 / `checkout HEAD --` 字符串形 / `restore --`）", () => {
    const forbidden = [
      `execFileSync("git", ["${CHECKOUT}", "${HEADSEP}", rel]);`,
      `git(\`${CHECKOUT} HEAD ${HEADSEP} \${E2E_REL}\`);`,
      `git("${RESTORE} ${HEADSEP} path/to/file");`,
    ];
    const missed = forbidden.filter((src) => hit(src, "fixture") === null);
    expect(
      missed,
      "这几条被禁写法扫不出来 —— 判据只在**在场的那些**形状上有效，" +
        `认不出字符串形就等于把 \`git ${CHECKOUT} HEAD ${HEADSEP} <文件>\` 放回来` +
        "（#2593 的现场正是字符串形）。",
    ).toEqual([]);
  });

  it("相邻的正当写法不误伤（切分支 / `--quiet -b` / `--track`）", () => {
    const benign = [
      'git(["checkout", "-b", "feat/x"]);',
      'git(["checkout", "--quiet", "-b", "feat/x"]);',
      'git("checkout --track origin/master");',
      'git(["switch", "-c", "feat/x"]);',
    ];
    const wrong = benign.filter((src) => hit(src, "fixture") !== null);
    expect(
      wrong,
      "这几条被误伤了 —— 它们不退回任何人的工作树，把它们一起拦下会让人绕开判据。",
    ).toEqual([]);
  });

  /**
   * 两份**吃过这一次事故**的用例各自钉一行：只靠「全仓扫一遍」不够 —— 那一条在
   * 「有人把 import 共享件那行删掉、改回 `git checkout`」时会同时红两格，而红话里
   * 说不出「这两份就是当年的现场」；点名到文件，下一人才知道改的是哪一处的历史。
   */
  /* SAFETY: 类型断言已复核 */
  it.for([
    ["tests/check-doc-references.test.ts", "四份入库文档的探针收尾"],
    ["tests/freshness-ledger-backend.test.ts", "真仓库账文件的临时提交"],
  ] as const)("%s 走共享件，不再拿索引/HEAD 覆盖工作树", ([rel, what]) => {
    const src = readFileSync(join(REPO_ROOT, rel), "utf8");
    expect(src, `${rel} 没引用 tests/helpers/probe-restore.ts`).toContain(
      "./helpers/probe-restore.ts",
    );
    expect(stripComments(src), `${rel} 的${what}又回到 git 那一版`).not.toMatch(DESTRUCTIVE);
  });
});
