/**
 * draft-repository 归属过滤的集成测试（ISSUE #4556 越权修复）。
 *
 * 走 `tests/helpers/test-db.ts` 的内存 SQLite + 真 Drizzle：归属判据全在
 * 「SQL 的 where 怎么写 + upsert 的 onConflictDoUpdate where 守卫」上，
 * mock 调用次数测不到这些。口径：本人或无主（userId 为空的历史行）可见；
 * 他人的草稿读不到、删不掉、也不被 upsert 接管归属。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", async () => {
  const { createTestDb } = await import("../../../tests/helpers/test-db");
  return { workshopDb: createTestDb() };
});

import { getTestDb } from "../../../tests/helpers/test-db";
import { workshopDraft } from "~/server/db/schema";
import { parseDraftDto } from "~/lib/workshop/draft-sync-shared";
import {
  deleteDraft,
  findDraftOwner,
  getDraft,
  listDraftsByUser,
  upsertDraft,
} from "./draft-repository";

const tdb = getTestDb();

beforeEach(() => {
  tdb.$reset();
});

/** 直接种一行草稿（绕开被测的 upsert，隔离被测行为）。 */
async function seedDraft(id: string, userId: string | null, title: string): Promise<void> {
  await tdb.insert(workshopDraft).values({
    id,
    userId,
    title,
    scriptMarkdown: `# ${title}`,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-02"),
  });
}

describe("draft-repository 归属过滤（#4556）", () => {
  it("getDraft：本人可见，他人不可见，无主行对任何用户可见", async () => {
    await seedDraft("wsp_mine", "u1", "我的草稿");
    await seedDraft("wsp_other", "u2", "别人的草稿");
    await seedDraft("wsp_legacy", null, "历史无主草稿");

    expect(await getDraft("wsp_mine", "u1")).not.toBeNull();
    expect(await getDraft("wsp_other", "u1")).toBeNull();
    expect(await getDraft("wsp_other", "u2")).not.toBeNull();
    expect(await getDraft("wsp_legacy", "u1")).not.toBeNull();
    expect(await getDraft("wsp_legacy", "u2")).not.toBeNull();
    expect(await getDraft("wsp_missing", "u1")).toBeNull();
  });

  it("deleteDraft：本人删得掉，他人删不掉（行保留），无主行删得掉", async () => {
    await seedDraft("wsp_mine", "u1", "我的草稿");
    await seedDraft("wsp_other", "u2", "别人的草稿");
    await seedDraft("wsp_legacy", null, "历史无主草稿");

    expect(await deleteDraft("wsp_other", "u1")).toBe(false);
    expect(await getDraft("wsp_other", "u2")).not.toBeNull(); // 原行还在

    expect(await deleteDraft("wsp_mine", "u1")).toBe(true);
    expect(await getDraft("wsp_mine", "u1")).toBeNull();

    expect(await deleteDraft("wsp_legacy", "u1")).toBe(true);
  });

  it("upsertDraft：不得把他人草稿的归属接管成调用方，内容也不被覆盖", async () => {
    await seedDraft("wsp_other", "u2", "别人的草稿");
    await upsertDraft("wsp_other", parseDraftDto({ meta: { title: "劫持" } }), "u1");
    const owner = await findDraftOwner("wsp_other");
    expect(owner?.userId).toBe("u2"); // 归属仍是原主
    const row = await getDraft("wsp_other", "u2");
    expect(row?.meta.title).toBe("别人的草稿"); // 内容未被调用方覆盖
  });

  it("upsertDraft：无主历史行可被写入方认领（内容更新 + 归属落到调用方）", async () => {
    await seedDraft("wsp_legacy", null, "历史无主草稿");
    await upsertDraft("wsp_legacy", parseDraftDto({ meta: { title: "认领后" } }), "u1");
    const got = await getDraft("wsp_legacy", "u1");
    expect(got?.meta.title).toBe("认领后");
    expect((await findDraftOwner("wsp_legacy"))?.userId).toBe("u1");
  });

  it("upsertDraft：本人行正常更新，归属不变", async () => {
    await seedDraft("wsp_mine", "u1", "v1");
    await upsertDraft("wsp_mine", parseDraftDto({ meta: { title: "v2" } }), "u1");
    expect((await getDraft("wsp_mine", "u1"))?.meta.title).toBe("v2");
    expect((await findDraftOwner("wsp_mine"))?.userId).toBe("u1");
  });

  it("findDraftOwner：不做归属过滤，他人草稿也读得到归属（PUT 判 404 的依据）", async () => {
    await seedDraft("wsp_other", "u2", "别人的草稿");
    const owner = await findDraftOwner("wsp_other");
    expect(owner?.userId).toBe("u2");
    expect(owner?.updatedAt.getTime()).toBe(new Date("2026-01-02").getTime());
    expect(await findDraftOwner("wsp_missing")).toBeNull();
  });

  it("listDraftsByUser：仍按 userId 过滤，不混入他人草稿", async () => {
    await seedDraft("wsp_mine", "u1", "我的草稿");
    await seedDraft("wsp_other", "u2", "别人的草稿");
    const drafts = await listDraftsByUser("u1");
    expect(drafts.map((d) => d.id)).toEqual(["wsp_mine"]);
  });
});
