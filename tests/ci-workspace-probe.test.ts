import path from "node:path";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { describe, expect, it } from "vitest";

import {
  cacheVerdict,
  dirFact,
  envReadout,
  fmtAge,
  reuseVerdict,
  workspaceProbeLines,
} from "../scripts/ci-workspace-probe.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const CWD = path.join(os.tmpdir(), "probe-ws");
const LEDGER = path.join(os.tmpdir(), "probe-ledger.json");
const NOW = 1_800_000_000_000;

/** 一次「像 CI 那样的检出」：detached HEAD、没有 refs/heads、没有 remote、单 pack。 */
const GIT_FACTS: Record<string, string> = {
  "rev-parse HEAD": "a".repeat(40),
  "for-each-ref --format=%(refname) refs/heads": "",
  "rev-list --count HEAD": "5123",
  "count-objects -v": [
    "count: 0",
    "size: 0",
    "in-pack: 39323",
    "packs: 1",
    "size-pack: 133531",
    "prune-packable: 0",
    "garbage: 0",
    "size-garbage: 0",
  ].join("\n"),
  "rev-parse --is-shallow-repository": "false",
  remote: "",
};

function fakeRun(facts: Record<string, string> = GIT_FACTS) {
  return (cmd: string, args: string[]) => {
    if (cmd !== "git") return { ok: false, out: "" };
    const key = args.join(" ");
    return key in facts
      ? { ok: true, out: facts[key] ?? "" }
      : { ok: false, out: "" };
  };
}

/**
 * 一台假文件系统：只按**显式列出的路径**回答 stat，其余一律 ENOENT。
 *
 * `ledgerBody` 是账本文件的既有内容（不存在就别给，读它会抛 —— 那正是「第一跑」的形态）。
 * 写进去的内容收在 `written` 里，用例据此判「这一跑到底有没有把对照记下来」。
 */
function fakeFs(
  tree: Record<string, { birth?: number; mtime?: number }>,
  ledgerBody?: string,
) {
  const written = new Map<string, string>();
  /** 记「为账本建过哪些目录」—— 这一档要把账本写在工作区之外，建父目录那一跳得能判。 */
  const made: string[] = [];
  const fsLike = {
    statSync(target: string) {
      const hit = tree[target];
      if (!hit) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return { birthtimeMs: hit.birth ?? 0, mtimeMs: hit.mtime ?? 0 };
    },
    readFileSync(target: string) {
      if (target !== LEDGER || ledgerBody === undefined) {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      }
      return ledgerBody;
    },
    writeFileSync(target: string, data: string) {
      written.set(target, data);
    },
    mkdirSync(target: string) {
      made.push(target);
    },
  };
  return { fsLike, written, made };
}

/** 完整工作区：`.git` 30s 前出现，node_modules 与 .next 都在。 */
function warmTree(
  overrides: Record<string, { birth?: number; mtime?: number }> = {},
) {
  return {
    [CWD]: { birth: NOW - 60_000 },
    [path.join(CWD, ".git")]: { birth: NOW - 30_000 },
    [path.join(CWD, ".git/FETCH_HEAD")]: { birth: NOW - 30_000 },
    [path.join(CWD, "node_modules")]: { birth: NOW - 20_000 },
    [path.join(CWD, ".next")]: { birth: NOW - 10_000 },
    [path.join(CWD, "coverage")]: { birth: NOW - 10_000 },
    [path.join(CWD, "playwright-report")]: { birth: NOW - 10_000 },
    ...overrides,
  };
}

/**
 * 账本里的一条。字段写全：真从 JSON 读回来的就是全的，判据不许拿半个形状喂被测函数
 * （那会把「缺字段时怎么办」这件没定义过的事悄悄写成期望）。
 */
function entryOf(
  over: {
    cwd?: string;
    gitBornMs?: number;
    gitAgeS?: number;
    atMs?: number;
  } = {},
) {
  return {
    atMs: over.atMs ?? NOW,
    cwd: over.cwd ?? CWD,
    head: "e".repeat(40),
    gitBornMs: over.gitBornMs ?? 1000,
    gitAgeS: over.gitAgeS ?? 30,
    nodeModulesBornMs: 1,
  };
}

/** 一个目录的读数，形状与 `dirFact` 的返回一致。 */
function factOf(present: boolean, ageS: number | null = null) {
  return {
    present,
    ageS,
    bornMs: present ? NOW - 1000 : null,
    from: present ? "birth" : "-",
  };
}

/** `cacheVerdict` 不收的那几件，先给一份底 —— 它要的入参是完整的七件。 */
const baseFacts = {
  workspace: factOf(true, 60),
  gitDir: factOf(true, 30),
  fetchHead: factOf(true, 30),
  coverage: factOf(true, 10),
  "playwright-report": factOf(false),
};

