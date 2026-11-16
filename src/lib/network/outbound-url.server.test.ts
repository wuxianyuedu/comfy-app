import { describe, expect, it, vi, beforeEach } from "vitest";
import { lookup } from "node:dns/promises";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(),
}));

import {
  UnsafeOutboundUrlError,
  assertSafeOutboundUrl,
  isUnsafeOutboundUrlError,
  safeFetch,
} from "~/lib/network/outbound-url.server";

const lookupMock = vi.mocked(lookup);

beforeEach(() => {
  lookupMock.mockReset();
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dns.lookup(all) mock 返回数组
  lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as unknown as Awaited<
    ReturnType<typeof lookup>
  >);
  vi.unstubAllGlobals();
});

describe("assertSafeOutboundUrl（统一出网约束，#3904/#4052）", () => {
  it("仅允许 http/https", async () => {
    await expect(
      assertSafeOutboundUrl("file:///etc/passwd", "remote-media"),
    ).rejects.toBeInstanceOf(UnsafeOutboundUrlError);
    await expect(assertSafeOutboundUrl("ftp://example.com/a.png", "remote-media")).rejects.toThrow(
      /http\/https/,
    );
    await expect(assertSafeOutboundUrl("gopher://x/1", "llm-upstream")).rejects.toThrow(
      /http\/https/,
    );
  });

  it("格式非法/缺主机名/含内嵌凭据时拒绝", async () => {
    await expect(assertSafeOutboundUrl("not a url", "remote-media")).rejects.toThrow(/格式无效/);
    await expect(
      assertSafeOutboundUrl("https://user:pass@api.example.com/v1", "llm-upstream"),
    ).rejects.toThrow(/内嵌凭据/);
  });

  it("llm-upstream 允许回环与私网（本地/配置化服务），但拦链路本地与元数据", async () => {
    await expect(
      assertSafeOutboundUrl("http://127.0.0.1:11434/v1", "llm-upstream"),
    ).resolves.toContain("127.0.0.1");
    await expect(
      assertSafeOutboundUrl("http://localhost:11434/v1", "llm-upstream"),
    ).resolves.toContain("localhost");
    await expect(
      assertSafeOutboundUrl("http://10.0.0.8:8080/v1", "llm-upstream"),
    ).resolves.toContain("10.0.0.8");
    await expect(assertSafeOutboundUrl("http://192.168.1.9/v1", "llm-upstream")).resolves.toContain(
      "192.168.1.9",
    );
    await expect(assertSafeOutboundUrl("http://172.16.0.2/v1", "llm-upstream")).resolves.toContain(
      "172.16.0.2",
    );

    await expect(
      assertSafeOutboundUrl("http://169.254.169.254/latest/meta-data/", "llm-upstream"),
    ).rejects.toThrow(/链路本地|元数据/);
    await expect(assertSafeOutboundUrl("http://169.254.10.20/x", "llm-upstream")).rejects.toThrow(
      /链路本地|元数据/,
    );
    await expect(
      assertSafeOutboundUrl("http://metadata.google.internal/", "llm-upstream"),
    ).rejects.toThrow(/元数据|内部/);
  });

  it("remote-media 拦截回环、私网、链路本地与元数据目标", async () => {
    const blocked = [
      "http://127.0.0.1/a.png",
      "http://localhost/a.png",
      "http://10.1.2.3/a.png",
      "http://192.168.0.2/a.png",
      "http://172.20.1.1/a.png",
      "http://169.254.169.254/latest/meta-data/",
      "http://100.64.0.1/a.png",
      "http://0.0.0.0/a.png",
      "http://[::1]/a.png",
    ];
    for (const url of blocked) {
      // oxlint-disable-next-line no-await-in-loop -- 逐条给出失败样本
      await expect(assertSafeOutboundUrl(url, "remote-media")).rejects.toBeInstanceOf(
        UnsafeOutboundUrlError,
      );
    }
  });

  it("remote-media 允许解析到公网地址的域名", async () => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dns.lookup(all) mock 返回数组
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as unknown as Awaited<
      ReturnType<typeof lookup>
    >);
    await expect(
      assertSafeOutboundUrl("https://cdn.example.com/img.png", "remote-media"),
    ).resolves.toContain("cdn.example.com");
  });

  it("域名解析到私网/链路本地地址时按场景拒绝", async () => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dns.lookup(all) mock 返回数组
    lookupMock.mockResolvedValue([{ address: "192.168.1.5", family: 4 }] as unknown as Awaited<
      ReturnType<typeof lookup>
    >);
    await expect(
      assertSafeOutboundUrl("https://img.example.com/a.png", "remote-media"),
    ).rejects.toThrow(/内网|私有/);

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dns.lookup(all) mock 返回数组
    lookupMock.mockResolvedValue([{ address: "169.254.169.254", family: 4 }] as unknown as Awaited<
      ReturnType<typeof lookup>
    >);
    await expect(
      assertSafeOutboundUrl("https://api.example.com/v1", "llm-upstream"),
    ).rejects.toThrow(/链路本地|元数据/);
  });

  it("DNS 解析失败不按 SSRF 拒绝（交给实际连接报错）", async () => {
    lookupMock.mockRejectedValue(new Error("ENOTFOUND"));
    await expect(
      assertSafeOutboundUrl("https://no-such-host.invalid/v1", "llm-upstream"),
    ).resolves.toContain("no-such-host.invalid");
  });

  it("isUnsafeOutboundUrlError 只认约束错误", () => {
    expect(isUnsafeOutboundUrlError(new UnsafeOutboundUrlError("x"))).toBe(true);
    expect(isUnsafeOutboundUrlError(new Error("x"))).toBe(false);
    expect(isUnsafeOutboundUrlError("x")).toBe(false);
  });
});

describe("safeFetch（逐跳校验重定向，#3904/#4052）", () => {
  it("跟随到合法目标的重定向", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: "https://b.example.com/final" } }),
      )
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await safeFetch("https://a.example.com/start", { scenario: "remote-media" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("重定向到内网/元数据目标时拦截", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data/" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      safeFetch("https://a.example.com/start", { scenario: "remote-media" }),
    ).rejects.toBeInstanceOf(UnsafeOutboundUrlError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("重定向次数超限时拒绝", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(null, { status: 302, headers: { location: "https://a.example.com/next" } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      safeFetch("https://a.example.com/start", { scenario: "llm-upstream", maxRedirects: 2 }),
    ).rejects.toThrow(/重定向次数/);
  });
});
