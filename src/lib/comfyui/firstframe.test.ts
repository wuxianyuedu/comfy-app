/**
 * `firstframe.ts` 的「等首帧出图」改读 DB（P3 §5 ADR §14 D1 摘掉的第一个进程内依赖）。
 *
 * 钉住的是**跨宿主可见性**这一条：这一跳跑的是本机 ComfyUI，但执行它的可能是
 * `scripts/executor-host.mjs`，进程内 EventEmitter 在两个进程之间不可能相通。
 * 旧写法（订阅 `done` / `error` 帧）在 `COMFY_EXECUTOR=host` 下的现场是
 * 「文生视频」的第一头就挂满 5 分钟超时然后整条失败——而日志里一句解释都没有。
 *
 * 现在唯一的依据是库里那一行：终态 + `resultImages` + `error`，与
 * `/api/tasks/[id]/stream` 的轮询同源。
 */
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ProgressRow = {
  status: string;
  progress: number;
  resultImages: unknown;
  error: string | null;
} | null;

/* 每轮轮询读到的行：用例按序喂值，`findExecutionProgress` 每次调用消费一条；
 * 队列空时回一条 RUNNING，让「继续等」这条分支也可断言。桩件收在 hoisted 句柄
 * 上，断言直接对着句柄写——从模块对象上取方法会踩 `unbound-method` 判据。 */
const mocks = vi.hoisted(() => {
  const rows: unknown[] = [];
  return {
    rows,
    progress: vi.fn(async () => {
      const row = rows.shift();
      return row === undefined
        ? { status: "RUNNING", progress: 0, resultImages: null, error: null }
        : row;
    }),
    createTask: vi.fn(async () => ({ taskId: "ff-task" })),
    upload: vi.fn(async () => ({ name: "ff_ff-task.png" })),
    readFile: vi.fn(async () => Buffer.from("png-bytes")),
  };
});

vi.mock("~/lib/core/repository-task", () => ({
  taskRepository: { findExecutionProgress: mocks.progress },
}));
vi.mock("~/lib/workshop/workflow-run.server", () => ({
  createWorkflowRunTask: mocks.createTask,
}));
vi.mock("./client", () => ({ uploadImage: mocks.upload }));
vi.mock("fs", () => ({ promises: { readFile: mocks.readFile } }));

import { generatedRoot } from "~/lib/media/output-paths";

const mod = await import("./firstframe");

const opts = {
  userId: "u1",
  workflowId: "wf1",
  prompt: "一只猫",
};

const succeeded = (localPath: string | null): ProgressRow => ({
  status: "SUCCEEDED",
  progress: 100,
  resultImages: localPath
    ? [{ localPath, mediaType: "image" }]
    : [{ localPath: "/api/generated/ff-task/vid_0.mp4", mediaType: "video" }],
  error: null,
});

beforeEach(() => {
  mocks.rows.length = 0;
  mocks.progress.mockClear();
  mocks.upload.mockClear();
  mocks.readFile.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("synthesizeFirstFrame 等的是库里那一行", () => {
  it("SUCCEEDED 带图：读本地文件、上传进 ComfyUI 的 input 目录", async () => {
    mocks.rows.push(succeeded("/api/generated/ff-task/img_0.png"));

    await expect(mod.synthesizeFirstFrame(opts)).resolves.toBe(
      "ff_ff-task.png",
    );

    expect(mocks.readFile).toHaveBeenCalledWith(
      // 精确到整条绝对路径：这一句就是在断言「地址 → 磁盘」走的是共用解析
      // （`artifactDiskPath`），而不是某个调用点自己拼的形状。根从唯一出处取，
      // 不在测试里重抄一遍落点（搬根那天它会假红）。
      path.join(generatedRoot(), "ff-task", "img_0.png"),
    );
    expect(mocks.upload).toHaveBeenCalled();
  });

  it("地址不在产物根内 → 明确失败，不去读盘也不上传", async () => {
    // 本批新加的守卫：库里那一行被写进一个非产物地址（或越界形状）时，
    // 表现必须是一句指明「哪一条」的错误，而不是 readFile 的 ENOENT 栈噪声。
    mocks.rows.push(succeeded("/api/other/ff-task/img_0.png"));

    await expect(mod.synthesizeFirstFrame(opts)).rejects.toThrow(
      "首帧的产物地址不合法",
    );
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("终态里只有视频：判「无图像输出」，不把视频当首帧上传", async () => {
    mocks.rows.push(succeeded(null));

    await expect(mod.synthesizeFirstFrame(opts)).rejects.toThrow(
      "首帧无图像输出",
    );
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("FAILED：把库里那句失败原因原样抛出去，而不是只说「失败了」", async () => {
    mocks.rows.push({
      status: "FAILED",
      progress: 0,
      resultImages: null,
      error: "CUDA out of memory",
    });

    await expect(mod.synthesizeFirstFrame(opts)).rejects.toThrow(
      "CUDA out of memory",
    );
  });

  it("CANCELLED 且库里没有原因：退化成带状态的说明，不许抛 undefined", async () => {
    mocks.rows.push({
      status: "CANCELLED",
      progress: 0,
      resultImages: null,
      error: null,
    });

    await expect(mod.synthesizeFirstFrame(opts)).rejects.toThrow(
      "首帧生成失败（CANCELLED）",
    );
  });

  it("RUNNING → SUCCEEDED：一轮没到终态就再问一次（不是订阅一次就等）", async () => {
    vi.useFakeTimers();
    mocks.rows.push(
      { status: "RUNNING", progress: 30, resultImages: null, error: null },
      succeeded("/api/generated/ff-task/img_0.png"),
    );

    const pending = mod.synthesizeFirstFrame(opts);
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(pending).resolves.toBe("ff_ff-task.png");
    expect(mocks.progress).toHaveBeenCalledTimes(2);
  });

  it("任务行消失：立刻说明原因，不把它拖成一次超时", async () => {
    mocks.rows.push(null);

    await expect(mod.synthesizeFirstFrame(opts)).rejects.toThrow(
      "首帧任务已不存在",
    );
  });
});
