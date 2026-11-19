/** `listSessions` 的摘要投影判据（#4421）：列表只要摘要（长度/计数），内容 JSON
 *  列不再整批拉回内存后丢弃——会话表没有清理路径、只增不减，列表随历史长度
 *  线性变慢。行为用例走内存 SQLite + 真 Drizzle（与 production-bridge.test.ts
 *  同一夹具形态），断言投影结果与旧「全列读 + summarize」口径一致。 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", async () => {
  const { createTestDb } = await import("../../../tests/helpers/test-db");
  return { workshopDb: createTestDb() };
});

import { getTestDb } from "../../../tests/helpers/test-db";
import { workshopSession } from "../db/schema";
import { workshopDb } from "./db";
import { listSessions } from "./repository";

const tdb = getTestDb();

beforeEach(() => {
  tdb.$reset();
});

describe("listSessions 的摘要投影（#4421）", () => {
  it("长度/计数来自内容列但不装载内容本体；按 updatedAt 降序", async () => {
    await workshopDb.insert(workshopSession).values({
      id: "s1",
      title: "甲",
      idea: "abcd",
      scriptMarkdown: "# 剧本\n第二行",
      scenes: [{ id: "sc1" }, { id: "sc2" }],
      characters: [],
      shots: [{ id: "sh1" }],
      stage: "script",
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-02"),
    });
    await workshopDb.insert(workshopSession).values({
      id: "s2",
      title: "乙",
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-03"),
    });

    const rows = await listSessions();
    expect(rows.map((r) => r.id)).toEqual(["s2", "s1"]);

    const s1 = rows.find((r) => r.id === "s1");
    expect(s1).toMatchObject({
      title: "甲",
      ideaLength: 4,
      scriptLength: "# 剧本\n第二行".length,
      sceneCount: 2,
      characterCount: 0,
      shotCount: 1,
      stage: "script",
    });
    /* 空内容行的计数落 0（json_array_length 的 NULL/空数组都归零）。 */
    const s2 = rows.find((r) => r.id === "s2");
    expect(s2).toMatchObject({
      ideaLength: 0,
      scriptLength: 0,
      sceneCount: 0,
      characterCount: 0,
      shotCount: 0,
    });
  });
});
