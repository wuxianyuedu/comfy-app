// agent-film CLI 的离线单测：纯逻辑 + 轮询状态机（注入假 request，不发真网络）。
// 被测模块是 @ts-nocheck 的 .mjs，但经 JSDoc 仍带类型，故测试里对 any 参数做窄标注。
import { describe, expect, it, vi } from "vitest";

import {
  buildStartCall,
  buildStatusCall,
  DEFAULT_URL,
  driveFilmRun,
  formatStep,
  parseArgs,
  parseSuperjsonEnvelope,
  validateArgs,
} from "../scripts/agent-film.mjs";

const noopSleep = async () => undefined;

describe("parseArgs", () => {
  it("默认值：approval=auto、url 兜底、dry-run=false", () => {
    const o = parseArgs([]);
    expect(o.approval).toBe("auto");
    expect(o.url).toBe(DEFAULT_URL);
    expect(o.dryRun).toBe(false);
  });
  it("非法 approval 回落 auto；正常值透传", () => {
    expect(parseArgs(["--approval", "乱"]).approval).toBe("auto");
    expect(parseArgs(["--approval", "stage"]).approval).toBe("stage");
  });
  it("flags 解析", () => {
    const o = parseArgs([
      "--project",
      "p",
      "--idea",
      "i",
      "--dry-run",
      "--json",
    ]);
    expect(o.project).toBe("p");
    expect(o.idea).toBe("i");
    expect(o.dryRun).toBe(true);
    expect(o.json).toBe(true);
  });
});

describe("validateArgs", () => {
  it("缺 project/idea → 两条错误；齐全 → 空", () => {
    expect(
      validateArgs({ ...parseArgs([]), project: "", idea: "" }),
    ).toHaveLength(2);
    expect(validateArgs({ ...parseArgs([]), project: "p", idea: "i" })).toEqual(
      [],
    );
  });
});

describe("build*Call（superjson 编码）", () => {
  it("start body = {json:{...}}，仅在有工作流时带对应键", () => {
    const onlyBase = buildStartCall(
      parseArgs(["--project", "proj_1", "--idea", "x"]),
    );
    expect(onlyBase.method).toBe("POST");
    expect(onlyBase.url).toBe(`${DEFAULT_URL}/api/trpc/run.start`);
    expect(onlyBase.body).toEqual({
      json: { projectId: "proj_1", goal: "x", approvalMode: "auto" },
    });
    const withWf = buildStartCall(
      parseArgs([
        "--project",
        "proj_1",
        "--idea",
        "x",
        "--image-workflow",
        "img",
        "--video-workflow",
        "vid",
      ]),
    );
    expect(withWf.body!.json).toMatchObject({
      imageWorkflowId: "img",
      videoWorkflowId: "vid",
    });
  });
  it("status 走 GET，input 为 encodeURIComponent({json:{projectId}})", () => {
    const c = buildStatusCall(parseArgs(["--project", "proj_9"]));
    expect(c.method).toBe("GET");
    expect(c.url).toContain("/api/trpc/run.status?input=");
    expect(decodeURIComponent(c.url.split("input=")[1]!)).toBe(
      JSON.stringify({ json: { projectId: "proj_9" } }),
    );
  });
});

describe("parseSuperjsonEnvelope / formatStep", () => {
  it("解 .result.data.json；无信封原样返回", () => {
    expect(
      parseSuperjsonEnvelope({ result: { data: { json: { a: 1 } } } }),
    ).toEqual({ a: 1 });
    expect(parseSuperjsonEnvelope({ run: { status: "idle" } })).toEqual({
      run: { status: "idle" },
    });
  });
  it("render_images 步显示镜头数", () => {
    expect(
      formatStep({
        run: { status: "running" },
        action: { kind: "render_images", shotIds: ["a", "b"] },
      }),
    ).toContain("逐镜生图(2)");
  });
});

describe("driveFilmRun（假 request 驱动轮询状态机）", () => {
  const snap = (status: string, action: unknown = { kind: "idle" }) => ({
    run: { status },
    action,
  });
  const envelope = (s: unknown) => ({ result: { data: { json: s } } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const opts = (over: Record<string, any>) => ({ ...parseArgs([]), ...over });

  it("start=running → 轮询到 done 停", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        envelope(snap("running", { kind: "generate_script" })),
      )
      .mockResolvedValue(envelope(snap("done", { kind: "done" })));
    const { snapshot, timedOut, polls } = await driveFilmRun(
      opts({ project: "p", idea: "i", pollMs: 1, timeoutMs: 1000 }),
      { request, doSleep: noopSleep },
    );
    expect(snapshot.run?.status).toBe("done");
    expect(timedOut).toBe(false);
    expect(polls).toBeGreaterThanOrEqual(1);
  });

  it("start 直接落 failed → 不轮询", async () => {
    const request = vi.fn().mockResolvedValue(envelope(snap("failed")));
    const { snapshot, polls } = await driveFilmRun(
      opts({ project: "p", idea: "i", pollMs: 1, timeoutMs: 1000 }),
      { request, doSleep: noopSleep },
    );
    expect(snapshot.run?.status).toBe("failed");
    expect(polls).toBe(0);
  });

  it("一直 running 且超时 → timedOut", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(
        envelope(snap("running", { kind: "generate_script" })),
      );
    const { timedOut } = await driveFilmRun(
      opts({ project: "p", idea: "i", pollMs: 1, timeoutMs: 0 }),
      { request, doSleep: noopSleep },
    );
    expect(timedOut).toBe(true);
    expect(request.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});
