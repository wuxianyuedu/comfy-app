// `/api/update-check` 的契约：响应形状稳定（前端 `use-update-check` 据此弹
// 「重启/重编壳生效」的安静提示），首轮只建档、不当作检测到更新。
// 实现注：扫描是 fs.promises 异步版（ISSUE #4203，不再阻塞事件循环）。

import { describe, expect, it } from "vitest";
import { isRecord } from "~/lib/is-record";

import { GET } from "./route";

async function get(): Promise<Record<string, unknown>> {
  const res = await GET();
  expect(res.status).toBe(200);
  const raw: unknown = await res.json();
  if (!isRecord(raw)) {
    throw new Error("响应体不是对象");
  }
  return raw;
}

describe("GET /api/update-check", () => {
  it("首轮建档：armed=false、dirty=false，两组各带 key/label/hint 与 files 数组", async () => {
    const body = await get();
    expect(body.ok).toBe(true);
    expect(body.armed).toBe(false);
    expect(body.dirty).toBe(false);
    const groupsRaw = body.groups;
    if (!Array.isArray(groupsRaw)) {
      throw new Error("groups 不是数组");
    }
    const groups = groupsRaw.filter((g): g is Record<string, unknown> => isRecord(g));
    expect(groups.map((g) => g.key)).toEqual(["restart", "recompile"]);
    for (const g of groups) {
      expect(typeof g.label).toBe("string");
      expect(typeof g.hint).toBe("string");
      expect(g.dirty).toBe(false);
      expect(Array.isArray(g.files)).toBe(true);
    }
  });

  it("第二轮起基线已建立（armed=true），不误报更新", async () => {
    const body = await get();
    expect(body.armed).toBe(true);
    expect(body.dirty).toBe(false);
  });
});
