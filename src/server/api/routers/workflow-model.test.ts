/**
 * workflowModel.router 的闸门用例（体检清单 ⑨ 第三刀的第一半：E8 的错误码判据）。
 *
 * 这个 router 的读侧本来就是按用户过滤的（`listByUser` / `findByUserAndName`），
 * 所以这里判的重点不是「有没有归属查询」，而是**被拒时客户端拿到的是什么**：
 *   · 别人的标签 → `NOT_FOUND`（与「没有这个标签」同形，不给探测谁有什么标签用）；
 *   · 改名撞到已有名 → `CONFLICT`（这是「你的输入和现存数据冲突」，不是故障也不是不存在）；
 *   · 三种情形**必须各自一个码** —— 全塞成 500（本刀之前的样子：裸 `throw new Error`）
 *     就等于让界面只能显示「出错了」，也让「越权与不存在同形」这条口径在状态码层失去判据
 *     （两边都 500 看着一样，纯属巧合；改成任意一侧都会分叉）。
 * 另外钉住两个幂等早退（同名 rename、删不存在的标签）**不该抛错** —— 它们是
 * 「重复点击不该报错」的那一半契约，被「顺手加个校验」改成抛错就是体验回归。
 *
 * 仓储层的幂等（`upsertByName` 两次同一行）由 `repository.test.ts` 判着，这里不重抄；
 * 这一层只判路由：码、上下文（`ctx.user.id` 传对了没有）、以及不动别人的行。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/server/db", async () => {
  const { createTestDb } = await import("../../../../tests/helpers/test-db");
  return { db: createTestDb() };
});
vi.mock("~/server/better-auth", () => ({
  auth: { api: { getSession: vi.fn(async () => null) } },
}));
vi.mock("~/lib/core/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { workflowModelTagRepository } from "~/lib/core/repository";
import { workflowModelRouter } from "~/server/api/routers/workflow-model";
import {
  getTestDb,
  seedUser,
  type TestDb,
} from "../../../../tests/helpers/test-db";
import { makeCtx, makeUser } from "../../../../tests/helpers/trpc";

const createCaller = createCallerFactory(workflowModelRouter);
const tdb: TestDb = getTestDb();
const asA = () => createCaller(makeCtx());
const asB = () => createCaller(makeCtx({ user: makeUser({ id: "user-b" }) }));

async function envelope(p: Promise<unknown>): Promise<string> {
  return p.then(
    () => "OK",
    (e: { code?: string }) => e?.code ?? "UNKNOWN",
  );
}

beforeEach(() => {
  tdb.$reset();
  seedUser(tdb, { id: "user-a", email: "a@test.dev" });
  seedUser(tdb, { id: "user-b", email: "b@test.dev" });
});

describe("list / create —— 按用户隔离与幂等", () => {
  it("列表只返回自己的标签", async () => {
    await workflowModelTagRepository.upsertByName("user-a", "动漫");
    await workflowModelTagRepository.upsertByName("user-b", "写实");
    const res = await asA().list();
    expect(res.tags.map((t) => t.name)).toEqual(["动漫"]);
  });

  it("同名重复创建只有一行（路由不因为幂等而报错）", async () => {
    const first = await asA().create({ name: "SDXL" });
    const second = await asA().create({ name: "SDXL" });
    expect(second.tag.id).toBe(first.tag.id);
    expect((await asA().list()).tags).toHaveLength(1);
  });

  it("名字空白或超长 → BAD_REQUEST，不落库", async () => {
    expect(await envelope(asA().create({ name: "   " }))).toBe("BAD_REQUEST");
    expect(await envelope(asA().create({ name: "x".repeat(65) }))).toBe(
      "BAD_REQUEST",
    );
    expect((await asA().list()).tags).toHaveLength(0);
  });
});

describe("rename —— 三种拒绝各一个码", () => {
  beforeEach(async () => {
    await workflowModelTagRepository.upsertByName("user-a", "古风");
    await workflowModelTagRepository.upsertByName("user-b", "赛博");
  });

  it("别人的标签 → NOT_FOUND，与「没这个标签」同形且不改别人的行", async () => {
    const foreign = await envelope(
      asA().rename({ oldName: "赛博", newName: "改掉" }),
    );
    const missing = await envelope(
      asA().rename({ oldName: "没这个名字", newName: "改掉" }),
    );
    expect(foreign).toBe("NOT_FOUND");
    // 同形：探测方分不清「别人的标签」与「不存在的标签」
    expect(missing).toBe(foreign);
    const stillThere = await workflowModelTagRepository.findByUserAndName(
      "user-b",
      "赛博",
    );
    expect(stillThere).not.toBeNull();
  });

  it("改成「别人已有的名字」应当放行 —— 唯一约束是 (userId, name)，不该被别人的标签挡", async () => {
    const res = await asA().rename({ oldName: "古风", newName: "赛博" });
    expect(res.renamed).toBe(true);
    expect((await asA().list()).tags.map((t) => t.name)).toEqual(["赛博"]);
    expect((await asB().list()).tags.map((t) => t.name)).toEqual(["赛博"]);
  });

  it("三种情形给出三个不同的码（界面据此才分得开「不存在 / 重名 / 成功」）", async () => {
    await asA().create({ name: "已占用" });
    const notFound = await envelope(
      asA().rename({ oldName: "没有的", newName: "X" }),
    );
    const conflict = await envelope(
      asA().rename({ oldName: "古风", newName: "已占用" }),
    );
    const ok = await envelope(
      asA().rename({ oldName: "古风", newName: "换新了" }),
    );
    expect([notFound, conflict, ok]).toEqual(["NOT_FOUND", "CONFLICT", "OK"]);
  });

  it("同名改名早退：不抛错、不查也不改", async () => {
    const res = await asA().rename({ oldName: "古风", newName: "古风" });
    expect(res).toEqual({ ok: true, renamed: false, reason: "same-name" });
  });

  it("正常改名 → renamed:true 且落库", async () => {
    const res = await asA().rename({ oldName: "古风", newName: "水墨" });
    expect(res.renamed).toBe(true);
    expect((await asA().list()).tags.map((t) => t.name)).toEqual(["水墨"]);
  });
});

describe("delete —— 幂等且不越权", () => {
  it("删别人的标签：deleted:false，别人的行还在", async () => {
    await workflowModelTagRepository.upsertByName("user-b", "赛博");
    const res = await asA().delete({ name: "赛博" });
    expect(res).toEqual({ ok: true, deleted: false });
    expect(
      await workflowModelTagRepository.findByUserAndName("user-b", "赛博"),
    ).not.toBeNull();
  });

  it("删不存在的标签同样不报错（重复点删除不该弹错误）", async () => {
    expect(await asA().delete({ name: "没有的" })).toEqual({
      ok: true,
      deleted: false,
    });
  });

  it("删自己的 → deleted:true 且行没了", async () => {
    await asA().create({ name: "临时" });
    expect((await asA().delete({ name: "临时" })).deleted).toBe(true);
    expect((await asA().list()).tags).toHaveLength(0);
  });
});
