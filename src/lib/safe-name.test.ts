import { describe, expect, it } from "vitest";

import { safeDisplayName, safeFileNameSegment } from "./safe-name";

describe("safeFileNameSegment", () => {
  it("保留 ASCII 字母数字 / 下划线 / 连字符 / 点", () => {
    expect(safeFileNameSegment("a-b_c.d")).toBe("a-b_c.d");
  });

  it("其它字符连成一段换成单个下划线", () => {
    expect(safeFileNameSegment("a b  c")).toBe("a_b_c");
    expect(safeFileNameSegment("a/b\\c")).toBe("a_b_c");
    expect(safeFileNameSegment("a:b*c?d")).toBe("a_b_c_d");
  });

  it("不含 CJK —— 下游（ComfyUI 子目录 / URL 路径）只认 ASCII", () => {
    /* 连续非法字符塌成一个下划线（与收口前四份实现的 `+` 一致）。 */
    expect(safeFileNameSegment("背景音乐")).toBe("_");
  });

  it("空值返回空串（由调用处决定兜底）", () => {
    expect(safeFileNameSegment("")).toBe("");
    expect(safeFileNameSegment(null)).toBe("");
    expect(safeFileNameSegment(undefined)).toBe("");
  });
});

describe("safeDisplayName", () => {
  it("在 ASCII 片段的基础上额外保留 CJK", () => {
    /* 这条差异是收口前的病灶：同一个中文名在 bgm 上传路径被保留、
     * 在工坊产出目录被替换成下划线。 */
    expect(safeDisplayName("背景音乐")).toBe("背景音乐");
    expect(safeDisplayName("bgm 背景音乐.mp3")).toBe("bgm_背景音乐.mp3");
  });

  it("非法字符仍然换成下划线", () => {
    expect(safeDisplayName("a:b|背景")).toBe("a_b_背景");
  });

  it("空值返回空串", () => {
    expect(safeDisplayName("")).toBe("");
    expect(safeDisplayName(null)).toBe("");
  });
});
