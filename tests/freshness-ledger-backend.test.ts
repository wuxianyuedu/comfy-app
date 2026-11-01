/**
 * #2247 新鲜度账回写 / 机器分支回看 的判据。
 *
 * 核心口径（用户拍板）：本地与工作树账都可能是开发者「自己分支」上跑、带未合并改动的，
 * 与机器在 master / 干净态跑的不一定是同一份 —— 所以**机器账权威**：机器分支
 * `ci/freshness-ledger` 有这份账就以它为准，缺失才回退工作树。
 *
 * 这里用一个本地分支当「机器分支」替身（不真正推 origin），验证读取侧机器优先；
 * 并验证 `pushFreshnessLedger` 在没置 `FRESHNESS_LEDGER_PUSH=1` 时是 no-op（不误推）。
 *
 * 测试内的 git 操作都走 `-c core.hooksPath=/dev/null`，避免触发本仓库 pre-commit 钩子
 * （钩子里有 `scripts/**` 900 行硬闸等判据，会误拦测试的临时提交）。造分支用
 * `commit-tree` + `update-ref`，**不切换工作树**，避免把测试环境卡在分支上。
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  FRESHNESS_TRACKS,
  pushFreshnessLedger,
  readBranchLedger,
} from "../scripts/freshness-ledger.mjs";
import { readFreshnessLedger } from "../scripts/freshness-gate.mjs";
import { restoreToSnapshot, snapshotPaths } from "./helpers/probe-restore.ts";

const HERE = import.meta.dirname;
const ROOT = path.resolve(HERE, "..");
const E2E_REL = "scripts/.e2e-freshness.json";
const BRANCH = "ci/freshness-ledger-test";

/**
 * 还原的凭据 = 进本文件那一刻的字节（快照取在模块加载时，比 `beforeAll` 更早）。
 * 这一份用例要往**真实入库文件**上写一份假账，所以它欠工作树一次还原（§11.16.2）。
 */
const PRISTINE = snapshotPaths([path.join(ROOT, E2E_REL)]);

/**
 * 账里 `e2e` 那一档。
 *
 * 账的形状是 `Record<string, unknown>`（读账那层的既有契约），而这一档的形状是
 * `{ verifiedAt?: string }` —— `unknown` 上取成员过不去，此处**收窄**而不是 `as any`：
 * `as any` 让整条表达式退化成「不检查」的样子（`no-unsafe-member-access` 正是为它准备的），
 * 而这里是断言「这一档被读到了」的地方，恰恰不该不检查。
 *
 * @param ledger 读回来那份账（读不出时是 `null`）
 * @returns `e2e` 那一档；账里没有这一档时是 `undefined`
 */
function e2eTrack(ledger: Record<string, unknown> | null): { verifiedAt?: string } | undefined {
  /* SAFETY: 类型断言已复核 */
  return ledger?.e2e as { verifiedAt?: string } | undefined;
}

function git(args: string): string {
  return execSync(`git ${args}`, { cwd: ROOT, encoding: "utf8" });
}
/** 临时提交 / 树操作走这条，跳过 pre-commit 钩子（免得 900 行硬闸误拦）。 */
function gitNoHook(args: string): string {
  return execSync(`git -c core.hooksPath=/dev/null ${args}`, {
    cwd: ROOT,
    encoding: "utf8",
  });
}

beforeAll(() => {
  const machine = {
    e2e: {
      key: "e2e",
      verifiedAt: "2099-01-01T00:00:00.000Z",
      who: "machine",
      how: "pnpm test:e2e",
      trackedBy: "e2e",
    },
  };
  // 只改 E2E_REL 工作树 + 暂存，造一个「机器分支」提交，但**不切换工作树**。
  fs.writeFileSync(path.join(ROOT, E2E_REL), `${JSON.stringify(machine, null, 2)}\n`);
  gitNoHook(`add ${E2E_REL}`);
  const tree = gitNoHook(`write-tree`).trim();
  const parent = git(`rev-parse HEAD`).trim();
  const sha = gitNoHook(`commit-tree ${tree} -p ${parent} -m "test: machine ledger"`).trim();
  git(`update-ref refs/heads/${BRANCH} ${sha}`);
  /* 还原工作树里那份账 = **进本文件那一刻的字节**，不是 `git checkout HEAD -- <文件>`
   * （ISSUE #2593 / §11.16.2：那一句会把同一分支上未提交的账改动一起抹掉，
   * 而这份文件正是被本单点名修掉的第二处现场）。 */
  const { failed } = restoreToSnapshot(PRISTINE);
  expect(
    failed.map((f) => `${f.abs} → ${f.why}`),
    "探针没能把 `scripts/.e2e-freshness.json` 还原成进用例前那一版",
  ).toEqual([]);
  git(`reset -q HEAD -- ${E2E_REL}`);
  process.env.FRESHNESS_LEDGER_BRANCH = BRANCH;
});

