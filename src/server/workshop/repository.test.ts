// ── repository 纯映射单测（不连 DB）──────────────────────────
// 通过 mock ./db 避免测试触碰真实 db.sqlite；只验证 row/state 互转与阶段校验。
import { describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ workshopDb: {} }));

import type { WorkshopSession } from "../db/schema";
import { isStage, rowToState, stateToRow } from "./repository";

describe("workshop repository 映射", () => {
  const row: WorkshopSession = {
    characters: [],
    createdAt: new Date("2026-01-01"),
    id: "s1",
    idea: "灵感",
    logline: "梗概",
    projectId: null,
    scenes: [],
    scriptMarkdown: "# 剧本",
    shots: [],
    stage: "script",
    title: "标题",
    tone: "温暖",
    type: "short_video",
    updatedAt: new Date("2026-01-02"),
    userId: null,
  };

  it("rowToState 还原元信息与大字段", () => {
    const s = rowToState(row);
    expect(s.meta.title).toBe("标题");
    expect(s.meta.type).toBe("short_video");
    expect(s.idea).toBe("灵感");
    expect(s.stage).toBe("script");
    expect(Array.isArray(s.scenes)).toBe(true);
  });

  it("stateToRow 反向映射", () => {
    const s = rowToState(row);
    const r = stateToRow(s);
    expect(r?.title).toBe("标题");
    expect(r?.idea).toBe("灵感");
    expect(r?.stage).toBe("script");
  });

  it("isStage 校验合法阶段", () => {
    expect(isStage("storyboard")).toBe(true);
    expect(isStage("final_edit")).toBe(true);
    expect(isStage("bogus")).toBe(false);
    expect(isStage(123)).toBe(false);
  });
});
