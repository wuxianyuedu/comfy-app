/**
 * 「读用户选的文件」的口径（规范 16 §16.2.4.27）。
 *
 * 这条账的形状与 `display-value` / `list-filter` 同族：**不是重复代码，是判据**
 * —— `file.text()` 与手搓 `FileReader` 都编译、都运行，差别只在
 * **「读到空内容算不算失败」** 这一个语义决定上。
 *
 * 所以用例重点不是「怎么读」，而是这四件事各自站哪一边：
 *   1. 正常读到内容 → 原样返回；
 *   2. **读失败 → 抛出**（不返回空串 —— 那会让「读坏了」看起来像「文件是空的」）；
 *   3. **data URL 读到空 → 抛出**（data URL 不可能为空串，空值只可能是失败）；
 *   4. `file.text()` 通道拒绝时把原因带出来（不在出口里吞掉）。
 */
import { describe, expect, it, vi } from "vitest";

import { readFileAsDataUrl, readFileAsText } from "./file-io";

/** 造一个只有 `.text()` 的假 File（走第一条通道）。 */
function textFile(content: string): File {
  return { text: () => Promise.resolve(content) } as unknown as File;
}

describe("readFileAsText", () => {
  it("正常读到内容时原样返回（含空串 —— 那是真实内容）", async () => {
    expect(await readFileAsText(textFile("hello"))).toBe("hello");
    /* 空文件是**真实内容**，不是失败：抛不抛的判据留给调用处。 */
    expect(await readFileAsText(textFile(""))).toBe("");
  });

  it("读失败时抛出，不静默返回空串", async () => {
    const file = {
      text: () => Promise.reject(new Error("权限被拒")),
    } as unknown as File;
    await expect(readFileAsText(file)).rejects.toThrow("权限被拒");
  });

  it("宿主没有 file.text() 时退回 FileReader 通道", async () => {
    const original = globalThis.FileReader;
    class FakeReader {
      result: string | ArrayBuffer | null = null;
      error: DOMException | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsText() {
        this.result = "来自 reader";
        this.onload?.();
      }
    }
    globalThis.FileReader = FakeReader as unknown as typeof FileReader;
    try {
      const file = {} as unknown as File;
      await expect(readFileAsText(file)).resolves.toBe("来自 reader");
    } finally {
      globalThis.FileReader = original;
    }
  });

  it("FileReader 读到空结果时算失败（不是「空文件」）", async () => {
    const original = globalThis.FileReader;
    class FakeReader {
      result = null as string | ArrayBuffer | null;
      error: DOMException | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsText() {
        this.onload?.();
      }
    }
    globalThis.FileReader = FakeReader as unknown as typeof FileReader;
    try {
      await expect(readFileAsText({} as File)).rejects.toThrow("读取文件失败");
    } finally {
      globalThis.FileReader = original;
    }
  });
});

describe("readFileAsDataUrl", () => {
  it("正常读到 data URL 时原样返回", async () => {
    const original = globalThis.FileReader;
    class FakeReader {
      result: string | ArrayBuffer | null = "data:image/png;base64,AAA";
      error: DOMException | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL() {
        this.onload?.();
      }
    }
    globalThis.FileReader = FakeReader as unknown as typeof FileReader;
    try {
      await expect(readFileAsDataUrl({} as File)).resolves.toBe(
        "data:image/png;base64,AAA",
      );
    } finally {
      globalThis.FileReader = original;
    }
  });

  it("读到空值算失败并抛出（此前一处把空串当图片地址往下传）", async () => {
    const original = globalThis.FileReader;
    class FakeReader {
      result: string | null = "";
      error: DOMException | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL() {
        this.onload?.();
      }
    }
    globalThis.FileReader = FakeReader as unknown as typeof FileReader;
    try {
      await expect(readFileAsDataUrl({} as File)).rejects.toThrow(
        "读取本地图片失败",
      );
    } finally {
      globalThis.FileReader = original;
    }
  });

  it("readAsText 通道的 reader.onerror 也抛出可展示的中文文案", async () => {
    const original = globalThis.FileReader;
    class FakeReader {
      result: string | null = null;
      error: DOMException | null = new DOMException("boom");
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsText() {
        this.onerror?.();
      }
    }
    globalThis.FileReader = FakeReader as unknown as typeof FileReader;
    try {
      await expect(readFileAsText({} as File)).rejects.toThrow("读取文件失败");
    } finally {
      globalThis.FileReader = original;
    }
  });

  it("reader.onerror 抛出可展示的中文文案", async () => {
    const original = globalThis.FileReader;
    class FakeReader {
      result: string | null = null;
      error: DOMException | null = new DOMException("boom");
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL() {
        this.onerror?.();
      }
    }
    globalThis.FileReader = FakeReader as unknown as typeof FileReader;
    try {
      await expect(readFileAsDataUrl({} as File)).rejects.toThrow(
        "读取本地图片失败",
      );
    } finally {
      globalThis.FileReader = original;
    }
  });
});

describe("两条通道的次序", () => {
  it("有 file.text() 就不碰 FileReader（避免双通道各读一次）", async () => {
    const spy = vi.fn(() => Promise.resolve("x"));
    const file = { text: spy } as unknown as File;
    await readFileAsText(file);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
