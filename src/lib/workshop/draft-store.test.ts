// @vitest-environment jsdom
// 工坊草稿存储层的契约（Phase 3b 抽出，3c-2b 与画布回写共用）：
// 按 proj_* 键落盘、逐字段校验、坏数据回落空草稿。
import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_META,
  emptyWorkshopDraft,
  readWorkshopDraft,
  writeWorkshopDraft,
} from "./draft-store";

const KEY = "comfyapp.workshop.draft.proj_1.v1";

beforeEach(() => {
  window.localStorage.clear();
});

describe("emptyWorkshopDraft / DEFAULT_META", () => {
  it("空草稿用 DEFAULT_META 起手，列表字段为空", () => {
    const draft = emptyWorkshopDraft();
    expect(draft.meta).toEqual(DEFAULT_META);
    expect(draft.shots).toEqual([]);
    expect(draft.scriptMarkdown).toBe("");
  });
});

describe("readWorkshopDraft / writeWorkshopDraft", () => {
  it("无存储内容 → 空草稿", () => {
    expect(readWorkshopDraft("proj_1")).toEqual(emptyWorkshopDraft());
  });

  it("写入后可按同键读回（含 shots）", () => {
    const draft = {
      ...emptyWorkshopDraft(),
      scriptMarkdown: "# 开场",
      shots: [{ id: "a", status: "done" } as never],
    };
    writeWorkshopDraft("proj_1", draft);
    expect(window.localStorage.getItem(KEY)).not.toBeNull();
    const back = readWorkshopDraft("proj_1");
    expect(back.scriptMarkdown).toBe("# 开场");
    expect(back.shots).toHaveLength(1);
  });

  it("坏 JSON → 回落空草稿，不抛", () => {
    window.localStorage.setItem(KEY, "{这不是 json");
    expect(readWorkshopDraft("proj_1")).toEqual(emptyWorkshopDraft());
  });

  it("逐字段类型校验：非数组的 shots 被纠正成空数组", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ v: 1, shots: "不是数组", scenes: null }),
    );
    const back = readWorkshopDraft("proj_1");
    expect(back.shots).toEqual([]);
    expect(back.scenes).toEqual([]);
  });
});
