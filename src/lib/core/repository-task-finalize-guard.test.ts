/**
 * `taskRepository.updateProgress` / `markRunning` 的「终态不可改写」契约
 * （ISSUE #733）。
 *
 * 为什么必须钉住：执行路径是异步的，ComfyUI 的 WS `progress` 帧 /
 * comfy-cli 回传的 `prompt_id` 与「本任务已被别的路径收口（reaper 判终态、
 * 用户取消）」会交错到达。旧实现是**无条件 UPDATE**，一条收口之后迟到的
 * 回写会把 DB 行从 SUCCEEDED / FAILED / CANCELLED **改回 RUNNING**：
 *   • `/api/tasks/[id]/stream` 的 3s「数据库实情」轮询先看到终态 → 关流；
 *     之后再看到 RUNNING，客户端已经关掉的流不会重开，卡片永远停在
 *     「生成中…」；
 *   • 终态行还带着 `finishedAt`，与 status 自相矛盾；
 *   • 执行器的 `claimFinalize` 是**进程内**锁，dev server 重启后对 DB 里
 *     已有的终态行一无所知。
 *
 * 现在的契约：只对非终态行生效，并**返回是否真的更新了**，让调用方据此
 * 判断「本任务是否已不归我」。
 *
 * 打桩方式与 `repository.test.ts` 一致：真 SQL 跑在内存 SQLite 上。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/server/db", async () => {
  const { createTestDb } = await import("../../../tests/helpers/test-db");
  return { db: createTestDb() };
});
import { taskRepository } from "~/lib/core/repository-task";
import { getTestDb, seedTask, seedUser } from "../../../tests/helpers/test-db";

const tdb = getTestDb();

beforeEach(() => {
  tdb.$reset();
  seedUser(tdb, { id: "u1", email: "u1@test.dev" });
});

function statusOf(id: string): string {
  return String(tdb.$tables.tasks.find((t) => t.id === id)!.status);
}

describe("taskRepository.updateProgress —— 只在非终态行生效", () => {
  it("RUNNING 行：写入进度并返回 true", async () => {
    seedTask(tdb, { id: "t-run", userId: "u1", status: "RUNNING" });
    await expect(taskRepository.updateProgress("t-run", 42)).resolves.toBe(
      true,
    );
    const row = tdb.$tables.tasks.find((t) => t.id === "t-run")!;
    expect(row.progress).toBe(42);
    expect(row.status).toBe("RUNNING");
  });

  it.each(["SUCCEEDED", "FAILED", "CANCELLED"])(
    "%s 行：进度回写被丢弃，状态不被改回 RUNNING",
    async (terminal) => {
      seedTask(tdb, { id: "t-done", userId: "u1", status: terminal });
      await expect(taskRepository.updateProgress("t-done", 99)).resolves.toBe(
        false,
      );
      const row = tdb.$tables.tasks.find((t) => t.id === "t-done")!;
      expect(row.status).toBe(terminal);
      expect(row.progress).not.toBe(99);
    },
  );

  it("行不存在：返回 false（不抛错，调用方按「不归我」处理）", async () => {
    await expect(taskRepository.updateProgress("nope", 10)).resolves.toBe(
      false,
    );
  });
});

describe("taskRepository.markRunning —— 只在非终态行生效", () => {
  it("QUEUED 行：写下 promptId 并标 RUNNING，返回 true", async () => {
    seedTask(tdb, { id: "t-q", userId: "u1", status: "QUEUED" });
    await expect(taskRepository.markRunning("t-q", "pid-1")).resolves.toBe(
      true,
    );
    const row = tdb.$tables.tasks.find((t) => t.id === "t-q")!;
    expect(row.status).toBe("RUNNING");
    expect(row.promptId).toBe("pid-1");
  });

  it.each(["SUCCEEDED", "FAILED", "CANCELLED"])(
    "%s 行：promptId 回传被丢弃 —— reaper 已判孤儿就不再复活它",
    async (terminal) => {
      seedTask(tdb, { id: "t-done", userId: "u1", status: terminal });
      await expect(taskRepository.markRunning("t-done", "pid-9")).resolves.toBe(
        false,
      );
      expect(statusOf("t-done")).toBe(terminal);
      expect(
        tdb.$tables.tasks.find((t) => t.id === "t-done")!.promptId,
      ).toBeFalsy();
    },
  );
});
