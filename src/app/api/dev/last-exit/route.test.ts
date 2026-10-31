// `/api/dev/last-exit` 的契约（ISSUE #1692）：它回「上一次应用服务为什么结束」，
// 必须区分三件事——记了什么、当前 runId 是什么、以及「没有原因可讲」这一正常状态
// （而不是把它显示成接口故障）。

import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { APP_SERVICE_EXIT_FILE } from "~/lib/shell/app-service-exit";

import { GET } from "./route";

const FILE = path.join(process.cwd(), "run", APP_SERVICE_EXIT_FILE);

/** 备份/还原真实文件：用例跑在仓库里，不能把开发机上的现场改坏。 */
let saved: string | null = null;

beforeEach(() => {
  saved = fs.existsSync(FILE) ? fs.readFileSync(FILE, "utf8") : null;
});

afterEach(() => {
  if (saved === null) {
    fs.rmSync(FILE, { force: true });
  } else {
    fs.writeFileSync(FILE, saved, "utf8");
  }
  delete process.env.COMFYAPP_RUN_ID;
});

function writeRecord(body: unknown): void {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(body), "utf8");
}

async function get(): Promise<{ currentRunId: unknown; record: unknown }> {
  const res = await GET();
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  return /* SAFETY: 类型断言已复核 */ (await res.json()) as {
    currentRunId: unknown;
    record: unknown;
  };
}

describe("GET /api/dev/last-exit", () => {
  it("回记录原文与当前 runId（判「说的是不是上一次」由调用方做）", async () => {
    process.env.COMFYAPP_RUN_ID = "run-new";
    writeRecord({
      at: "t",
      code: 1,
      kind: "dev-server",
      port: 3100,
      reason: "x",
      runId: "run-old",
      signal: null,
    });
    const data = await get();
    expect(data.currentRunId).toBe("run-new");
    expect(data.record).toMatchObject({ runId: "run-old" });
  });

  it("没有记录时回 record: null 而不是 404（「没原因可讲」是正常状态）", async () => {
    fs.rmSync(FILE, { force: true });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(
      /* SAFETY: 类型断言已复核 */ ((await res.json()) as { record: unknown }).record,
    ).toBeNull();
  });

  it("记录坏掉时按「没有原因可讲」处理，不 500（消费者是已经出故障时的界面）", async () => {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, "{ 这不是 JSON", "utf8");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(
      /* SAFETY: 类型断言已复核 */ ((await res.json()) as { record: unknown }).record,
    ).toBeNull();
  });

  it("空文件同样算「没有原因可讲」", async () => {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, "", "utf8");
    expect((await get()).record).toBeNull();
  });

  it("拿不到 COMFYAPP_RUN_ID 时 currentRunId 为 null（不编一个值）", async () => {
    delete process.env.COMFYAPP_RUN_ID;
    writeRecord({ at: "t", kind: "dev-server", reason: "x" });
    expect((await get()).currentRunId).toBeNull();
  });
});
