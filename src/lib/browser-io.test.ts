import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  copyText,
  downloadJson,
  downloadText,
  readFileAsDataUrl,
} from "./browser-io";

describe("copyText", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("Clipboard API 可用时走它，返回 true", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await expect(copyText("hello")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("Clipboard API 抛错时降级到 execCommand，并按它的返回值作答", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    const exec = vi.fn().mockReturnValue(true);
    vi.stubGlobal("document", {
      createElement: () => ({
        style: {},
        select: vi.fn(),
        setAttribute: vi.fn(),
      }),
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
      execCommand: exec,
    });
    await expect(copyText("hi")).resolves.toBe(true);
    expect(exec).toHaveBeenCalledWith("copy");
  });

  it("两条通道都不可用时返回 false（调用方据此给反馈）", async () => {
    vi.stubGlobal("navigator", {});
    await expect(copyText("x")).resolves.toBe(false);
  });

  it("兜底通道自己抛错时也返回 false，不把异常抛给调用方", async () => {
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("document", {
      createElement: () => {
        throw new Error("no dom");
      },
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
    });
    await expect(copyText("x")).resolves.toBe(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });
});

describe("downloadText / downloadJson", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function stubDom() {
    const click = vi.fn();
    const anchor = { href: "", download: "", click };
    const revoke = vi.fn();
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:mock"),
      revokeObjectURL: revoke,
    });
    vi.stubGlobal("document", {
      createElement: () => anchor,
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
    });
    return { anchor, click, revoke };
  }

  it("触发一次下载并 revoke 掉 objectURL（revoke 在 click 之后）", () => {
    const { anchor, click, revoke } = stubDom();
    downloadText("body", "a.json", "text/plain;charset=utf-8");
    expect(anchor.download).toBe("a.json");
    expect(click).toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledWith("blob:mock");
    /* revoke 必须发生在 click 之后，否则大文件会拿到失效 URL。 */
    expect(click).toHaveBeenCalledBefore(revoke);
  });

  it("downloadJson 按缩进序列化", () => {
    const spy = vi.fn();
    const { anchor } = stubDom();
    vi.stubGlobal(
      "Blob",
      class {
        constructor(parts: unknown[]) {
          spy(parts[0]);
        }
      },
    );
    downloadJson({ a: 1 }, "b.json");
    expect(spy).toHaveBeenCalledWith(JSON.stringify({ a: 1 }, null, 2));
    expect(anchor.download).toBe("b.json");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });
});

describe("readFileAsDataUrl", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("用 FileReader 把文件读成 data URL", async () => {
    class FakeFileReader {
      result = "data:image/png;base64,AAAA";
      error: unknown = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL() {
        this.onload?.();
      }
    }
    vi.stubGlobal("FileReader", FakeFileReader);
    await expect(
      readFileAsDataUrl({ name: "x.png" } as unknown as File),
    ).resolves.toBe("data:image/png;base64,AAAA");
  });

  it("无 FileReader 的环境（SSR）直接 reject，不抛未捕获", async () => {
    vi.stubGlobal("FileReader", undefined);
    await expect(
      readFileAsDataUrl({ name: "x.png" } as unknown as File),
    ).rejects.toThrow();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });
});
