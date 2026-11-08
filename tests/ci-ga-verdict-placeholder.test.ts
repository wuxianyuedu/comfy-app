/**
 * `scripts/ci-ga-verdict-placeholder.mjs` 的判据（ISSUE #3378 骨架）。
 *
 * 只读对账入口：把 `ListPullCommitStatuses` 的应答折成「占位 / 回调 / 认不出」
 * 三堆 + 聚合读数。钉住两件：① 角色只从带标记的文字认，认不出就归 unknown，
 * 不按「有两条就是齐了」放行；② 应答的三种信封形状（数组 / data / data.statuses）
 * 都能收，收不到时是空读数而不是抛；③ 前提不全 ⇒ 2，不静默成绿。
 */
import { describe, expect, it } from "vitest";

import {
  main,
  STATUS_PREFIX,
  statusRole,
  summarizeStatuses,
} from "../scripts/ci-ga-verdict-placeholder.mjs";

const CTX = `${STATUS_PREFIX}/pipeline-1(GA 判决回调)`;

describe("角色识别：不猜", () => {
  it("带 GA_ROLE 标记才认得，其余归 unknown", () => {
    expect(statusRole({ context: CTX, description: "GA_ROLE=callback" })).toBe("callback");
    expect(statusRole({ context: CTX, description: "GA_ROLE=placeholder" })).toBe("placeholder");
    expect(statusRole({ context: CTX, description: "some build" })).toBe("unknown");
    expect(statusRole(null)).toBe("unknown");
  });
});

describe("汇总：三种信封形状 + 聚合", () => {
  it("数组 / data / data.statuses 都收得到", () => {
    const rows = [
      { context: CTX, state: "success", description: "GA_ROLE=callback" },
      { context: CTX, state: "failure", description: "GA_ROLE=placeholder" },
    ];
    for (const payload of [
      rows,
      { data: rows },
      { data: { statuses: rows } },
      { statuses: rows },
    ]) {
      const s = summarizeStatuses(payload);
      expect(s.callback).toBe(1);
      expect(s.placeholder).toBe(1);
      expect(s.rows).toHaveLength(2);
    }
  });

  it("红压 pending 压 success；别处的 context 不算进本族，但参与聚合", () => {
    const s = summarizeStatuses([
      { context: CTX, state: "pending", description: "GA_ROLE=placeholder" },
      { context: "cnb/pull_request/pipeline-1(质量门禁)", state: "error" },
    ]);
    expect(s.placeholder).toBe(1);
    expect(s.callback).toBe(0);
    expect(s.aggregate).toBe("failure");
  });

  it("认不出角色的本族项单列，不冒充占位或回调", () => {
    const s = summarizeStatuses([{ context: CTX, state: "success" }]);
    expect(s.unknown).toBe(1);
    expect(s.placeholder).toBe(0);
    expect(s.callback).toBe(0);
  });
});

describe("主流程：只读、前提不全不静默", () => {
  const collect = (into: string[]) => (line: string) => {
    into.push(line);
  };
  const fakeFetch = (status: number) => (_url: string, _init: unknown) =>
    Promise.resolve({ json: () => Promise.resolve({}), ok: false, status });

  it("dry-run 不发起请求", async () => {
    const lines: string[] = [];
    expect(
      await main({
        argv: ["--dry-run", "--pr", "3378", "--repo", "moon-read/comfy-app-t3"],
        env: { CNB_TOKEN: "t" },
        log: collect(lines),
      }),
    ).toBe(0);
    expect(lines[0]).toContain("DRY-RUN");
  });

  it("缺令牌 / 缺 PR 号 ⇒ 2", async () => {
    expect(await main({ argv: [], env: {}, log: collect([]) })).toBe(2);
  });

  it("平台非 200 ⇒ 2（没取到读数，不构成绿）", async () => {
    expect(
      await main({
        argv: ["--pr", "3378", "--repo", "moon-read/comfy-app-t3"],
        env: { CNB_TOKEN: "t" },
        fetchImpl: fakeFetch(403),
        log: collect([]),
      }),
    ).toBe(2);
  });
});
