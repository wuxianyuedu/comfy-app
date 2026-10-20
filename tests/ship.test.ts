/**
 * `pnpm ship`（`scripts/ship*.mjs` 这一族）的**取数**判据。
 *
 * ## 为什么这份文件只测「取数」，不测「流程走没走完」
 *
 * `ship` 是编排层，它唯一的新逻辑就是**从外部执行者那里把结论读对**。流程本身
 * 全是既有判据（`pre-commit` / `pre-push` / 平台 build / `is_merged`），那些各有
 * 自己的执行者，不该在这里重测一遍（AGENTS 硬规则 24：不在调用点重抄）。
 *
 * 而「读错一个字段」在这一族里是**最贵的失效**，因为它不报错、只是把结论换掉：
 *
 *   · 把 HTTP 信封的 `status: 200` 读成流水线终态 ⇒ 一条从没跑起来的 build 被报成成功；
 *   · 并行会话的 build 列表里挑了不相干的那条 ⇒ 拿别人的绿灯合自己的 PR；
 *   · 「列表没拿到」与「拿到了但没有我的」并成一格 ⇒ 「没测到」被读成「测过了」。
 *
 * 前两条是**实测踩到的**（ISSUE #2027 那趟流程里：非 JSON 输出里 `status:` 出现两次，
 * `grep '^status:'` 恒取到 200，于是白轮询 28 次；同一时刻另有两条 `pull_request` 在跑）。
 * 所以本文件里的每一条都喂**那份真实形状**的样本，而不是喂一个理想化的最小对象。
 *
 * ## 反向样本（缺了就会静默全绿的那几种）
 *
 * `readBuildVerdict` 那组里刻意各有一条「只有信封字段」与「data 是别的形状」的负控制 ——
 * 判据若被写成 `json.status ?? json.data.status`，正样本照样绿，只有负样本会红。
 */
import fs, { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  asArray,
  buildPullBody,
  CODE,
  combineShipCodes,
  findPullForBranch,
  parseArgs,
  parseSlug,
  pickBuildForSha,
  planCommands,
  readBuildVerdict,
  readPullVerdict,
  resolveUpstream,
} from "../scripts/ship-core.mjs";
import { main } from "../scripts/ship.mjs";

/** 真机取到的一份 `cnb build get-build-status -v` 的形状（信封 + data 各有一个 status）。 */
const BUILD_ENVELOPE_AND_DATA = {
  status: 200,
  trace: "00-abc-01",
  contentType: "application/json; charset=utf-8",
  data: {
    status: "success",
    pipelinesStatus: { "x-001": { status: "success" } },
  },
};

describe("readBuildVerdict：只认 data.status，信封那个 status 与判决无关", () => {
  it("两个 status 并存时取的是 data 那一个", () => {
    expect(readBuildVerdict(BUILD_ENVELOPE_AND_DATA)).toEqual({
      state: "green",
      raw: "success",
    });
  });

  it("负控制：只有信封 status（data 缺席）⇒ unknown，**不是** green", () => {
    // 写成 `json.status ?? json.data.status` 的实现会让这条正样本「看起来对」，
    // 而它读的其实是 HTTP 状态码 —— 200 永远不等于流水线绿。
    expect(readBuildVerdict({ status: 200 }).state).toBe("unknown");
    expect(readBuildVerdict(null).state).toBe("unknown");
    expect(readBuildVerdict({ data: {} }).state).toBe("unknown");
    expect(
      readBuildVerdict({ data: { status: /** @type {any} */ 200 } }).state,
    ).toBe("unknown");
  });

  it("data.status 的三档：success / 终态失败 / 在跑", () => {
    expect(readBuildVerdict({ data: { status: "success" } }).state).toBe(
      "green",
    );
    for (const s of ["failed", "error", "cancelled", "canceled"]) {
      expect(readBuildVerdict({ data: { status: s } }).state).toBe("red");
    }
    for (const s of ["running", "pending", "queued", "waiting", "created"]) {
      expect(readBuildVerdict({ data: { status: s } }).state).toBe("running");
    }
    // 认不出的值不猜方向：unknown ⇒ 调用方退 2，而不是退 0 或退 1。
    expect(readBuildVerdict({ data: { status: "whatever" } }).state).toBe(
      "unknown",
    );
  });

  it("大小写不敏感（平台在 success / SUCCESS 之间换过写法）", () => {
    expect(readBuildVerdict({ data: { status: "SUCCESS" } }).state).toBe(
      "green",
    );
  });
});

