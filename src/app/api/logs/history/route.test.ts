// `/api/logs/history` 的尾部窗口契约（ISSUE #4252）：大日志不再整文件进内存，
// 超上限只回尾部并加说明；小文件原样返回。用例直接在 log/（gitignore 的运行期
// 目录）里造临时文件，跑完即删。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

/* 路由的鉴权链会拉起 src/env.js 的启动校验（vitest 里没有完整 .env）：
 * 这里把鉴权桩成可翻面开关，env 校验一并绕开。默认放行（本用例主体断言 #4252
 * 的尾部窗口契约）；「鉴权闸返回 null ⇒ 401」由专门用例翻面验证（ISSUE #4215）。
 * ⚠️ #3827 起真实实现无会话回落演示用户、从不返回 null；401 用例测的是路由的
 * 防御分支（闸真返回 null 时必须挡在最前面、不读日志），不是「应用要求登录」。 */
process.env.SKIP_ENV_VALIDATION = "1";
let authed = true;
vi.mock("~/server/auth/request-user", () => ({
  requireRequestUser: () => (authed ? { id: "u-test" } : null),
}));

import { GET } from "./route";
import { isRecord } from "~/lib/is-record";

const name = `history-cap-test-${process.pid}.log`;
const target = path.join(process.cwd(), "log", name);

beforeEach(() => {
  authed = true;
});

afterEach(() => {
  fs.rmSync(target, { force: true });
});

async function get(): Promise<{ body: Record<string, unknown>; status: number }> {
  const res = await GET(new Request(`http://localhost/api/logs/history?file=${name}`));
  const raw: unknown = await res.json();
  if (res.status !== 200 || !isRecord(raw)) {
    throw new Error(`非预期响应：${res.status}`);
  }
  return { status: res.status, body: raw };
}

describe("GET /api/logs/history 鉴权防御分支（ISSUE #4215）", () => {
  it("鉴权闸返回 null ⇒ 401，不读日志文件", async () => {
    fs.writeFileSync(target, "secret");
    authed = false;
    const res = await GET(new Request(`http://localhost/api/logs/history?file=${name}`));
    expect(res.status).toBe(401);
    const body: unknown = await res.json();
    expect(isRecord(body)).toBe(true);
  });
});

describe("GET /api/logs/history —— 尾部窗口（ISSUE #4252）", () => {
  it("小文件原样返回，不加截断说明", async () => {
    fs.writeFileSync(target, "hello log\n第二行");
    const { body } = await get();
    expect(body.content).toBe("hello log\n第二行");
    expect(body.size).toBe("hello log\n第二行".length);
    expect(String(body.content)).not.toContain("仅显示最后");
  });

  it("超过上限只回尾部窗口，并加截断说明", async () => {
    const marker = "TAIL-MARKER-4204";
    /* 造一份 > 8MB 的日志：前段填充 + 尾部标记行。 */
    fs.writeFileSync(target, `${"填充内容。".repeat(600_000)}\n${marker}\n`);
    const { body } = await get();
    const content = String(body.content);
    expect(content.startsWith("…（日志过大，仅显示最后")).toBe(true);
    expect(content).toContain(marker);
    expect(content).not.toContain("填充内容。".repeat(3));
    expect(body.size).toBe(content.length);
  });

  it("不存在的文件仍按 400 的「invalid or missing」出口", async () => {
    const missing = `history-cap-test-missing-${process.pid}.log`;
    const res = await GET(new Request(`http://localhost/api/logs/history?file=${missing}`));
    expect(res.status).toBe(400);
  });
});

/* ── #4728：finally 里 close 的清理错误不得覆盖 read 的原始异常 ──────────────
 * read 与 close 同时失败时，路由 500 的原因必须是 read 的那个 —— 清理侧错误
 * 吞掉，否则排障时看到的根因是假的。 */
describe("GET /api/logs/history · close 清理错误不覆盖原始异常（#4728）", () => {
  it("read 抛错时 finally 的 close 再抛错也不顶掉原始原因", async () => {
    const originalError = new Error("read 失败（模拟权限被拒）");
    const closeError = new Error("close 失败（模拟句柄损坏）");
    const fakeHandle = {
      stat: vi.fn(() => Promise.resolve({ size: 100 })),
      read: vi.fn(() => Promise.reject(originalError)),
      close: vi.fn(() => Promise.reject(closeError)),
    };
    const fsp = (await import("node:fs/promises")).default;
    const openSpy = vi
      .spyOn(fsp, "open")
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- 测试桩只实现 stat/read/close 三个成员
      .mockResolvedValue(fakeHandle as unknown as Awaited<ReturnType<typeof fsp.open>>);
    try {
      const res = await GET(new Request(`http://localhost/api/logs/history?file=${name}`));
      expect(res.status).toBe(500);
      const body: unknown = await res.json();
      expect(isRecord(body) && typeof body.error === "string").toBe(true);
      const message = isRecord(body) ? String(body.error) : "";
      expect(message).toContain("read 失败");
      expect(message).not.toContain("close 失败");
    } finally {
      openSpy.mockRestore();
    }
  });
});
