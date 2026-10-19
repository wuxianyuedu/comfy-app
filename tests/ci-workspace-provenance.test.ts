/**
 * 工作区出处判据（ISSUE #2022）—— 常驻工作区那一步必须先有的那块地基。
 *
 * 为什么这一档必须有判据而不是「配置里一行脚本」：它判的是「这次跑的是哪份源码、
 * 谁改了工作区」，而它的失效形态**不会让任何别的档变红** —— 名单漂移、路径解析少一个
 * 字符、把「拿不到声明」读成「一致」，三种都只会让这一档**自己看起来在跑**。
 *
 * 四组，各自钉一个真实失效形态：
 *   ① 解析：`git status --porcelain -z` 的首条记录以空格开头（未暂存修改的 `XY` 是 `" M"`），
 *      任何「顺手 trim 一下」都会让第一条路径少一个字符 ⇒ 前缀比对当场失效，而那一条
 *      恰好是名单外的写者（本轮实测踩过，红话里印出的是 `cripts/…`）。
 *   ② 允许名单：必须**派生自** `AUTOFIX_DUTIES`，不许在本文件之外再抄一份前缀。
 *   ③ 三格的档位：①② 判红、③ 只取数 —— 一条恒真的断言不是判据。
 *   ④ 出口：红 ⇒ 退非零，其余 ⇒ 退 0；红话要点名文件并打出名单。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { AUTOFIX_DUTIES } from "../scripts/ci-autofix-duties.mjs";
import {
  DECLARED_SHA_ENV,
  parseStatus,
  provenanceVerdict,
  underWriter,
  writerPrefixes,
  main,
} from "../scripts/ci-workspace-provenance.mjs";

const tmpDirs: string[] = [];
function tmpLedgerDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prov-ledger-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("解析 git status -z", () => {
  it("首条记录的 `XY` 是「空格 + M」时，路径不许少一个字符", () => {
    /* 这就是 trim 那一格的回归：整串 stdout 被 trim 过 → " M scripts/a.ts" 变成
     * "M scripts/a.ts" → 按 3 取下标得到 "cripts/a.ts"。前缀比对会把它读成
     * 「名单外的写者」，而名字本身已经不可信。 */
    const raw = " M scripts/ci-autofix-duties.mjs\0?? scripts/new.mjs\0";
    const got = parseStatus(raw);
    expect(got.trackedDirty).toEqual(["scripts/ci-autofix-duties.mjs"]);
    expect(got.untracked).toEqual(["scripts/new.mjs"]);
  });

  it("重命名是双段记录：只认结果路径，源路径不再被当成一条记录", () => {
    const got = parseStatus("R  docs/api/new.html\0docs/api/old.html\0");
    expect(got.trackedDirty).toEqual(["docs/api/new.html"]);
    expect(got.untracked).toEqual([]);
  });

  it("空输出 ⇒ 两个清单都空（而不是「解析失败」）", () => {
    expect(parseStatus("")).toEqual({ trackedDirty: [], untracked: [] });
  });
});

describe("允许写脏的名单", () => {
  it("前缀派生自 AUTOFIX_DUTIES，不在别处另抄一份", () => {
    /* 夹具只给一档、outputs 与现役名单完全不同 ⇒ 结果只可能来自入参，
     * 从而证明这一份名单不是手抄的第二处。 */
    expect(
      writerPrefixes([
        { stage: "甲", outputs: ["docs/generated/"] },
        { stage: "乙", outputs: ["docs/generated/", "coverage/"] },
        { stage: "丙" },
      ]),
    ).toEqual(["docs/generated/", "coverage/"]);
    /* 现役那份必须与登记表同源（少一档 = 加自动修时忘了登记，本档会当场误报）。 */
    expect(writerPrefixes()).toEqual([
      ...new Set(AUTOFIX_DUTIES.flatMap((d) => d.outputs ?? [])),
    ]);
    expect(writerPrefixes().length).toBe(AUTOFIX_DUTIES.length);
  });

  it("underWriter 认前缀，也认「就是那个目录本身」，但不认后半截同名", () => {
    const allow = ["docs/generated/", "docs/api/"];
    expect(underWriter("docs/generated/13.md", allow)).toBe(true);
    expect(underWriter("docs/generated", allow)).toBe(true);
    expect(underWriter("src/app/page.tsx", allow)).toBe(false);
    /* `docs/generated-x/` 这种「看着像」的不许命中：漏判一个写者比多判一个更贵，
     * 但误判会让人学会忽略这一档的红。 */
    expect(underWriter("docs/generated-notes/x.md", allow)).toBe(false);
  });

  it("登记名单为空 ⇒ 任何 tracked 改动都是名单外（不许「名单没配 ⇒ 一律放行」）", () => {
    expect(underWriter("docs/generated/13.md", [])).toBe(false);
    const got = provenanceVerdict({
      trackedDirty: ["docs/generated/13.md"],
      untracked: [],
      prefixes: [],
      declared: null,
      head: null,
    });
    expect(got.red).toBe(true);
    expect(got.offenders).toEqual(["docs/generated/13.md"]);
  });
});