describe("pickBuildForSha：并行会话下只认 sha 命中那条", () => {
  const MINE = "d02ec96364d5f3713b77c91b0d3fe789878f1747";
  const OTHER = "3d6aceb456db9aff10a5eee692db3a241afff818";

  it("同 event 两条并存时，选中的是 sha 命中的那条", () => {
    const builds = [
      {
        sn: "cnb-t9s-other",
        event: "pull_request",
        sha: OTHER,
        createTime: "2026-10-19T09:20:00Z",
      },
      {
        sn: "cnb-7f0-mine",
        event: "pull_request",
        sha: MINE,
        createTime: "2026-10-19T09:12:32Z",
      },
    ];
    expect(pickBuildForSha(builds, MINE)).toEqual({
      sn: "cnb-7f0-mine",
      createTime: "2026-10-19T09:12:32Z",
    });
  });

  it("负控制：sha 不在列表里 ⇒ null，**不许**退化成「拿最新那条」", () => {
    // 退化成「最新」就是把别人的 build 读成自己的 —— 那正是这一族最贵的误读。
    const builds = [
      { sn: "cnb-x", event: "pull_request", sha: OTHER, createTime: "z" },
    ];
    expect(pickBuildForSha(builds, MINE)).toBeNull();
  });

  it("event 不是 pull_request 的不算（同一 sha 可能是 push / 每日档）", () => {
    const builds = [
      { sn: "cnb-daily", event: "push", sha: MINE, createTime: "z" },
    ];
    expect(pickBuildForSha(builds, MINE)).toBeNull();
  });

  it("同 sha 多条时取 createTime 最新的那条", () => {
    const builds = [
      {
        sn: "old",
        event: "pull_request",
        sha: MINE,
        createTime: "2026-10-19T09:00:00Z",
      },
      {
        sn: "new",
        event: "pull_request",
        sha: MINE,
        createTime: "2026-10-19T10:00:00Z",
      },
    ];
    expect(pickBuildForSha(builds, MINE)?.sn).toBe("new");
  });

  it("sha 比对不区分大小写，且入参畸形时不抛", () => {
    expect(
      pickBuildForSha(
        [
          {
            sn: "a",
            event: "pull_request",
            sha: MINE.toUpperCase(),
            createTime: "z",
          },
        ],
        MINE,
      )?.sn,
    ).toBe("a");
    expect(pickBuildForSha([], MINE)).toBeNull();
    expect(pickBuildForSha(/** @type {any} */ null, MINE)).toBeNull();
    expect(pickBuildForSha([{ sn: "a" }], "")).toBeNull();
  });
});

describe("asArray：「没拿到列表」与「拿到了但是空的」是两件事", () => {
  it("两种 data 形状都收", () => {
    expect(asArray({ data: [{ sn: "a" }] })).toHaveLength(1);
    expect(asArray({ data: { data: [{ sn: "a" }] } })).toHaveLength(1);
  });

  it("取不到回 null（⇒ 调用方退 2），不回空数组（⇒ 会被读成「查过了，没有」）", () => {
    expect(asArray({})).toBeNull();
    expect(asArray(null)).toBeNull();
    expect(asArray({ data: null })).toBeNull();
  });
});

describe("combineShipCodes：2 压过 1", () => {
  it("「有一步没跑起来」不被「另有几步红了」盖掉", () => {
    expect(combineShipCodes([CODE.GREEN, CODE.RED, CODE.NOT_RUN])).toBe(
      CODE.NOT_RUN,
    );
    expect(combineShipCodes([CODE.GREEN, CODE.RED])).toBe(CODE.RED);
    expect(combineShipCodes([CODE.GREEN])).toBe(CODE.GREEN);
    expect(combineShipCodes([])).toBe(CODE.GREEN);
  });

  it("三态的字面值钉住（0 绿 / 1 红 / 2 没跑起来），与 premerge-check 同口径", () => {
    expect([CODE.GREEN, CODE.RED, CODE.NOT_RUN]).toEqual([0, 1, 2]);
  });
});

describe("parseArgs：拼错的旗标不许被静默忽略", () => {
  it("未知旗标进 unknown（调用方据此停，而不是当成「没要那个动作」）", () => {
    const a = parseArgs(["--merg"]);
    expect(a.merge).toBe(false);
    expect(a.unknown).toEqual(["--merg"]);
  });

  it("合并默认关；--message / --add 两种写法都收", () => {
    expect(parseArgs([]).merge).toBe(false);
    expect(parseArgs(["--merge"]).merge).toBe(true);
    expect(parseArgs(["--message=x"]).message).toBe("x");
    expect(parseArgs(["-m", "x"]).message).toBe("x");
    expect(parseArgs(["--add", "a.ts", "--add=b.md"]).adds).toEqual([
      "a.ts",
      "b.md",
    ]);
  });

  it("--no-wait 与 --only 各自独立", () => {
    expect(parseArgs(["--no-wait"]).wait).toBe(false);
    expect(parseArgs(["--only=poll"]).only).toBe("poll");
  });
});

describe("parseSlug：https 与 ssh 两种 origin 都要认", () => {
  it("取不到就回 null（不猜一个仓库名 —— 猜错会把 PR 开到别处）", () => {
    expect(parseSlug("https://cnb.cool/moon-read/comfy-app-t3")).toBe(
      "moon-read/comfy-app-t3",
    );
    expect(parseSlug("https://cnb.cool/moon-read/comfy-app-t3.git")).toBe(
      "moon-read/comfy-app-t3",
    );
    expect(parseSlug("git@cnb.cool:moon-read/comfy-app-t3.git")).toBe(
      "moon-read/comfy-app-t3",
    );
    expect(parseSlug("")).toBeNull();
    expect(parseSlug("https://cnb.cool/")).toBeNull();
  });
});

