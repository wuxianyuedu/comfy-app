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
  DECLARED_SHA_ENVS,
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
    const got = parseStatus("R  src/lib/new.ts\0src/lib/old.ts\0");
    expect(got.trackedDirty).toEqual(["src/lib/new.ts"]);
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
    /* 现役那份必须与登记表同源（少一档 = 加自动修时忘了登记，本档会当场误报）。
     * 长度断的是「去重后的前缀数 == 档数」—— 该等式只在各档 outputs 互不重叠时成立
     * （#2342 的 prettier 档 outputs=src/**+.storybook/**，与 docs 档无重叠但让
     * 「档数==前缀数」这个隐含假设显形了）。断言改成真正要守的：**每个登记档的
     * outputs 都在派生名单里**（一个不少），且名单里没有任何登记外的来源。 */
    const prefixes = writerPrefixes();
    for (const duty of AUTOFIX_DUTIES) {
      for (const out of duty.outputs ?? []) {
        expect(prefixes, `${duty.stage} 的 ${out} 不在派生名单里`).toContain(
          out,
        );
      }
    }
  });

  it("underWriter 认前缀，也认「就是那个目录本身」，但不认后半截同名", () => {
    const allow = ["docs/generated/", "coverage/"];
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
    prefixes: ["docs/generated/", "coverage/"],
  };

  /**
   * 出处那一格问的是「有没有**含**声明的那一份」，不是「逐字等于」。
   *
   * 平台对 `pull_request` 事件检出的是临时合并提交：本档上线后连着两跑红在这一格，
   * 两次 HEAD 各不相同（`7776cc6bfb1f` / `aa0a02578300`）而声明面是 `202c7524` /
   * `c87f48c7`，两个 HEAD 都不在任何远程引用上。逐字相等从第一天起就不成立 ——
   * 这四档把它钉成形状：等 ⇒ ok、含 ⇒ ok、不含 ⇒ 红、算不出 ⇒ 未校验。
   */
  it("① 等 ⇒ ok；含（祖先）⇒ ok 并交出父提交与树；不含 ⇒ 红；算不出 ⇒ 未校验", () => {
    const sha = "a".repeat(40);
    const other = "b".repeat(40);
    const shape = { parents: [sha, "c".repeat(40)], tree: "d".repeat(40) };
    expect(provenanceVerdict({ ...base, declared: sha, head: sha }).red).toBe(
      false,
    );
    const merged = provenanceVerdict({
      ...base,
      declared: sha,
      head: other,
      contains: true,
      shape,
    });
    expect(merged.red).toBe(false);
    const mergedText = merged.lines.join("\n");
    expect(mergedText).toContain("出处·ok");
    expect(mergedText).not.toContain("不是同一份"); // 旧的假前提话术不许回潮
    expect(mergedText).toContain("父提交 2 个");
    expect(mergedText).toContain("树 " + shape.tree.slice(0, 12));
    const stale = provenanceVerdict({
      ...base,
      declared: sha,
      head: other,
      contains: false,
      shape,
    });
    expect(stale.red).toBe(true);
    expect(stale.lines.join("\n")).toContain("出处·红");
    const unknownRelation = provenanceVerdict({
      ...base,
      declared: sha,
      head: other,
      contains: null,
    });
    expect(unknownRelation.red, "拿不到祖先关系就判红 = 把缺测量当结论").toBe(
      false,
    );
    expect(unknownRelation.lines.join("\n")).toContain("出处·未校验");
  });

  it("① 拿不到声明 ⇒ 「未校验」而不是红（这一条与上一条不同格：缺一侧 vs 缺关系）", () => {
    const sha = "a".repeat(40);
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
      trackedDirty: ["docs/generated/13.md", "coverage/lcov.info"],
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

  it(`${DECLARED_SHA_ENVS.join(" / ")} 这组键名与**顺序**都是判据的一部分`, () => {
    /* 键名换了会当场发现（这条原来就在）；顺序是新增的那半 —— PR 事件上 HEAD 等于 merge
     * 面而不是源 head 面，把它排到后面就等于回到那两跑的红（假红会教会所有人绕过这一档，
     * 见 §13.5.3.4.2 与本文件那段注释）。 */
    expect(DECLARED_SHA_ENVS).toEqual([
      "CNB_PULL_REQUEST_MERGE_SHA",
      "CNB_COMMIT",
    ]);
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

  /**
   * 祖先关系那一格的**三值**必须在 git 封装上就分得开（不是只在纯函数里想过）。
   *
   * `merge-base --is-ancestor` 对「对象根本不在这里」与「在、但不是祖先」退的都是非零 ——
   * 直接把退出码当结论，会把「取不到测量」读成「测量结果为假」，于是常驻工作区一旦没带上
   * 那个对象就全红，而真正该红的陈旧树混在里面看不出来（§13.6.4.1 那一类）。
   * 所以先单独验对象在不在，再判祖先，两条各退各的档。
   */
  it("HEAD ≠ 声明时：含 ⇒ 0、不含 ⇒ 1、对象取不到 ⇒ 0（未校验而不是红）", () => {
    const dir = tmpLedgerDir();
    const declared = "a".repeat(40);
    const head = "b".repeat(40);
    const face =
      (verifyOk: boolean, ancestorOk: boolean) =>
      (cmd: string, args: string[]) => {
        if (cmd !== "git") return { ok: false, out: "" };
        if (args[0] === "rev-parse" && args[1] === "HEAD")
          return { ok: true, out: head };
        if (args[0] === "rev-parse" && args[1] === "--verify")
          return { ok: verifyOk, out: verifyOk ? declared : "" };
        if (args[0] === "merge-base")
          return {
            ok: ancestorOk,
            out: ancestorOk ? "" : "fatal: Not a valid object name",
          };
        if (args[0] === "log") return { ok: true, out: declared };
        return { ok: false, out: "" };
      };
    const call = (verifyOk: boolean, ancestorOk: boolean) =>
      main({
        cwd: path.sep,
        env: { CNB_COMMIT: declared, COMFYAPP_CI_PROBE_DIR: dir },
        run: face(verifyOk, ancestorOk),
        spawn: () => ({ status: 0, stdout: "" }),
        ledgerDir: dir,
      });

    expect(call(true, true)).toBe(0);
    expect(call(true, false)).toBe(1);
    expect(call(false, false)).toBe(0);
  });

  /**
   * PR 事件那一跑的真实形状（这次假红的原位复现）：HEAD 是 merge 提交，
   * 而 `CNB_COMMIT` 是源分支 head —— 两个键都在场时**必须**先认 merge 面。
   *
   * 这条不是假想题：前两条构建就是这样红的（`7776cc6bfb1f` / `aa0a02578300` 对
   * `202c7524` / `c87f48c7`），而规范 §13.5.3.4.2 早已记下「要比对的是
   * `CNB_PULL_REQUEST_MERGE_SHA`」。它钉住的是「别再拿另一个键去断言」这个顺序本身。
   */
  it("PR 形态：merge 面 == HEAD 而源 head 面 ≠ HEAD ⇒ ok（不许再假红）", () => {
    const dir = tmpLedgerDir();
    const mergeSha = "e".repeat(40);
    const sourceSha = "f".repeat(40);
    expect(
      main({
        cwd: path.sep,
        env: {
          CNB_PULL_REQUEST_MERGE_SHA: mergeSha,
          CNB_COMMIT: sourceSha,
          COMFYAPP_CI_PROBE_DIR: dir,
        },
        run: (cmd: string, args: string[]) =>
          cmd === "git" && args[1] === "HEAD"
            ? { ok: true, out: mergeSha }
            : { ok: false, out: "" },
        spawn: () => ({ status: 0, stdout: "" }),
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
