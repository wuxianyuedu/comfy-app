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
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pushFreshnessLedger, readBranchLedger } from "../scripts/freshness-ledger.mjs";
import { readFreshnessLedger } from "../scripts/freshness-gate.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const E2E_REL = "scripts/.e2e-freshness.json";
const BRANCH = "ci/freshness-ledger-test";

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
function e2eTrack(
  ledger: Record<string, unknown> | null,
): { verifiedAt?: string } | undefined {
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
  // 还原工作树 E2E_REL（回到 master 那份真实账），保持测试环境干净。
  git(`checkout HEAD -- ${E2E_REL}`);
  git(`reset -q HEAD -- ${E2E_REL}`);
  process.env.FRESHNESS_LEDGER_BRANCH = BRANCH;
});

afterAll(() => {
  delete process.env.FRESHNESS_LEDGER_BRANCH;
  git(`branch -D ${BRANCH}`);
});

describe("freshness ledger 机器分支回看（#2247）", () => {
  it("readBranchLedger 能从指定 ref 读出账", () => {
    const ledger = readBranchLedger({ root: ROOT, rel: E2E_REL, branch: BRANCH });
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