/**
 * 远端名与上游基线的推导。这一组存在的原因是这一版把 `origin` **写死在五处**
 * （`get-url origin` / `origin/master...HEAD` 取碎片 / `git push -u origin` /
 * `fetch origin master` / `cat-file origin/master:<碎片>`），而本仓按硬规则 6 只有
 * 一个叫 `cnb` 的远端 —— 五条命令全部失败，而失败在每一处都长得像「答案为空」：
 * 碎片那一查拿到空串 ⇒ preflight 报「没有 changelog.d 碎片」⇒ `pnpm ship` 在本仓
 * 从第一次跑起就没工作过，报的还是一个听起来正当的理由。
 */
describe("resolveUpstream：远端名与主干基线（两处都是每台克隆自己的事实）", () => {
  it("① 有上游就用上游 —— 这是 git 已经知道的事，不另推", () => {
    expect(
      resolveUpstream({ upstream: "cnb/master", remotes: ["cnb"] }),
    ).toEqual({
      remote: "cnb",
      base: "cnb/master",
      source: "upstream",
    });
    /* 带斜杠的分支名不能被截断（`cnb` + `release/2026-10`）。 */
    expect(
      resolveUpstream({ upstream: "cnb/release/2026-10", remotes: ["cnb"] })
        .base,
    ).toBe("cnb/release/2026-10");
  });

  it("② 没有上游但只有唯一远端 ⇒ 推 `<远端>/master`，并标明是推的", () => {
    const got = resolveUpstream({ upstream: "", remotes: ["cnb"] });
    expect(got).toEqual({
      remote: "cnb",
      base: "cnb/master",
      source: "sole-remote",
    });
    /* 推出来的东西必须读得出它是推的：默认分支不叫 master 时这一档会偏，
     * 而调用方靠「基线引用验不过」那一格把它抓住 —— 不是靠这里猜对。 */
    expect(got.source).not.toBe("upstream");
  });

  it("③ 多个远端且没有上游 ⇒ 回到 origin 的习惯；再没有就给 null", () => {
    expect(
      resolveUpstream({ upstream: null, remotes: ["origin", "gitee"] }).remote,
    ).toBe("origin");
    expect(
      resolveUpstream({ upstream: null, remotes: ["cnb", "gitee"] }),
    ).toEqual({
      remote: null,
      base: null,
      source: "none",
    });
    /* `null` 是「没有执行者」的入参，不是「基线是空字符串」——
     * 后者会让 `${base}...HEAD` 变成一条语法合法、语义全错的 git 命令。 */
    expect(resolveUpstream({ upstream: null, remotes: [] }).base).toBeNull();
  });

  it("④ 上游取的是「谁在跟踪」，不是「主干在哪」 —— 自跟踪必须退回主干", () => {
    /* `git push -u origin feat/x` 之后 `@{u}` = `cnb/feat/x`（分支自己在远端的副本）。
     * 拿它当基线 ⇒ `cnb/feat/x...HEAD` 恒空 ⇒ 碎片那一查报 0 份。这一档必须让位于
     * 「远端默认分支」那条事实。 */
    expect(
      resolveUpstream({
        upstream: "cnb/feat/x",
        remotes: ["cnb"],
        localBranch: "feat/x",
        remoteHead: "refs/remotes/cnb/master",
      }),
    ).toEqual({ remote: "cnb", base: "cnb/master", source: "remote-head" });

    /* 反过来：上游是**别的目标分支**（人显式设的，如往 release 线开 PR）时，
     * 那仍然是最贴事实的基线，不能被默认分支顶掉。 */
    expect(
      resolveUpstream({
        upstream: "cnb/release/2026-10",
        remotes: ["cnb"],
        localBranch: "feat/x",
        remoteHead: "refs/remotes/cnb/master",
      }).base,
    ).toBe("cnb/release/2026-10");

    /* 这台克隆没有 `refs/remotes/<远端>/HEAD`（手工 clone 常见）⇒ 只能推
     * `<远端>/master`，且来源要读得出是推的，不能冒充 `upstream`。 */
    const guessed = resolveUpstream({
      upstream: "cnb/feat/x",
      remotes: ["cnb"],
      localBranch: "feat/x",
      remoteHead: null,
    });
    expect(guessed.base).toBe("cnb/master");
    expect(guessed.source).not.toBe("upstream");

    /* 在 master 上自跟踪时，「基线 = 上游」本来就成立 —— 这一档不能把那条也顶掉，
     * 否则①那一档的真语义就没了。 */
    expect(
      resolveUpstream({
        upstream: "cnb/master",
        remotes: ["cnb"],
        localBranch: "master",
        remoteHead: "refs/remotes/cnb/master",
      }).base,
    ).toBe("cnb/master");
  });
});

describe("findPullForBranch：重跑不产生第二个 PR", () => {
  const LIST = {
    data: [
      { number: 2029, state: "open", head: { ref: "refs/heads/fix/a" } },
      { number: 2025, state: "open", head: { ref: "refs/heads/feat/b" } },
    ],
  };

  it("按 head.ref 命中；没有就回 null（⇒ 才去建）", () => {
    expect(findPullForBranch(LIST, "feat/b")).toBe(2025);
    expect(findPullForBranch(LIST, "feat/nope")).toBeNull();
    expect(findPullForBranch({}, "feat/b")).toBeNull();
    expect(findPullForBranch(null, "feat/b")).toBeNull();
  });
});

