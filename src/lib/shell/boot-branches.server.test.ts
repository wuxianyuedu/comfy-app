// 后台启动分支记账的契约（ISSUE #4257）。
//
// 落盘写在 run/（gitignore 的运行期目录）里，用例跑完即删；
// persist 直接 await（生产里是 fire-and-forget，测试要确定性就显式等）。

import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  bootBranchOutcomes,
  failedFunctionalBootBranches,
  persistBootBranches,
  readPersistedBootBranches,
  recordBootBranch,
} from "./boot-branches.server";

const persistedFile = path.join(process.cwd(), "run", "boot-branches.json");

afterEach(() => {
  fs.rmSync(persistedFile, { force: true });
});

describe("recordBootBranch / bootBranchOutcomes（ISSUE #4257）", () => {
  it("记账进注册表，重复记同名分支覆盖", () => {
    recordBootBranch("dispatch", false, "派发挂了");
    recordBootBranch("dispatch", true, "启动成功");
    const outcomes = bootBranchOutcomes().filter((o) => o.name === "dispatch");
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.ok).toBe(true);
  });
});

describe("failedFunctionalBootBranches —— 只报影响功能的失败（ISSUE #4257）", () => {
  it("观测类分支（event-loop-watch / sentry）的失败不进提示", () => {
    recordBootBranch("dispatch", false, "派发挂了");
    recordBootBranch("event-loop-watch", false, "观测挂了");
    const failed = failedFunctionalBootBranches().map((o) => o.name);
    expect(failed).toContain("dispatch");
    expect(failed).not.toContain("event-loop-watch");
  });
});

describe("落盘与读回（run/boot-branches.json）", () => {
  it("记账后可从盘上读回（消息中心与路由的数据源）", async () => {
    recordBootBranch("film-resume-persist", false, "恢复失败");
    /* 直接等落盘（生产里是 fire-and-forget；测试要确定性就显式等）。 */
    await persistBootBranches();
    const outcomes = await readPersistedBootBranches();
    expect(outcomes.some((o) => o.name === "film-resume-persist" && !o.ok)).toBe(true);
  });
});
