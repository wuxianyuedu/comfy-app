/**
 * `GET /api/schema` 的契约 —— 底部状态栏「数据库同步中 / 已同步请刷新 / 需人工同步」
 * 的数据源。
 *
 * 三条：
 *   1. 状态文件在 → 字段原样透出（`phase` / `detail` / `at`）；
 *   2. 文件不在 / 不是 JSON / 不是对象 → `{ ok: false, phase: "unknown" }`，
 *      **不是**报错 —— 没有提示 ≠ 出错，状态栏据此什么都不显示；
 *   3. 不能缓存（`force-dynamic`）：否则同步完成后页面读到的还是旧状态，
 *      「正在同步」会一直挂着。
 *
 * 状态文件由后台的 `scripts/db-sync.mjs` 写（另一个进程），所以这里用真文件
 * 驱动：读的就是 `process.cwd()/log/schema-sync.json`，mock 掉文件系统等于把
 * 「两个进程靠磁盘交汇」这件事本身测掉了。
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const statusFile = path.join(
  process.cwd(),
  "log",
  "current",
  "tools",
  "schema-sync.json",
);
let backup: string | null = null;

beforeEach(() => {
  backup = fs.existsSync(statusFile)
    ? fs.readFileSync(statusFile, "utf8")
    : null;
});

afterEach(() => {
  /* 还原开发者本机原有的状态文件，别把测试的痕迹留下（它会影响真实的状态栏）。 */
  if (backup === null) {
    fs.rmSync(statusFile, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(statusFile), { recursive: true });
  fs.writeFileSync(statusFile, backup, "utf8");
});

describe("GET /api/schema", () => {
  it("状态文件在时把字段原样透出（后台同步完成 → 页面才知道该刷新）", async () => {
    fs.mkdirSync(path.dirname(statusFile), { recursive: true });
    fs.writeFileSync(
      statusFile,
      JSON.stringify({
        phase: "synced",
        detail: null,
        at: "2026-09-20T12:44:30.766Z",
      }),
      "utf8",
    );
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      canPush: true,
      phase: "synced",
      detail: null,
      at: "2026-09-20T12:44:30.766Z",
    });
  });

  it("`syncing` 也要透出（同步期间页面 500，用户得知道该等）", async () => {
    fs.mkdirSync(path.dirname(statusFile), { recursive: true });
    fs.writeFileSync(
      statusFile,
      JSON.stringify({ phase: "syncing", at: "2026-09-20T12:44:05.427Z" }),
      "utf8",
    );
    const { GET } = await import("./route");
    const body = (await (await GET()).json()) as { phase: string };
    expect(body.phase).toBe("syncing");
  });

  it("文件不在时回 unknown 而不是报错（没提示 ≠ 出错）", async () => {
    fs.rmSync(statusFile, { force: true });
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      phase: "unknown",
      canPush: true,
    });
  });

  it("文件内容坏掉（不是 JSON / 不是对象）时同样回 unknown，绝不抛", async () => {
    fs.mkdirSync(path.dirname(statusFile), { recursive: true });
    const { GET } = await import("./route");

    fs.writeFileSync(statusFile, "{ 这不是 JSON", "utf8");
    await expect((await GET()).json()).resolves.toEqual({
      ok: false,
      phase: "unknown",
      canPush: true,
    });

    fs.writeFileSync(statusFile, '"synced"', "utf8");
    await expect((await GET()).json()).resolves.toEqual({
      ok: false,
      phase: "unknown",
      canPush: true,
    });
  });

  it("标记为 force-dynamic（同步完成后页面必须立刻读到新状态）", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src", "app", "api", "schema", "route.ts"),
      "utf8",
    );
    expect(src).toContain('export const dynamic = "force-dynamic"');
  });
});
