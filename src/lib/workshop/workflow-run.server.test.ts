/**
 * `workflow-run.server`（工作流库工作流的服务端执行入口）的判决面测试。
 *
 * 这条路径是**成片工作室 / 首帧合成**唯一的本地执行入口（内置模板已移除），
 * 出错的表现是「任务建了但跑不出图」或「参数没落到端口上」——都属于用户只能
 * 看到一句「失败」的那类。这里锁三件事：
 *   ① 工作流不存在 / 不属于该用户 → 直接抛错（不许静默建一个空任务）；
 *   ② rawJson 有 / 无 → 建行与踢领取的两种结果（有载荷才提交、没载荷先报错）；
 *   ③ 对外封装的三元组真的按 nodeId + name 落到图上（数值回写不丢类型）。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const { kickMock, taskRepo } = vi.hoisted(() => ({
  kickMock: vi.fn<(job: unknown) => void>(() => undefined),
  taskRepo: {
    createQueued: vi.fn(async (_input: unknown) => ({ id: "task-1" })),
  },
}));

vi.mock("~/server/db", async () => {
  const { createTestDb } = await import("../../../tests/helpers/test-db");
  return { db: createTestDb() };
});
vi.mock("~/lib/comfyui/executor-continuation", () => ({
  kickQueue: kickMock,
}));
/* `repository` 是 server-only 的 Drizzle 实现（import 即读库），本用例只想验
 * 编排判决，故两个仓储整体换桩（与 server/film/orchestrator.test.ts 同一口径）。 */
vi.mock("~/lib/core/repository", () => ({
  taskRepository: taskRepo,
  workflowTemplateRepository: wfRepoStub,
}));

const wfRepoStub = vi.hoisted(() => ({
  findByIdForUser: vi.fn(),
}));

import { createWorkflowRunTask } from "./workflow-run.server";

beforeEach(() => {
  vi.clearAllMocks();
});

const IO = {
  "1::widget::prompt": {
    defaultValue: "",
    direction: "input",
    kind: "widget",
    name: "prompt",
    nodeId: "1",
    type: "STRING",
  },
  "2::widget::steps": {
    defaultValue: 20,
    direction: "input",
    kind: "widget",
    name: "steps",
    nodeId: "2",
    type: "INT",
  },
};

describe("createWorkflowRunTask", () => {
  it("工作流不存在 → 抛错且不建任务", async () => {
    wfRepoStub.findByIdForUser.mockResolvedValue(null);
    await expect(
      createWorkflowRunTask({
        userId: "u1",
        values: { prompt: "hi" },
        workflowId: "nope",
      }),
    ).rejects.toThrow("工作流不存在");
    expect(taskRepo.createQueued).not.toHaveBeenCalled();
    expect(kickMock).not.toHaveBeenCalled();
  });

  it("rawJson 工作流 → 建行带 execPayload + workflowInputs，随后踢一次领取", async () => {
    wfRepoStub.findByIdForUser.mockResolvedValue({
      defaultMode: null,
      id: "wf-1",
      modes: "[]",
      name: "库生图",
      rawJson: { nodes: [{ id: "1", type: "KSampler" }] },
      taskType: "T2I",
      workflowIO: IO,
      /* 落点只认作者连的线：提示词口连到该端口。 */
      paramMap: { source: { "mode:T2I": { prompt: "1::widget::prompt" } } },
    });
    const res = await createWorkflowRunTask({
      userId: "u1",
      values: { prompt: "一只猫" },
      workflowId: "wf-1",
    });
    expect(res).toEqual({
      taskId: "task-1",
      taskType: "T2I",
      workflowName: "库生图",
    });
    const created = /* SAFETY: 类型断言已复核 */ taskRepo.createQueued.mock.calls[0]![0] as {
      params: {
        workflowInputs?: Array<{ name: string; nodeId: string; value: unknown }>;
      };
      prompt: string;
      workflowName: string;
    };
    expect(created.prompt).toBe("一只猫");
    expect(created.workflowName).toBe("库生图");
    expect(created.params.workflowInputs).toContainEqual({
      name: "prompt",
      nodeId: "1",
      value: "一只猫",
    });
    // 载荷只随行走（§14 D1 第二刀：派发是库里的一次 pull，不再有内存 Job）
    const createdFull = /* SAFETY: 类型断言已复核 */ taskRepo.createQueued.mock.calls[0]![0] as {
      claimedBy?: string;
      execPayload?: unknown;
    };
    expect(createdFull.execPayload).toBeDefined();
    expect(createdFull.claimedBy).toBe("inline");
    expect(kickMock).toHaveBeenCalledTimes(1);
  });

  it("无 rawJson → 抛「没有可执行内容」，不建任务也不踢领取", async () => {
    wfRepoStub.findByIdForUser.mockResolvedValue({
      defaultMode: null,
      id: "wf-2",
      modes: "[]",
      name: "空工作流",
      paramMap: { source: { "mode:T2I": { prompt: "1::widget::prompt" } } },
      rawJson: null,
      taskType: "T2I",
      workflowIO: IO,
    });
    await expect(
      createWorkflowRunTask({
        userId: "u1",
        values: { prompt: "新提示词" },
        workflowId: "wf-2",
      }),
    ).rejects.toThrow("工作流没有可执行内容");
    expect(kickMock).not.toHaveBeenCalled();
  });
});
