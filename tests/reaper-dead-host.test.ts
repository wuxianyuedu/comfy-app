/**
 * #4604：宿主死亡后，host 片的 QUEUED 行要有用户可见出口，而不是挂着
 * 「⏳ 等待 ComfyUI WebSocket 连接就绪」的旧提示误导用户去重启 ComfyUI。
 *
 * 判活读数是**宿主心跳文件**（executor-host 每 5s 写一笔 `{t, bootId}`）：
 *   · 心跳新鲜 → 宿主在，排队是健康等待，不回收；
 *   · 心跳停了 / 文件缺失（boot 失败、压根没拉起）→ 代宿主落 FAILED，
 *     原因点名「执行宿主已退出」并指向宿主日志。
 * 死信 / RUNNING 对账那两条 sweeper 的判决分流不在本文件量程里
 * （见 reaper-reconcile-artifacts.test.ts）；这里钉的是第三条 sweeper。
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  configureReaper,
  reapDeadHostQueuedTasks,
  type TaskRepoForReaper,
} from "~/lib/comfyui/reaper";
import type { TaskWriteOutcome } from "~/lib/core/repository-task-impl";
import { configureRunner } from "~/lib/comfyui/runner-state";

const listStaleUnownedQueued = vi.fn(() => Promise.resolve([]));
const listStaleRunning = vi.fn(() => Promise.resolve([]));
const finalizeFailure = vi.fn(() => Promise.resolve("written" as const));
const finalizeFromReaper = vi.fn(() => Promise.resolve("written" as const));
/** 候选行形状（listStaleQueued 的返回列）；显式标注，避免 vi.fn 被推成 never[]。 */
type StaleQueuedRow = { createdAt: Date; id: string; workflowName: string };
const listStaleQueued = vi.fn<() => Promise<Array<StaleQueuedRow>>>(() => Promise.resolve([]));
const finalizeHostQueuedFailure = vi.fn<
  (taskId: string, error: string) => Promise<TaskWriteOutcome>
>(() => Promise.resolve("written"));

/* 直接按接口形状给实现（与 reaper-reconcile-artifacts.test.ts 同一夹具形态）。 */
const reaperRepo: TaskRepoForReaper = {
  listStaleUnownedQueued,
  listStaleRunning,
  listStaleQueued,
  finalizeFailure,
  finalizeHostQueuedFailure,
  finalizeFromReaper,
};

configureReaper({ owner: "inline", taskRepo: reaperRepo });
configureRunner({
  log: { warn: () => undefined },
  taskRepo: {
    appendLogs: () => Promise.resolve(undefined),
    replaceLogs: () => Promise.resolve(undefined),
    replaceRawCli: () => Promise.resolve(undefined),
    resetLogs: () => Promise.resolve(undefined),
  },
});

/** 候选行形状（listStaleQueued 的返回列）。 */
function hostQueuedRow(id: string) {
  return {
    id,
    workflowName: "wf-test",
    createdAt: new Date(Date.now() - 120_000),
  };
}

/** 心跳文件落在每条用例自己的临时目录（env 覆盖默认落点，不碰真仓库 log/）。 */
let hbDir: string;
const hbPath = (): string => path.join(hbDir, "executor-host-heartbeat.json");

const writeHeartbeat = (ageMs: number): void => {
  writeFileSync(hbPath(), JSON.stringify({ t: Date.now() - ageMs, bootId: "boot-test" }));
};

beforeEach(() => {
  hbDir = mkdtempSync(path.join(tmpdir(), "reaper-dead-host-"));
  process.env.COMFYAPP_HOST_HEARTBEAT = hbPath();
  listStaleQueued.mockClear();
  finalizeHostQueuedFailure.mockClear();
});

afterEach(() => {
  delete process.env.COMFYAPP_HOST_HEARTBEAT;
  rmSync(hbDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("reapDeadHostQueuedTasks（#4604 死宿主兜底）", () => {
  it("心跳新鲜 → 宿主在，排队行是健康等待，不回收", async () => {
    writeHeartbeat(0);
    listStaleQueued.mockReturnValue(Promise.resolve([hostQueuedRow("t-fresh")]));
    await reapDeadHostQueuedTasks();
    expect(finalizeHostQueuedFailure).not.toHaveBeenCalled();
  });

  it("心跳停止 → 代宿主落 FAILED，原因点名「执行宿主已退出」并指向宿主日志", async () => {
    writeHeartbeat(60_000);
    listStaleQueued.mockReturnValue(Promise.resolve([hostQueuedRow("t-dead")]));
    await reapDeadHostQueuedTasks();
    expect(finalizeHostQueuedFailure).toHaveBeenCalledTimes(1);
    const [taskId, reason] = finalizeHostQueuedFailure.mock.calls[0] ?? [];
    expect(taskId).toBe("t-dead");
    expect(String(reason)).toContain("执行宿主已退出");
    expect(String(reason)).toContain("executor-host.log");
  });

  it("心跳文件缺失（boot 失败 / 宿主没被拉起）= 没有活宿主，照样回收", async () => {
    expect(existsSync(hbPath())).toBe(false);
    listStaleQueued.mockReturnValue(Promise.resolve([hostQueuedRow("t-never")]));
    await reapDeadHostQueuedTasks();
    expect(finalizeHostQueuedFailure).toHaveBeenCalledTimes(1);
    expect(finalizeHostQueuedFailure.mock.calls[0]?.[0]).toBe("t-never");
  });

  it("没有候选行时整轮空转（不读心跳、不写终态）", async () => {
    listStaleQueued.mockReturnValue(Promise.resolve([]));
    await reapDeadHostQueuedTasks();
    expect(finalizeHostQueuedFailure).not.toHaveBeenCalled();
  });

  it("收口输掉（终态已被执行方落定）不抛、不误报成回收成功", async () => {
    writeHeartbeat(60_000);
    finalizeHostQueuedFailure.mockReturnValue(Promise.resolve("skipped-terminal"));
    listStaleQueued.mockReturnValue(Promise.resolve([hostQueuedRow("t-raced")]));
    await expect(reapDeadHostQueuedTasks()).resolves.toBeUndefined();
    expect(finalizeHostQueuedFailure).toHaveBeenCalledTimes(1);
  });
});

describe("心跳文件的两端同形（#4604）", () => {
  it("宿主脚本与读数模块的默认落点、env 覆盖名一致", async () => {
    const { readFileSync } = await import("node:fs");
    const host = readFileSync(path.join(process.cwd(), "scripts", "executor-host.mjs"), "utf8");
    const hbSrc = readFileSync(
      path.join(process.cwd(), "src", "lib", "comfyui", "host-heartbeat.ts"),
      "utf8",
    );
    /* 同一个相对落点（log/current/services/executor-host-heartbeat.json）
     * 与同一个 env 覆盖名——两边各写一份、靠这条对账不让它们漂。 */
    expect(host).toContain("executor-host-heartbeat.json");
    expect(hbSrc).toContain("executor-host-heartbeat.json");
    expect(host).toContain("COMFYAPP_HOST_HEARTBEAT");
    expect(hbSrc).toContain("COMFYAPP_HOST_HEARTBEAT");
    /* 读侧的默认落点真的落在那个相对形状上（cwd 锚点与宿主的 ROOT 锚点同值）。 */
    const hb = await import("~/lib/comfyui/host-heartbeat");
    expect(hb.defaultHostHeartbeatPath().replaceAll("\\", "/")).toContain(
      "log/current/services/executor-host-heartbeat.json",
    );
  });
});