describe("三格的判定与档位", () => {
  const base = {
    trackedDirty: [] as string[],
    untracked: [] as string[],
    prefixes: ["docs/generated/", "docs/api/"],
  };

  it("① HEAD 与声明一致 ⇒ ok；不一致 ⇒ 红；任一侧拿不到 ⇒ 「未校验」而不是红", () => {
    const sha = "a".repeat(40);
    expect(provenanceVerdict({ ...base, declared: sha, head: sha }).red).toBe(
      false,
    );
    const mismatch = provenanceVerdict({
      ...base,
      declared: sha,
      head: "b".repeat(40),
    });
    expect(mismatch.red).toBe(true);
    expect(mismatch.lines.join("\n")).toContain("出处·红");
    for (const declared of [null, undefined, ""]) {
      const unknown = provenanceVerdict({
        ...base,
        declared,
        head: sha,
      });
      expect(unknown.red, `拿不到声明时不许判红（${String(declared)}）`).toBe(
        false,
      );
      expect(unknown.lines.join("\n")).toContain("出处·未校验");
    }
  });

  it("① 的比较按大小写与前后空白无关（平台注入的形态不止一种）", () => {
    const upper = "ABCDEF0123456789ABCDEF0123456789ABCDEF01";
    const got = provenanceVerdict({
      ...base,
      declared: `  ${upper.toLowerCase()}  `,
      head: upper,
    });
    expect(got.red).toBe(false);
  });

  it("② 名单外的 tracked 改动 ⇒ 红，并点名文件与那份名单", () => {
    const got = provenanceVerdict({
      ...base,
      declared: null,
      head: null,
      trackedDirty: ["docs/generated/13.md", "src/lib/comfyui/executor.ts"],
    });
    expect(got.red).toBe(true);
    expect(got.offenders).toEqual(["src/lib/comfyui/executor.ts"]);
    const text = got.lines.join("\n");
    expect(text).toContain("写脏·红");
    expect(text).toContain("src/lib/comfyui/executor.ts");
    expect(text).toContain("docs/generated/");
  });

  it("② 全部落在登记前缀下 ⇒ 不红，且要说清「有几处、都登记过」", () => {
    const got = provenanceVerdict({
      ...base,
      declared: null,
      head: null,
      trackedDirty: ["docs/generated/13.md", "docs/api/index.html"],
    });
    expect(got.red).toBe(false);
    expect(got.lines.join("\n")).toContain("全部落在登记过的写者前缀下");
  });

  it("③ 未跟踪文件只取数、永不判红（一条恒真的断言不是判据）", () => {
    const got = provenanceVerdict({
      ...base,
      declared: null,
      head: null,
      untracked: [
        "leftover.tmp",
        "src/scratch.ts",
        "a",
        "b",
        "c",
        "d",
        "e",
        "f",
        "g",
      ],
    });
    expect(got.red).toBe(false);
    const text = got.lines.join("\n");
    expect(text).toContain("未跟踪·读数 9 处");
    /* 有界打印：第九处不在正文里点名，但要把「另几处」说出来，不冒充全量。 */
    expect(text).toContain("另 1 处");
  });

  it(`${DECLARED_SHA_ENV} 这一格的名字本身就是判据的一部分（换了注入键要当场发现）`, () => {
    expect(DECLARED_SHA_ENV).toBe("CNB_COMMIT");
  });
});

describe("出口", () => {
  it("红 ⇒ 退非零；绿 ⇒ 退 0；而 git status 没跑起来 ⇒ 按「未校验」退 0", () => {
    const dir = tmpLedgerDir();
    const sha = "c".repeat(40);
    const run = (cmd: string, args: string[]) =>
      cmd === "git" && args[0] === "rev-parse"
        ? { ok: true, out: sha }
        : { ok: false, out: "" };
    const spawnOk = (stdout: string) => () => ({ status: 0, stdout });

    expect(
      main({
        cwd: path.sep,
        env: { CNB_COMMIT: sha, COMFYAPP_CI_PROBE_DIR: dir },
        run,
        spawn: spawnOk(" M src/app/page.tsx\0"),
        ledgerDir: dir,
      }),
    ).toBe(1);

    expect(
      main({
        cwd: path.sep,
        env: { CNB_COMMIT: sha, COMFYAPP_CI_PROBE_DIR: dir },
        run,
        spawn: spawnOk(" M docs/generated/13.md\0"),
        ledgerDir: dir,
      }),
    ).toBe(0);

    /* `git status` 起不来（status 非 0）：三格全部失去依据 ⇒ 说「没有结论」，
     * 不拿「tracked 面是空的」冒充「干净」。 */
    expect(
      main({
        cwd: path.sep,
        env: { CNB_COMMIT: sha, COMFYAPP_CI_PROBE_DIR: dir },
        run,
        spawn: () => ({ status: 128, stdout: "" }),
        ledgerDir: dir,
      }),
    ).toBe(0);
  });

  it("账本落在 ledgerRoot 那一个目录里，且每次跑追加一条（跨构建对照要有历史）", () => {
    const dir = tmpLedgerDir();
    const sha = "d".repeat(40);
    const env = { CNB_COMMIT: sha, COMFYAPP_CI_PROBE_DIR: dir };
    const run = () => ({ ok: true, out: sha });
    const spawn = () => ({ status: 0, stdout: "?? leftover.tmp\0" });
    main({ cwd: path.sep, env, run, spawn, ledgerDir: dir });
    main({ cwd: path.sep, env, run, spawn, ledgerDir: dir });
    const file = path.join(dir, "comfyapp-ci-workspace-provenance.json");
    /* `JSON.parse` 回 `any` —— 直接取用会让后面三行都挂在 any 上（eslint 三条 unsafe 就
     * 落在这）。按本档真正断言的那三格收成有类型的账目，注入面与读出面从此同一个形状。 */
    const ledger = JSON.parse(fs.readFileSync(file, "utf8")) as unknown[];
    expect(Array.isArray(ledger)).toBe(true);
    expect(ledger.length).toBe(2);
    expect(ledger[0]).toMatchObject({ red: false, offenders: 0, untracked: 1 });
  });
});
