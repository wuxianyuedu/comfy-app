// ── draft-repository 纯映射单测（不连 DB）────────────────────
// 通过 mock ./db 避免触碰真实 db.sqlite；只验证 row/dto 互转与内容判定。
import { describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ workshopDb: {} }));

import type { WorkshopDraft as WorkshopDraftRow } from "../db/schema";
import { draftHasContent, parseDraftDto } from "../../lib/workshop/draft-sync-shared";
import { draftToRow, rowToDto } from "./draft-repository";

const row: WorkshopDraftRow = {
  id: "wsp_abc",
  userId: "u1",
  title: "未命名项目",
  type: "short_video",
  tone: "悬疑",
  logline: "一句话梗概",
  scriptMarkdown: "# 剧本\n场景1",
  scenes: [],
  characters: [],
  shots: [],
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-02"),
};

describe("draft-repository 映射", () => {
  it("rowToDto 还原元信息与剧本", () => {
    const dto = rowToDto(row);
    expect(dto.meta.title).toBe("未命名项目");
    expect(dto.meta.tone).toBe("悬疑");
    expect(dto.scriptMarkdown).toContain("场景1");
  });

  it("draftToRow 反向映射", () => {
    const r = draftToRow(rowToDto(row));
    expect(r?.title).toBe("未命名项目");
    expect(r?.scriptMarkdown).toContain("场景1");
    expect(r?.tone).toBe("悬疑");
  });

  it("parseDraftDto 容忍损坏字段", () => {
    const dto = parseDraftDto({ meta: { title: 123 }, scenes: "oops" });
    expect(dto.meta.title).toBe("");
    expect(dto.meta.type).toBe("short_video");
    expect(Array.isArray(dto.scenes)).toBe(true);
  });

  it("draftHasContent 判断空/非空", () => {
    expect(draftHasContent(parseDraftDto({ scriptMarkdown: "有内容" }))).toBe(true);
    expect(draftHasContent(parseDraftDto({}))).toBe(false);
  });
});