describe("readPullVerdict：字段缺省时不抛，且默认值是「没合上」", () => {
  it("缺 data / 缺字段都归一到安全默认", () => {
    expect(readPullVerdict(null)).toEqual({
      number: null,
      mergeableState: "unknown",
      blockedOn: "",
      isMerged: false,
      state: "unknown",
    });
    expect(
      readPullVerdict({
        data: { number: 2027, is_merged: true, mergeable_state: "mergeable" },
      }).isMerged,
    ).toBe(true);
  });
});

describe("planCommands：dry-run 打印的就是真跑时会执行的同一份 argv", () => {
  const st = {
    branch: "feat/x",
    sha: "abcdef1234567890",
    slug: "moon-read/comfy-app-t3",
    adds: ["src/a.ts"],
    hasMessage: true,
    merge: true,
    /* 远端名是**每台克隆机器自己的事实**（并行检出里实测见过 `cnb`，本检出是
     * `origin`，见 docs/audits/2026-10-12 R12-01），所以夹具故意给一个不是 `origin`
     * 的名字：计划里那一行必须用**解析出的**远端名 —— 写死 `origin` 时这一版在 push
     * 那一段就起不来，而 dry-run 照样打印得很漂亮：计划与执行两头都写着同一条错。 */
    remote: "cnb",
    baseBranch: "master",
  };

  it("逐条含命令本体，且平台调用一律带 -v（JSON 是唯一取数面）", () => {
    const plan = planCommands(st);
    expect(plan).toContain("git add -- src/a.ts");
    expect(plan).toContain("git push -u cnb feat/x");
    expect(plan.some((l) => l.includes("--base master --head feat/x"))).toBe(
      true,
    );
    for (const line of plan.filter((l) => l.startsWith("cnb "))) {
      expect(line, `计划里这条 cnb 调用没带 -v：${line}`).toContain("-v");
    }
  });

  it("合并那一行只在 merge 为真时出现（默认不合并这条纪律的自证）", () => {
    expect(planCommands(st).some((l) => l.includes("merge-pull"))).toBe(true);
    expect(
      planCommands({ ...st, merge: false }).some((l) =>
        l.includes("merge-pull"),
      ),
    ).toBe(false);
  });

  it("计划里的碎片那一查与执行面同形（取并的两条，不是那条已经没人跑的 ls-files）", () => {
    /* `planCommands` 是抄本，抄本会过期：#2034 把执行面从 `git ls-files changelog.d`
     * （数出整个目录 118 份 ⇒ 那条守卫恒真）改成「分支相对主干已提交的 ∪ 还没提交的」
     * 之后，计划里那一行还停在旧取数面上。dry-run 是给人的第一份说明书，
     * 它写着一件不存在的查询，就把错的取数面教给了读者。 */
    const plan = planCommands(st);
    expect(plan).toContain(
      "git diff --name-only cnb/master...HEAD -- changelog.d",
    );
    expect(plan).toContain("git status --porcelain -- changelog.d");
    expect(plan.join("\n")).not.toContain("git ls-files");
    /* 带斜杠的主干名（往 release 线开 PR）不能被拼成 `cnb/release`。 */
    expect(
      planCommands({
        ...st,
        remote: "cnb",
        baseBranch: "release/2026-10",
      }).some((l) =>
        l.includes("git diff --name-only cnb/release/2026-10...HEAD"),
      ),
    ).toBe(true);
  });

  it("对账：计划里的「模块+工具」对 ⇄ 源码里真实调用的，必须同集合", () => {
    /* `planCommands` 是命令清单的第二份抄本 —— 这正是要避免的形态，所以不装作它不是：
     * 这里把它与真执行面**逐条对账**，任何一侧新增/改名而另一侧没跟，这条就红。
     * 只比「模块 + 工具」这一对（参数值里有 `<tmp>` / `…` 这类占位，逐字比会脆）。
     * 取数面是 `scripts/ship*.mjs` **整个族**，不是某一个文件：cnb 调用从编排入口
     * 搬去平台侧模块时，只读单份文件的提取会抓到 0 条 ⇒ 两侧都空集、于是恒绿，
     * 而下面那条前置断言就是拦住这种「提取坏了却看起来像结论」的。 */
    const shipDir = path.resolve(__dirname, "../scripts");
    const src = readdirSync(shipDir)
      .filter((f) => /^ship.*\.mjs$/.test(f))
      .map((f) => readFileSync(path.join(shipDir, f), "utf8"))
      .join("\n");
    /** 从 `cnbJson(run, ["pulls", "post-pull", …])` 里抽出前两个字符串。 */
    const called = new Set<string>();
    for (const m of src.matchAll(
      /cnbJson\(run,\s*\[\s*"(\w+)"\s*,\s*"([\w-]+)"/g,
    )) {
      called.add(`${m[1]} ${m[2]}`);
    }
    const planned = new Set<string>();
    for (const line of planCommands({ ...st, merge: true })) {
      const m = /^cnb (\w+) ([\w-]+)/.exec(line);
      if (m) planned.add(`${m[1]} ${m[2]}`);
    }
    // 前置断言：提取本身要真的抓到东西（正则写漂会让两侧都成空集、于是恒绿）。
    expect(
      called.size,
      "从源码里一条 cnb 调用都没抽到 ⇒ 提取正则坏了",
    ).toBeGreaterThan(0);
    expect(planned).toEqual(called);
  });
});

describe("buildPullBody：只搬量到的事实，不生成会被复核的因果句", () => {
  it("碎片标题与 diffstat 进正文", () => {
    const body = buildPullBody({
      root: process.cwd(),
      fragments: ["changelog.d/0-nonexistent-for-test.md"],
      diffstat: " 1 file changed",
    });
    expect(body).toContain("changelog.d/0-nonexistent-for-test.md");
    expect(body).toContain("1 file changed");
  });

  it("负控制：正文里不许出现 check-commit-claims 会拿事实复核的那三种句式", () => {
    // ①「§x.y 照旧保留」②「<path> 一个字没动」③「N 处…收到 0」。
    // 脚本没跑过那些判据，写出来就是**未经验证的声明**进了历史。
    const body = buildPullBody({
      root: process.cwd(),
      fragments: ["changelog.d/0-x.md"],
      diffstat: " 3 files changed",
    });
    for (const banned of [
      "照旧保留",
      "一个字没动",
      "收到 0",
      "收到0",
      "没动",
    ]) {
      expect(body, `正文里出现了未经验证的声明句式：${banned}`).not.toContain(
        banned,
      );
    }
  });
});

describe("main()：用注入的假执行者钉住「哪些命令真的会被跑」", () => {
  /**
   * 注入执行者的返回形状 —— 与 `ship-exec.mjs` 的 `ExecResult` 同形。
   * 「同形」不是这句注释自己保证的：`main({ run })` 的入参类型就是那个 typedef，
   * 少一个字段（尤其 `stderr`）会当场在 `fake()` 的调用点报 TS 错。
   * 这里用 TS 语法而不是 JSDoc `@type`：本文件是 `.ts`，而 JSDoc 的变量/参数注解
   * 只在 `.js` / `.mjs` 里被采纳，在 `.ts` 里会被静默忽略（实测报
   * `Property 'branch' does not exist on type '{}'`）。
   */
  type FakeResult = {
    status: number;
    stdout: string;
    stderr: string;
    error: string | null;
  };

  /** 现场形状。 */
  type FakeEnv = {
    branch?: string;
    frags?: string[];
    cnbMissing?: boolean;
    /** 假 `git commit` 往 **stderr** 写的话（钩子的输出面）。 */
    commitStderr?: string;
    commitStatus?: number;
    /** 本次要暂存的文件（触发真提交那一支）。 */
    dirty?: string[];
    /** 这条分支相对上游基线**已提交**的碎片（第二次跑那一向）。 */
    branchFrags?: string[];
    /** HEAD 的上游（`git rev-parse --abbrev-ref --symbolic-full-name @{u}`）。 */
    upstream?: string | null;
    /** 那条上游引用在不在本地（验不验得过）。false = `rev-parse --verify` 退非 0。 */
    baseExists?: boolean;
    /** 远端默认分支的符号引用（`git symbolic-ref refs/remotes/<远端>/HEAD`）。
     *  `null` = 这台克隆没有它（那样就只能推 `<远端>/master`，且要读得出是推的）。 */
    remoteHead?: string | null;
  };

  /**
   * 造一个 git / cnb / node 的替身，并**记录每一次调用**。
   * 记录才是这一组的核心：断言的不是返回值，而是「它有没有伸手去改世界」。
   */
  function fake(env: FakeEnv = {}) {
    const calls: string[] = [];
    const branch = env.branch ?? "feat/x";
    const frags = env.frags ?? ["changelog.d/0-x.md"];
    const dirty = env.dirty ?? [];
    const ok = (stdout: string, stderr = ""): FakeResult => ({
      status: 0,
      stdout,
      stderr,
      error: null,
    });
    const run = (cmd: string, args: string[]): FakeResult => {
      calls.push([cmd, ...args].join(" "));
      const key = args.join(" ");
      if (cmd === "cnb" && args[0] === "--version") {
        return env.cnbMissing
          ? { status: -1, stdout: "", stderr: "", error: "ENOENT" }
          : ok("1.15.25");
      }
      /* ⚠️ 必须排在下面那条通用 `--abbrev-ref` **之前**：HEAD 那一查与上游那一查
       * 共用同一个前缀，顺序反了上游查询会拿到分支名，于是「远端解析」这一格
       * 判的是夹具自己的形状。 */
      if (cmd === "git" && key.includes("@{u}"))
        return ok(env.upstream === null ? "" : (env.upstream ?? "cnb/master"));
      /* 主干那一条有本地可读的权威事实：远端的 `HEAD` 符号引用。
       * 夹具默认给出（与真实克隆一致），`remoteHead: null` 那一格专门演「没有它」。 */
      if (cmd === "git" && key.includes("symbolic-ref"))
        return env.remoteHead === null
          ? { status: 1, stdout: "", stderr: "", error: null }
          : ok(env.remoteHead ?? "refs/remotes/cnb/master");
      if (cmd === "git" && key.includes("--abbrev-ref")) return ok(branch);
      if (cmd === "git" && key === "remote") return ok("cnb\n");
      if (cmd === "git" && key.includes("rev-parse --verify --quiet"))
        return env.baseExists === false
          ? { status: 1, stdout: "", stderr: "", error: null }
          : ok("d02ec96364d5f3713b77c91b0d3fe789878f1747");
      if (cmd === "git" && key.includes("rev-parse HEAD"))
        return ok("d02ec96364d5f3713b77c91b0d3fe789878f1747");
      // ⚠️ 顺序要紧：碎片那一查也是 `status --porcelain`，只是多一个 `-- changelog.d`。
      if (cmd === "git" && key.includes("status --porcelain -- changelog.d"))
        return ok(frags.map((f) => `?? ${f}`).join("\n"));
      if (cmd === "git" && key.includes("status --porcelain"))
        return ok(dirty.map((f) => `M  ${f}`).join("\n"));
      /* 分支相对上游**已提交**的碎片（同一条分支上第二次跑就靠这一格不为空）。
       * 这里**不**按某个写死的基线名命中 —— 命中基线名等于替被测代码担保「它选的
       * 那条引用是对的」。改为照 git 的语义答：拿 HEAD 自己这条分支的远端副本当基线
       * 就是自己比自己 ⇒ 结果必空，这正是那条缺陷的现场。 */
      if (
        cmd === "git" &&
        key.includes("diff --name-only") &&
        key.includes("...HEAD")
      ) {
        const base = key.replace("diff --name-only ", "").split("...")[0] ?? "";
        if (base === `cnb/${branch}`) return ok("");
        return ok((env.branchFrags ?? []).join("\n"));
      }
      if (cmd === "git" && key.startsWith("commit"))
        return {
          status: env.commitStatus ?? 0,
          stdout: "",
          stderr: env.commitStderr ?? "",
          error: null,
        };
      if (cmd === "git" && key.includes("get-url"))
        return ok("https://cnb.cool/moon-read/comfy-app-t3\n");
      if (cmd === "node" && key.includes("check-deps-freshness"))
        return ok("OK");
      return ok("");
    };
    return { run, calls };
  }

  /** 会改动世界的命令形状 —— dry-run 一条都不许碰。 */
  const WRITE_SHAPES = [
    "git add",
    "git commit",
    "git push",
    "git checkout",
    "git fetch",
    "cnb pulls post-pull",
    "cnb pulls merge-pull",
  ];

  /** 把 `main` 的输出吞掉：这一组判的是**调用面**，不是它说了什么。
   *  `probeCnb` 也一并注入 —— 否则每条用例都会去探一遍真机的 PATH，
   *  结论就随「这台机器装没装 cnb」漂了。 */
  const quiet = {
    root: process.cwd(),
    log: () => undefined,
    probeCnb: () => true,
  };

  it("dry-run 不执行任何写动作（这才是它敢让人随手跑的理由）", async () => {
    const { run, calls } = fake();
    const code = await main({ ...quiet, run, args: ["--dry-run"] });
    expect(code).toBe(CODE.GREEN);
    for (const w of WRITE_SHAPES) {
      expect(
        calls.filter((c) => c.startsWith(w)),
        `dry-run 竟然执行了：${w}`,
      ).toHaveLength(0);
    }
    // 它仍然要读 —— 不读就没法给出计划。
    expect(calls.some((c) => c.includes("--abbrev-ref"))).toBe(true);
  });

  it("负控制：dry-run 不保证恒退 0 —— 在 master 上照样报阻塞", async () => {
    // 「恒退 0」这句已从声明里撤掉，因为一个会藏掉阻塞事实的预览比不预览更糟。
    // 这条用例钉的是撤完之后行为不再被文档反向拉扯。
    const { run } = fake({ branch: "master" });
    expect(await main({ ...quiet, run, args: ["--dry-run"] })).toBe(CODE.RED);
  });

  it("没有 changelog.d 碎片 ⇒ 红（单 PR 单变更那条不成立）", async () => {
    const { run } = fake({ frags: [] });
    expect(await main({ ...quiet, run, args: ["--dry-run"] })).toBe(CODE.RED);
  });

  it("基线引用不存在 ⇒ 退 2 并说「没有事实源」，**不许**退成「没有碎片」的红", async () => {
    /* 这一格钉的是「取不到」与「取到且为空」必须长得不一样 —— 而这一版就是在这里
     * 把两件事混成一件的：远端名写死 `origin`，`origin/master...HEAD` 那条 git 直接失败、
     * stdout 为空，于是 preflight 报「没有 changelog.d 碎片」（一条正当的假结论），
     * 而真原因是「这条比对没有事实源」。 */
    const heard: string[] = [];
    const { run } = fake({ frags: [], branchFrags: [], baseExists: false });
    const code = await main({
      root: process.cwd(),
      run,
      log: (s: string) => heard.push(s),
      probeCnb: () => true,
      args: ["--dry-run"],
    });
    const all = heard.join("\n");
    expect(code).toBe(CODE.NOT_RUN);
    expect(all).toContain("没有事实源");
    expect(all).not.toContain("单 PR 单变更那条不成立");
  });

  it("cnb 不在 ⇒ 平台那几段没有执行者 ⇒ 退 2，不是退 0", async () => {
    const { run, calls } = fake();
    expect(await main({ ...quiet, run, probeCnb: () => false, args: [] })).toBe(
      CODE.NOT_RUN,
    );
    // 本地动作照跑，但一个 cnb 平台调用都没发出去。
    expect(calls.some((c) => c.startsWith("cnb pulls"))).toBe(false);
    expect(calls.some((c) => c.startsWith("git push"))).toBe(true);
  });

  it("未知旗标 ⇒ 退 2 并停，不把它读成「没要那个动作」", async () => {
    const { run, calls } = fake();
    expect(await main({ ...quiet, run, args: ["--merg"] })).toBe(CODE.NOT_RUN);
    expect(calls).toHaveLength(0);
  });

  it("--only=poll / verdict / merge 拒绝单独跑（否则是一段没跑却退 0 的假绿灯）", async () => {
    for (const phase of ["poll", "verdict", "merge"]) {
      const { run, calls } = fake();
      expect(
        await main({ ...quiet, run, args: [`--only=${phase}`] }),
        `--only=${phase} 不该被当成「跑过了且没问题」`,
      ).toBe(CODE.NOT_RUN);
      expect(calls).toHaveLength(0);
    }
    // 反向：能单独跑的早期阶段不许被这条守卫误伤。
    const { run } = fake();
    expect(
      await main({ ...quiet, run, args: ["--only=preflight", "--dry-run"] }),
    ).toBe(CODE.GREEN);
  });

  it("提交被钩子拦下时，stderr 上的理由必须被转述出来", async () => {
    /* 这一条是本轮最重的回归。钩子把全部原因写在 **stderr**，而第一版只接 stdout ——
     * 屏幕上就只剩一句「提交被门槛拦下」而一个理由都没有。
     * 一个职责是「如实转述执行者」的工具，把执行者的话弄丢了，比没有这个工具更糟。 */
    const heard: string[] = [];
    const { run } = fake({
      dirty: ["src/a.ts"],
      commitStatus: 1,
      commitStderr: "[pre-commit] ✗ 组 C 失败（退出码 1）：tests/x.test.ts 红",
    });
    const code = await main({
      root: process.cwd(),
      run,
      log: (s: string) => heard.push(s),
      probeCnb: () => true,
      args: ["--message=x"],
    });
    const all = heard.join("\n");
    expect(code).toBe(CODE.RED);
    expect(all).toContain("组 C 失败");
    expect(all).toContain("tests/x.test.ts 红");
  });

  it("「单 PR 单变更」数的是本次带来的碎片，不是目录里躺着的全部", async () => {
    /* 第一版用 `git ls-files changelog.d` 数出了 118 份 —— 那条守卫于是恒真、
     * 等于没有，而它看起来像在判什么。现在只数本次工作树里新增/改动的。 */
    const heard: string[] = [];
    const { run } = fake({ frags: ["changelog.d/0-only-this.md"] });
    await main({
      root: process.cwd(),
      run,
      log: (s: string) => heard.push(s),
      probeCnb: () => true,
      args: ["--dry-run"],
    });
    expect(heard.join("\n")).toContain("碎片 1 份");
  });

  it("没有任何一段落下结论时不许退 0（--only=commit / push / pull-request 那一形）", async () => {
    /* 阶段 0 之外的每一段都嵌在 `want("preflight")` 里面，所以单跑这三段时
     * `codes` 是空数组，而 `combineShipCodes([])` 回 0 ⇒ 屏幕落出「全绿到终态」，
     * 实际一段都没跑。实测（拆分之前的同一入口）：
     * `node scripts/ship.mjs --only=commit --dry-run` 只打印那一句结论、退 0。 */
    for (const phase of ["commit", "push", "pull-request"]) {
      const heard: string[] = [];
      const { run, calls } = fake();
      expect(
        await main({
          root: process.cwd(),
          run,
          log: (s: string) => heard.push(s),
          probeCnb: () => true,
          args: [`--only=${phase}`],
        }),
        `--only=${phase} 一段都没跑，不该被读成「跑过了且没问题」`,
      ).toBe(CODE.NOT_RUN);
      /* 而且真的没伸手改世界：这三段各自的写动作一条都不该出现。 */
      expect(
        calls.filter((c) =>
          ["git commit", "git push", "cnb pulls post-pull"].some((w) =>
            c.startsWith(w),
          ),
        ),
        `--only=${phase} 伸出了写动作`,
      ).toEqual([]);
      expect(heard.join("\n")).toContain("没有任何一段落下结论");
    }
    /* 反向：正常跑完阶段 0 的那几条不许被这条守卫误伤。 */
    const { run } = fake();
    expect(
      await main({ ...quiet, run, args: ["--only=preflight", "--dry-run"] }),
    ).toBe(CODE.GREEN);
  });

  it("同一条分支上第二次跑（碎片已提交、工作树干净）不许被那条守卫拒掉", async () => {
    /* 这是把上一条从「恒真」改成「只看工作树」之后**新引入**的失效：
     * 第一次跑提交了碎片 ⇒ 工作树干净 ⇒ 只看工作树就恒假 ⇒
     * `pnpm ship --merge` 在 preflight 被拒（实测：exit 1「没有 changelog.d 碎片」）。
     * 正确的面是「分支相对上游已提交的 ∪ 还没提交的」，所以这一格必须读到 1 份。 */
    const heard: string[] = [];
    const { run } = fake({
      frags: [],
      branchFrags: ["changelog.d/0-already-committed.md"],
    });
    const code = await main({
      root: process.cwd(),
      run,
      log: (s: string) => heard.push(s),
      probeCnb: () => true,
      args: ["--dry-run"],
    });
    const all = heard.join("\n");
    expect(all).toContain("碎片 1 份");
    expect(all).not.toContain("没有 changelog.d/ 碎片");
    expect(code).toBe(CODE.GREEN);
  });

  it("上游就是这条分支自己的远端副本时，基线要退回主干而不是拿自己比自己", async () => {
    /* 现场（实测撞在 `pnpm ship --no-wait` 上）：`git push -u origin feat/x` 之后，
     * `@{u}` 变成 `origin/feat/x` —— 那是**这条分支自己**在远端的副本，不是主干。
     * 而 `resolveUpstream` 那一档①「有上游就用上游」不区分这两件事，于是
     * `git diff --name-only origin/feat/x...HEAD` 拿到**恒空**（自己与自己比），
     * 碎片那一查报 0 份 ⇒ 「单 PR 单变更不成立」⇒ 每次推送之后重新跑都会被拒，
     * 且理由听起来完全正当。上一那条用例只覆盖了「上游是主干」的形状，
     * 所以这一格当时没有被抓到。 */
    const heard: string[] = [];
    const { run } = fake({
      frags: [],
      branchFrags: ["changelog.d/0-already-committed.md"],
      upstream: "cnb/feat/x",
    });
    const code = await main({
      root: process.cwd(),
      run,
      log: (s: string) => heard.push(s),
      probeCnb: () => true,
      args: ["--dry-run"],
    });
    const all = heard.join("\n");
    expect(all, `基线取成了分支自己的副本 ⇒ ${all.split("\n")[0]}`).toContain(
      "基线 cnb/master",
    );
    expect(all).toContain("碎片 1 份");
    expect(code).toBe(CODE.GREEN);
  });

  it("远端没有 HEAD 符号引用时，退回 <远端>/master 并读得出是推的", async () => {
    const heard: string[] = [];
    const { run } = fake({
      frags: [],
      branchFrags: ["changelog.d/0-already-committed.md"],
      upstream: "cnb/feat/x",
      remoteHead: null,
    });
    await main({
      root: process.cwd(),
      run,
      log: (s: string) => heard.push(s),
      probeCnb: () => true,
      args: ["--dry-run"],
    });
    const all = heard.join("\n");
    expect(all).toContain("基线 cnb/master");
    expect(all).toContain("碎片 1 份");
  });

  it("提交信息走 argv 直传 —— 一个临时文件都不建", async () => {
    /* 原先的形状是「写一份 `.workbuddy/ship-commit-msg-<pid>.tmp` → `git commit -F`
     * → finally 回收」。回收已经修好了（见 git 历史），但**不建文件**比建了再删强：
     * 少一处落点，就少一处会忘、少一处依赖某个工具目录存在、也少一处
     * 「提交信息原文躺在盘上」。AGENTS 硬规则 12 把 `COMMIT_EDITMSG` 落进工作区
     * 点名为「提交完忘了删」的信号，这一改是往那个方向收。
     *
     * 断言选的是「什么都没建」而不是「建了又删干净」—— 后者要靠前置断言证明
     * 文件确实建过才不是空转，而前者直接就是这个设计的承诺。 */
    const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "ship-argv-msg-"));
    try {
      const { run, calls } = fake({
        dirty: ["src/a.ts"],
        commitStatus: 1,
        commitStderr: "[pre-commit] ✗ 组 C 失败",
      });
      const code = await main({
        root: tmpRoot,
        run,
        log: () => undefined,
        probeCnb: () => true,
        args: ['--message=第一行\n\n正文带换行与 "引号" 和 `反引号`'],
      });
      expect(code).toBe(CODE.RED);
      const commitCall = calls.find((c) => c.startsWith("git commit"));
      expect(commitCall, "没调到 git commit").toBeTruthy();
      expect(commitCall).toContain("--message=");
      expect(commitCall, "-F 那一套已经撤了").not.toContain("-F");
      // 一个文件都不该建（含隐藏目录）。
      expect(readdirSync(tmpRoot), "工作区里被建了东西").toEqual([]);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("PR 正文落在 git 目录里，且用完一定被回收（含中途失败那条路径）", async () => {
    /* 提交信息已经不建文件了，PR 正文还得建（上千行会撞 Windows 32k argv 上限）。
     * 所以「finally 回收」这条保证仍要有对象 —— 不能因为少了一处就宣布不用测了。
     *
     * 选的路径仍是**会中途返回**的那条：post-pull 拿不到可解析响应 ⇒ 退 2。
     * 前置断言用「那个目录被建过」—— 否则「目录是空的」只是因为压根没写过。 */
    const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "ship-pr-body-"));
    const gitDir = path.join(tmpRoot, "gitdir", "comfy-ship-tmp");
    try {
      const { run } = fake();
      const code = await main({
        root: tmpRoot,
        run,
        log: () => undefined,
        probeCnb: () => true,
        resolveGitDir: () => path.join(tmpRoot, "gitdir"),
        args: [],
      });
      expect(code).toBe(CODE.NOT_RUN);
      expect(fs.existsSync(gitDir), "正文没写到 git 目录里").toBe(true);
      expect(readdirSync(gitDir), "临时文件没被回收").toEqual([]);
      // 工作区那一侧一个东西都不该有（落点全在 git 目录内）。
      expect(
        readdirSync(tmpRoot).filter((n) => n !== "gitdir"),
        "往工作区里写了东西",
      ).toEqual([]);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