afterAll(() => {
  delete process.env.FRESHNESS_LEDGER_BRANCH;
  git(`branch -D ${BRANCH}`);
  /* 再走一次：`beforeAll` 若在 `update-ref` 那一步之前抛了，假账就还留在工作树上。
   * 已一致时这里一次写都不做（`restoreToSnapshot` 先比字节）。 */
  restoreToSnapshot(PRISTINE);
});

describe("freshness ledger 机器分支回看（#2247）", () => {
  it("readBranchLedger 能从指定 ref 读出账", () => {
    const ledger = readBranchLedger({
      root: ROOT,
      rel: E2E_REL,
      branch: BRANCH,
    });
    expect(e2eTrack(ledger)?.verifiedAt).toBe("2099-01-01T00:00:00.000Z");
  });

  it("readFreshnessLedger 机器账权威：机器有则以机器为准（不取工作树那份）", () => {
    const ledger = readFreshnessLedger("e2e", ROOT, "master");
    expect(e2eTrack(ledger)?.verifiedAt).toBe("2099-01-01T00:00:00.000Z");
  });

  it("pushFreshnessLedger 在本地（无 CNB 平台身份）时是 no-op、绝不误推", () => {
    delete process.env.CNB_BUILD_USER_NICKNAME;
    delete process.env.CNB_COMMITTER;
    delete process.env.CNB_BUILD_USER;
    delete process.env.FRESHNESS_LEDGER_PUSH;
    const r = pushFreshnessLedger({ root: ROOT, kinds: ["e2e"] });
    expect(r.pushed).toBe(false);
    expect(r.reason).toBe("not-platform");
  });

  it("机器分支缺失时回退工作树账（本地自证仍作兜底读数）", () => {
    delete process.env.FRESHNESS_LEDGER_BRANCH;
    const ledger = readFreshnessLedger("e2e", ROOT, "master");
    expect(e2eTrack(ledger)?.verifiedAt).not.toBe("2099-01-01T00:00:00.000Z");
  });
});

/**
 * 回写**失败**那两格的形状（ISSUE #2344）。
 *
 * 这一组全部走注入的 `run`，一次 git 都不真跑 —— 要钉的是「失败之后做什么」，
 * 而那种现场在真仓库里造出来就得污染这台机器（本文件的既有用例已经证明了造出来
 * 会红：每日那一跑就是它的现场）。
 *
 * 三条钉子各挡一件事：
 *   ① `commit` 失败 ⇒ 原因里必须带 git 的原文（过去只有 `commit-failed` 那个词，
 *      「为什么失败」在日志里**不存在**，硬规则 27 那一族）；
 *   ② 同一条路径 ⇒ 必须把 `add` 撤回去，否则同一跑后面**按暂存区判**的判据读的都是
 *      这一格留下的面（账面只红一条用例，脏的是整跑的输入）；
 *   ③ 撤回本身失败也要念出来 —— 那时索引仍然是脏的，不念就等于把第二件事藏起来。
 *   ④ 反向：`push` 失败时**不许**撤回（提交已经落地、索引是干净的，撤了会把已成功的
 *      改动重新 stage 成待提交 —— 那是第二次错）。
 */
