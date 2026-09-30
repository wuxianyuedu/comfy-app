/**
 * `POST /api/schema/push` 的契约 —— 状态栏「立即同步」按钮的执行端。
 *
 * 要钉住的是**守卫的失败方向**：这个端点背后是 `db-sync.mjs --force`（会应用
 * 「会丢数据」的语句），所以任何「不该执行」的形态都必须停在 spawn 之前——
 *
 *   1. 相位不是 `stale` / `missing`（没有要修的东西 / 正在同步）→ 409；
 *   2. 状态文件读不到 / 坏掉 → 同样 409（没有依据就不发起）；
 *   3. 执行件不在（桌包载荷）→ 404，前端据 `canPush` 根本不显示按钮；
 *   4. 唯一放行的形态：相位确实是 stale / missing → spawn（带 force: true）。
 *
 * 两个依赖都替身化：`spawnSchemaSync` mock 掉（真 spawn 会起一个 15~30 秒的
 * drizzle 子进程并改写真实状态文件）；状态文件**读**走 `readFileSync` spy——
 * 不能写真文件：`GET /api/schema` 的测试与本文件并行跑，两份真文件读写会
 * 互相踩（同一份 `log/schema-sync.json` 是它们共同的夹具）。同步本身的判据
 * 在 tests/db-schema-current.test.ts。
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const statusFile = path.join(process.cwd(), "log", "schema-sync.json");

const spawnSchemaSync = vi.hoisted(() => vi.fn());

vi.mock("../../../../../scripts/db-schema-state.mjs", () => ({
  spawnSchemaSync,
}));

/** 把状态文件的内容钉在 spy 上；其余路径穿透到真实现（本文件不读别的文件）。 */
function stubStatusFile(payload: string): void {
  const real = fs.readFileSync;
  vi.spyOn(fs, "readFileSync").mockImplementation((p, options) =>
    p === statusFile ? payload : real.call(fs, p, options),
  );
}

function statusJson(phase: string, detail: string | null = null): string {
  return JSON.stringify({ phase, detail, at: new Date().toISOString() });
}

beforeEach(() => {
  spawnSchemaSync.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function post(): Promise<Response> {
  const { POST } = await import("./route");
  return POST();
}

describe("POST /api/schema/push", () => {
  it("相位是 stale 时放行，并以 force: true 发起同步", async () => {
    stubStatusFile(statusJson("stale", "含「会丢数据」的语句 2 条"));
    spawnSchemaSync.mockReturnValue({ started: true });
    const res = await post();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(spawnSchemaSync).toHaveBeenCalledTimes(1);
    expect(spawnSchemaSync).toHaveBeenCalledWith(process.cwd(), {
      force: true,
    });
  });

  it("missing（表没建起来）同样放行", async () => {
    stubStatusFile(statusJson("missing", "起 pnpm 失败（ENOENT）"));
    spawnSchemaSync.mockReturnValue({ started: true });
    expect((await post()).status).toBe(200);
  });

  it("正在同步（syncing）→ 409，不并发两个 drizzle 写同一个库", async () => {
    stubStatusFile(statusJson("syncing"));
    const res = await post();
    expect(res.status).toBe(409);
    expect(spawnSchemaSync).not.toHaveBeenCalled();
  });

  it("库是好的（ready / synced）→ 409：没有要修的东西就不许发起", async () => {
    stubStatusFile(statusJson("ready"));
    expect((await post()).status).toBe(409);
    stubStatusFile(statusJson("synced"));
    expect((await post()).status).toBe(409);
    expect(spawnSchemaSync).not.toHaveBeenCalled();
  });

  it("状态文件读不到 → 409（没有依据就不发起）", async () => {
    vi.spyOn(fs, "readFileSync").mockImplementation(() => {
      throw Object.assign(new Error("no such file or directory"), {
        code: "ENOENT",
      });
    });
    expect((await post()).status).toBe(409);
    expect(spawnSchemaSync).not.toHaveBeenCalled();
  });

  it("状态文件坏了（不是 JSON）→ 409，绝不抛", async () => {
    stubStatusFile("{ 这不是 JSON");
    expect((await post()).status).toBe(409);
    expect(spawnSchemaSync).not.toHaveBeenCalled();
  });

  it("执行件不在（桌包载荷）→ 404，把 spawnSchemaSync 的原因带出来", async () => {
    stubStatusFile(statusJson("stale"));
    spawnSchemaSync.mockReturnValue({
      started: false,
      reason: "找不到 scripts/db-sync.mjs",
    });
    const res = await post();
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain("找不到");
  });
});