function probe(
  tree: Record<string, { birth?: number; mtime?: number }>,
  ledgerBody?: string,
) {
  const { fsLike, written, made } = fakeFs(tree, ledgerBody);
  return {
    lines: workspaceProbeLines({
      cwd: CWD,
      env: {
        COMFYAPP_CI_PROBE_DIR: os.tmpdir(),
        CNB_TOKEN: "tk-should-never-appear",
      },
      nowMs: NOW,
      run: fakeRun(),
      fs: fsLike,
      ledger: LEDGER,
    }),
    written,
    made,
  };
}

describe("ci-workspace-probe —— 工作区跨构建复用的读数", () => {
  it("把磁盘侧事实打出来：cwd、.git 的年龄、HEAD 形状、对象库大小", () => {
    const { lines } = probe(warmTree());
    const text = lines.join("\n");
    expect(text).toContain(CWD);
    expect(text).toContain(".git                在场，30s 前出现");
    expect(text).toContain(`${"a".repeat(12)} (detached)`);
    expect(text).toContain("refs/heads ×0");
    expect(text).toContain("133531 KiB");
  });

  it("第一跑只有本次 ⇒ 结论·未定，而不是拿「没有对照」下一句结论", () => {
    const { lines } = probe(warmTree());
    const text = lines.join("\n");
    expect(text).toContain("结论·未定");
    expect(text).not.toContain("结论·①");
    expect(text).not.toContain("结论·②");
    expect(text).not.toContain("结论·③");
  });

  it("真的把这一跑记进账本了（下一跑才有对照可查）", () => {
    const { written, made } = probe(warmTree());
    const body = written.get(LEDGER);
    expect(
      body,
      "账本没落盘 ⇒ 这一档每跑一次都是「第一跑」，对照永远不会出现",
    ).toBeDefined();
    expect(
      made,
      "账本的父目录没建 ⇒ 宿主上第一次写会 ENOENT，读数从此永远只有本次",
    ).toContain(path.dirname(LEDGER));
    const entries = JSON.parse(String(body)) as Array<{
      cwd: string;
      gitBornMs: number | null;
    }>;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.cwd).toBe(CWD);
    expect(entries[0]?.gitBornMs).toBe(NOW - 30_000);
  });

  it("历史里没有一个同一目录 ⇒ 判成「①每次新检出」，并给下一动作与那条必须同批的断言", () => {
    const history = JSON.stringify([
      {
        atMs: NOW - 86_400_000,
        cwd: path.join(os.tmpdir(), "cnb-old-job"),
        head: "b".repeat(40),
        gitBornMs: NOW - 86_400_000,
        gitAgeS: 86_400,
      },
    ]);
    const text = probe(warmTree(), history).lines.join("\n");
    expect(text).toContain("结论·①每次新目录");
    expect(text).toContain("git.enable: false");
    expect(text).toContain("git rev-parse HEAD");
  });

  it("同一目录且 .git 出生时间没变 ⇒ 判成「②已经在增量 fetch」，并说清别为它动检出层", () => {
    const history = JSON.stringify([
      {
        atMs: NOW - 600_000,
        cwd: CWD,
        head: "c".repeat(40),
        gitBornMs: NOW - 30_000,
        gitAgeS: 570,
      },
    ]);
    const text = probe(warmTree(), history).lines.join("\n");
    expect(text).toContain("结论·②同目录且 .git 没被重建");
    expect(text).not.toContain("结论·①");
  });

  it("同一目录但 .git 被重建 ⇒ 判成「③」，报的是两个年龄而不是一句「复用了」", () => {
    const history = JSON.stringify([
      {
        atMs: NOW - 600_000,
        cwd: CWD,
        head: "d".repeat(40),
        gitBornMs: NOW - 570_000,
        gitAgeS: 570,
      },
    ]);
    const text = probe(warmTree(), history).lines.join("\n");
    expect(text).toContain("结论·③同目录但 .git 被重建");
    expect(text).toContain("上一次同目录那跑现于 10m 前");
  });

  it("账本读不动时照打磁盘侧读数，而不是整档消失", () => {
    const { lines } = probe(warmTree(), "{ 不是 JSON");
    const text = lines.join("\n");
    expect(text).toContain(CWD);
    expect(text).toContain("结论·未定");
  });

  it("工作区不是 git 检出（git 全都问不到）⇒ 不抛、照打并说明", () => {
    const { fsLike } = fakeFs(warmTree());
    const lines = workspaceProbeLines({
      cwd: CWD,
      env: { COMFYAPP_CI_PROBE_DIR: os.tmpdir() },
      nowMs: NOW,
      run: () => ({ ok: false, out: "" }),
      fs: fsLike,
      ledger: LEDGER,
    });
    const text = lines.join("\n");
    expect(text).toContain("git 读不到");
    expect(text).toContain("== 跨构建对照");
  });

  it("凭据只在「在场 + 长度」这一格出现，值一个字都不进日志", () => {
    const lines = envReadout({
      CNB_TOKEN: "tk-should-never-appear",
      CNB_REPO_SLUG: "root/comfy-app-t3",
      CNB_SOMETHING_SECRET: "s3cret-value",
      CNB_NOT_AT_ALL: "x",
    });
    const text = lines.join("\n");
    expect(text).not.toContain("tk-should-never-appear");
    expect(text).not.toContain("s3cret-value");
    expect(text).toContain("CNB_TOKEN 在场");
    expect(text).toContain("CNB_REPO_SLUG = root/comfy-app-t3");
  });

  it("整份输出有界且有凭据在场：长度守得住，值一个字都不许漏出去", () => {
    const { lines } = probe(warmTree());
    const text = lines.join("\n");
    expect(Buffer.byteLength(text, "utf8")).toBeLessThan(8192);
    expect(text).toContain("CNB_TOKEN 在场");
    expect(
      text,
      "凭据进了 CI 日志就是分发出去 —— 这一档只许报「在场 + 长度」（硬规则 17）",
    ).not.toContain("tk-should-never-appear");
  });

  describe("reuseVerdict 的三态边界", () => {
    const current = entryOf({ gitBornMs: 1000, gitAgeS: 30 });

    it("空历史 ⇒ 未定；「这一跑自己」永远不该被当成对照（它由调用方在写入之前取出）", () => {
      expect(reuseVerdict([], current).join("\n")).toContain("结论·未定");
    });

    it("并行 PR 各自不同目录是正常形态 ⇒ 全部历史都不重合才下「每次新检出」", () => {
      const text = reuseVerdict(
        [
          entryOf({
            cwd: path.join(os.tmpdir(), "job-a"),
            gitBornMs: 1,
            gitAgeS: 10,
          }),
          entryOf({
            cwd: path.join(os.tmpdir(), "job-b"),
            gitBornMs: 2,
            gitAgeS: 20,
          }),
        ],
        current,
      ).join("\n");
      expect(text).toContain("结论·①");
      expect(text).toContain("此前 2 次");
    });
  });

  describe("cacheVerdict 只按真会产出的那两件下结论", () => {
    it("node_modules 与 .next 都不在场 ⇒ 两句都指向冷态", () => {
      const text = cacheVerdict({
        ...baseFacts,
        node_modules: factOf(false),
        ".next": factOf(false),
      }).join("\n");
      expect(text).toContain("安装是从零装起");
      expect(text).toContain("生产构建冷缓存");
    });

    it("两件都在场 ⇒ 不许再说「从零装」", () => {
      const text = cacheVerdict({
        ...baseFacts,
        node_modules: factOf(true, 20),
        ".next": factOf(true, 10),
      }).join("\n");
      expect(text).toContain("不是从零起");
      expect(text).toContain("带着上一轮的产物图");
    });

    it("不在场那两件不许进结论 —— coverage 按当前配置本来就可能整条路径都不产出", () => {
      const text = cacheVerdict({
        ...baseFacts,
        node_modules: factOf(true, 20),
        ".next": factOf(true, 10),
        coverage: factOf(false),
        "playwright-report": factOf(false),
      }).join("\n");
      expect(text).not.toContain("coverage");
      expect(text).not.toContain("playwright-report");
    });
  });

  it("年龄读数分档：CI 上要看的量级留在秒，开发检出那种几十岁不退化成「0d」", () => {
    expect(fmtAge(0)).toBe("0s");
    expect(fmtAge(30)).toBe("30s");
    expect(fmtAge(89)).toBe("89s");
    expect(fmtAge(90)).toBe("2m");
    expect(fmtAge(570)).toBe("10m");
    expect(fmtAge(3599)).toBe("60m");
    expect(fmtAge(3600)).toBe("1h");
    expect(fmtAge(86399)).toBe("24h");
    expect(fmtAge(86400)).toBe("1d");
    expect(fmtAge(4_923_662)).toBe("57d");
    expect(fmtAge(null)).toBe("-");
  });

  it("文件系统没有 birthtime 时退回 mtime，并如实标出用的是哪一个", () => {
    const { fsLike } = fakeFs({ [CWD]: { mtime: NOW - 5_000 } });
    expect(dirFact(CWD, NOW, fsLike)).toMatchObject({
      present: true,
      ageS: 5,
      from: "mtime",
    });
  });

  it("真机自证：直接执行它，在真工作区上要退 0 且真的打出正文", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ci-workspace-probe-"));
    const r = spawnSync(process.execPath, ["scripts/ci-workspace-probe.mjs"], {
      cwd: ROOT,
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, COMFYAPP_CI_PROBE_DIR: dir },
    });
    expect(r.stderr, "这一档是读数：任何情况下都不该把故障写成非零退出").toBe(
      "",
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("== 检出与工作区 ==");
    expect(r.stdout).toContain("== 结论（读数，不判红绿）==");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
