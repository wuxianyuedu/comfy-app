import { describe, expect, it } from "vitest";
import {
  ELLIPSIS_MIDDLE,
  ellipsisMiddle,
  lastSegments,
  normalizeSlashes,
  stripPathPrefix,
  toDisplayPath,
} from "./path-display";

describe("toDisplayPath", () => {
  it("相对 base 取一截并归一分隔符", () => {
    expect(
      toDisplayPath(
        "F:\\AI\\Comfy-APP-T3\\log\\exports\\a.txt",
        "F:\\AI\\Comfy-APP-T3",
      ),
    ).toBe("log/exports/a.txt");
  });

  it("base 用正斜杠写也一样剥得掉（两侧各自归一）", () => {
    expect(toDisplayPath("F:/AI/x/log/a.txt", "F:\\AI\\x")).toBe("log/a.txt");
  });

  it("不给 base 时只归一分隔符", () => {
    expect(toDisplayPath("src\\components\\studio\\x.tsx")).toBe(
      "src/components/studio/x.tsx",
    );
  });

  it("相对不上（不同源）时原样返回，不抛也不给 ../.. 串", () => {
    expect(toDisplayPath("D:\\other\\a.txt", "F:\\AI\\x")).toBe(
      "D:/other/a.txt",
    );
  });

  it("base 末尾的多余斜杠不影响", () => {
    expect(toDisplayPath("F:/AI/x/a.txt", "F:/AI/x/")).toBe("a.txt");
  });

  it("等于 base 自身时给空串", () => {
    expect(toDisplayPath("F:/AI/x", "F:/AI/x/")).toBe("");
  });

  it('空输入给空串（null / undefined / ""）', () => {
    expect(toDisplayPath(null)).toBe("");
    expect(toDisplayPath(undefined)).toBe("");
    expect(toDisplayPath("")).toBe("");
  });

  it("剥掉前导 ./", () => {
    expect(toDisplayPath("./src/a.ts")).toBe("src/a.ts");
  });
});

describe("stripPathPrefix", () => {
  it("命中才剥", () => {
    expect(stripPathPrefix("ComfyUI-DaSiWa-Nodes", "ComfyUI-")).toBe(
      "DaSiWa-Nodes",
    );
  });

  it("未命中原样返回", () => {
    expect(stripPathPrefix("ComfyMath", "ComfyUI-")).toBe("ComfyMath");
  });

  it("空输入给空串", () => {
    expect(stripPathPrefix(null, "ComfyUI-")).toBe("");
  });
});

describe("lastSegments", () => {
  it("取末 n 段", () => {
    expect(lastSegments("a/b/c/d.ts", 2)).toBe("c/d.ts");
  });

  it("段数不足时全给", () => {
    expect(lastSegments("a/b.ts", 5)).toBe("a/b.ts");
  });

  it("n ≤ 0 给空串", () => {
    expect(lastSegments("a/b.ts", 0)).toBe("");
    expect(lastSegments("a/b.ts", -1)).toBe("");
  });

  it("归一反斜杠后按 / 连接（与收口前 slice(-2).join('/') 同形）", () => {
    expect(lastSegments("C:\\nodes\\ComfyUI-X\\pkg", 2)).toBe("ComfyUI-X/pkg");
  });

  it("忽略重复分隔符造成的空段", () => {
    expect(lastSegments("a//b///c.ts", 2)).toBe("b/c.ts");
  });

  it("空输入给空串", () => {
    expect(lastSegments("", 2)).toBe("");
  });
});

describe("ellipsisMiddle", () => {
  const longPath =
    "F:/AI/Other/Comfy-APP-T3/src/components/studio/WorkflowNode.tsx";

  it("不超长时原样返回", () => {
    expect(ellipsisMiddle("a/b.ts", 40)).toBe("a/b.ts");
  });

  it("超长时省略中段，保头也保尾", () => {
    const out = ellipsisMiddle(longPath, 40);
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out).toContain(ELLIPSIS_MIDDLE);
    expect(out.startsWith("F:/AI")).toBe(true);
    /* 尾部才是路径的语义所在 —— 文件名必须还在。 */
    expect(out.endsWith("WorkflowNode.tsx")).toBe(true);
  });

  it("返回值长度不超过上限（标记占自己的额度）", () => {
    for (const max of [10, 20, 41, 60]) {
      expect(ellipsisMiddle(longPath, max).length).toBeLessThanOrEqual(max);
    }
  });

  it("上限比标记还短时只切到上限、不留标记", () => {
    const out = ellipsisMiddle(longPath, 1);
    expect(out).toBe(longPath.slice(0, 1));
  });

  it("maxLength ≤ 0 给空串", () => {
    expect(ellipsisMiddle(longPath, 0)).toBe("");
  });

  it("null / undefined 按空串处理", () => {
    expect(ellipsisMiddle(null, 10)).toBe("");
    expect(ellipsisMiddle(undefined, 10)).toBe("");
  });
});

describe("normalizeSlashes", () => {
  it("反斜杠换正斜杠并剥前导 ./", () => {
    expect(normalizeSlashes("a\\b\\c")).toBe("a/b/c");
    expect(normalizeSlashes("./a/b")).toBe("a/b");
  });

  it("空输入给空串", () => {
    expect(normalizeSlashes(null)).toBe("");
  });
});
