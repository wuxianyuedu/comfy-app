// `/api/logs/history` 的尾部窗口契约（ISSUE #4252）：大日志不再整文件进内存，
// 超上限只回尾部并加说明；小文件原样返回。用例直接在 log/（gitignore 的运行期
// 目录）里造临时文件，跑完即删。

import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

/* 路由的鉴权链会拉起 src/env.js 的启动校验（vitest 里没有完整 .env）：
 * 这里把鉴权桩掉（本用例不测鉴权），env 校验一并绕开。 */
process.env.SKIP_ENV_VALIDATION = "1";
vi.mock("~/server/auth/request-user", () => ({
  requireRequestUser: vi.fn(() => ({ id: "u-test" })),
}));

import { GET } from "./route";
import { isRecord } from "~/lib/is-record";

const name = `history-cap-test-${process.pid}.log`;
const target = path.join(process.cwd(), "log", name);

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
