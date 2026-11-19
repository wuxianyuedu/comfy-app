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

/** 造一个真实的 File（`.text()` 由 Blob 提供，走第一条通道）。 */
function textFile(content: string): File {
  return new File([content], "test.txt");
}

/** 盖掉实例上的 `text`：给函数走第一条通道，给 `undefined` 模拟没有该方法。 */
function fileWithText(text: (() => Promise<string>) | undefined): File {
  const file = new File([], "test.txt");
  Object.defineProperty(file, "text", { value: text, configurable: true });
  return file;
}

/** 全局 FileReader 的原描述符：用例换掉它之后按原样恢复（原本没有则删除）。 */
const originalFileReader = Object.getOwnPropertyDescriptor(globalThis, "FileReader");

function installFileReader(value: unknown): void {
  Object.defineProperty(globalThis, "FileReader", {
    value,
    configurable: true,
    writable: true,
  });
}

function restoreFileReader(): void {
  if (originalFileReader) {
    Object.defineProperty(globalThis, "FileReader", originalFileReader);
  } else {
    Reflect.deleteProperty(globalThis, "FileReader");
  }
}

describe("readFileAsText", () => {
  it("正常读到内容时原样返回（含空串 —— 那是真实内容）", async () => {
    expect(await readFileAsText(textFile("hello"))).toBe("hello");
    /* 空文件是**真实内容**，不是失败：抛不抛的判据留给调用处。 */
    expect(await readFileAsText(textFile(""))).toBe("");
  });

  it("读失败时抛出，不静默返回空串", async () => {
    const file = fileWithText(() => Promise.reject(new Error("权限被拒")));
    await expect(readFileAsText(file)).rejects.toThrow("权限被拒");
  });

  it("宿主没有 file.text() 时退回 FileReader 通道", async () => {
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
    installFileReader(FakeReader);
    try {
      await expect(readFileAsText(fileWithText(undefined))).resolves.toBe("来自 reader");
    } finally {
      restoreFileReader();
    }
  });

  it("FileReader 读到空结果时算失败（不是「空文件」）", async () => {
    class FakeReader {
      result: string | ArrayBuffer | null = null;
      error: DOMException | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsText() {
        this.onload?.();
      }
    }
    installFileReader(FakeReader);
    try {
      await expect(readFileAsText(fileWithText(undefined))).rejects.toThrow("读取文件失败");
    } finally {
      restoreFileReader();
    }
  });
});

describe("readFileAsDataUrl", () => {
  it("正常读到 data URL 时原样返回", async () => {
    class FakeReader {
      result: string | ArrayBuffer | null = "data:image/png;base64,AAA";
      error: DOMException | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL() {
        this.onload?.();
      }
    }
    installFileReader(FakeReader);
    try {
      await expect(readFileAsDataUrl(new File([], "test.txt"))).resolves.toBe(
        "data:image/png;base64,AAA",
      );
    } finally {
      restoreFileReader();
    }
  });

  it("读到空值算失败并抛出（此前一处把空串当图片地址往下传）", async () => {
    class FakeReader {
      result: string | null = "";
      error: DOMException | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL() {
        this.onload?.();
      }
    }
    installFileReader(FakeReader);
    try {
      await expect(readFileAsDataUrl(new File([], "test.txt"))).rejects.toThrow("读取本地图片失败");
    } finally {
      restoreFileReader();
    }
  });

  it("无 FileReader 的环境（SSR）reject 而非抛 ReferenceError", async () => {
    installFileReader(undefined);
    try {
      await expect(readFileAsDataUrl(new File([], "test.txt"))).rejects.toThrow(
        "当前环境不支持读取文件",
      );
    } finally {
      restoreFileReader();
    }
  });

  it("readAsText 通道的 reader.onerror 也抛出可展示的中文文案", async () => {
    class FakeReader {
      result: string | null = null;
      error: DOMException | null = new DOMException("boom");
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsText() {
        this.onerror?.();
      }
    }
    installFileReader(FakeReader);
    try {
      await expect(readFileAsText(fileWithText(undefined))).rejects.toThrow("读取文件失败");
    } finally {
      restoreFileReader();
    }
  });

  it("reader.onerror 抛出可展示的中文文案", async () => {
    class FakeReader {
      result: string | null = null;
      error: DOMException | null = new DOMException("boom");
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL() {
        this.onerror?.();
      }
    }
    installFileReader(FakeReader);
    try {
      await expect(readFileAsDataUrl(new File([], "test.txt"))).rejects.toThrow("读取本地图片失败");
    } finally {
      restoreFileReader();
    }
  });
});

describe("两条通道的次序", () => {
  it("有 file.text() 就不碰 FileReader（避免双通道各读一次）", async () => {
    const spy = vi.fn(() => Promise.resolve("x"));
    const file = fileWithText(spy);
    await readFileAsText(file);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