describe("账回写失败：念出原因并撤回暂存（ISSUE #2344）", () => {
  const LEDGER_ENV = {
    CNB_BUILD_USER_NICKNAME: "ci-bot",
    CNB_EVENT: "api_trigger_daily",
    COMFY_CI_SUBJECT: "master",
  };
  const KEYS = [...Object.keys(LEDGER_ENV), "FRESHNESS_LEDGER_BRANCH"];

  /** 在「平台身份 + 每日事件 + 主体 master」这套现场里跑一次。 */
  function onPlatform<T>(fn: () => T): T {
    const saved = new Map<string, string | undefined>(KEYS.map((k) => [k, process.env[k]]));
    try {
      for (const [k, v] of Object.entries(LEDGER_ENV)) {
        process.env[k] = v;
      }
      delete process.env.FRESHNESS_LEDGER_BRANCH;
      return fn();
    } finally {
      for (const [k, v] of saved) {
        if (v === undefined) {
          delete process.env[k];
        } else {
          process.env[k] = v;
        }
      }
    }
  }

  /** 记账式 git：按脚本给的回执依次返回，并把每次的参数留下来。 */
  function fakeGit(script: Array<{ status: number; stderr?: string; stdout?: string }>) {
    const calls: Array<Array<string>> = [];
    const run = (args: Array<string>) => {
      const step = script[calls.length] ?? { status: 0 };
      calls.push(args);
      return { ...step, stdout: step.stdout ?? "", stderr: step.stderr ?? "" };
    };
    return { run, calls };
  }

  /** 一份与生产同形的工作树根（`readBranchLedger` 会在这里取另外两份账，取不到就 null）。 */
  function scratchRoot() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "freshness-push-"));
  }

  const resetArgs = (calls: Array<Array<string>>) =>
    calls.find((a) => a[0] === "reset" && a[1] === "-q");

  it("commit 被拒 ⇒ 原因带 git 的 stderr 原文，并把 add 撤回", () => {
    const { run, calls } = fakeGit([
      { status: 0 }, // fetch
      { status: 0 }, // add
      {
        status: 1,
        stderr:
          "[pre-commit] ✗ 被门槛拦下：本次提交没有 changelog.d/ 碎片\n" +
          "husky - pre-commit script failed (code 1)",
      },
      { status: 0 }, // reset
    ]);
    const r = onPlatform(() => pushFreshnessLedger({ root: scratchRoot(), kinds: ["e2e"], run }));
    expect(r.pushed).toBe(false);
    expect(r.reason).toContain("commit-failed");
    /* 这一条就是验收的第二格：那一行后面要能跟着 git 给的原因，而不是只剩那个词。 */
    expect(r.reason).toContain("pre-commit script failed");
    expect(r.reason).toContain("没有 changelog.d/ 碎片");
    expect(resetArgs(calls), JSON.stringify(calls)).toBeDefined();
    /* 撤回的对象是那几份账本，不是整个索引 —— 别把别人 stage 的东西一起撤走。
     * 名单从 `FRESHNESS_TRACKS` 取（与生产同一个出处），新增一档时这条不用改。 */
    const reset = resetArgs(calls);
    expect(reset?.slice(3)).toEqual([
      ...new Set(Object.values(FRESHNESS_TRACKS).map((t) => t.ledger)),
    ]);
  });

  it("撤回也失败 ⇒ 当场念出「索引仍然是脏的」，不静默", () => {
    const { run } = fakeGit([
      { status: 0 },
      { status: 0 },
      { status: 1, stderr: "commit blocked by hook" },
      {
        status: 128,
        stderr: "fatal: Unable to create index.lock: File exists",
      },
    ]);
    const r = onPlatform(() => pushFreshnessLedger({ root: scratchRoot(), kinds: ["e2e"], run }));
    expect(r.reason).toContain("撤回暂存也失败");
    expect(r.reason).toContain("index.lock");
  });

  it("add 自己失败 ⇒ 同样带原文（这一支过去也只念一个词）", () => {
    const { run } = fakeGit([
      { status: 0 },
      {
        status: 1,
        stderr: "The following path is ignored by one of your .gitignore files",
      },
    ]);
    const r = onPlatform(() => pushFreshnessLedger({ root: scratchRoot(), kinds: ["e2e"], run }));
    expect(r.reason).toContain("add-failed");
    expect(r.reason).toContain("ignored by one of your .gitignore files");
  });

  it("push 失败 ⇒ 带原文，但**不**撤回 —— 提交已经落地，撤回是第二次错", () => {
    const { run, calls } = fakeGit([
      { status: 0 }, // fetch
      { status: 0 }, // add
      { status: 0 }, // commit
      { status: 1, stderr: "remote rejected: update-policy-hook" },
    ]);
    const r = onPlatform(() => pushFreshnessLedger({ root: scratchRoot(), kinds: ["e2e"], run }));
    expect(r.reason).toContain("push-failed");
    expect(r.reason).toContain("remote rejected");
    expect(resetArgs(calls)).toBeUndefined();
  });

  it("全绿那一跑 ⇒ 不撤回（撤回只属于失败路径）", () => {
    const { run, calls } = fakeGit([{ status: 0 }, { status: 0 }, { status: 0 }, { status: 0 }]);
    const r = onPlatform(() => pushFreshnessLedger({ root: scratchRoot(), kinds: ["e2e"], run }));
    expect(r.pushed).toBe(true);
    expect(resetArgs(calls)).toBeUndefined();
  });

  it("非平台身份那一支的 reason 逐字不变（不许被这次改动带跑）", () => {
    const saved = process.env.CNB_BUILD_USER_NICKNAME;
    delete process.env.CNB_BUILD_USER_NICKNAME;
    delete process.env.CNB_COMMITTER;
    delete process.env.CNB_BUILD_USER;
    try {
      const r = pushFreshnessLedger({ root: ROOT, kinds: ["e2e"] });
      expect(r.reason).toBe("not-platform");
    } finally {
      if (saved !== undefined) {
        process.env.CNB_BUILD_USER_NICKNAME = saved;
      }
    }
  });
});
