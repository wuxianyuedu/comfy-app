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
