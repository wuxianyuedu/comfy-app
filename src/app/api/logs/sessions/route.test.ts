/**
 * `GET /api/logs/sessions` 的会话读取契约（设置页「启动日志」下拉与全屏视图的数据源）。
 *
 * 用户反馈要能「切换每次启动的日志、不要把多次启动混在一起显示」，这条端点是
 * 那件事的唯一服务端出口。这里把四条契约钉死：
 *   1. 默认回**最新一次**启动，列表按行序（最后一项最新）；
 *   2. 带 `session` 时回那一次；id 已不在列表里（尾窗滑动把老会话推出去了）
 *      时回落最新，并把实际选中项放进 `selectedId` —— 客户端据此同步下拉；
 *   3. 文件不存在 / 来源不认识时有**明确的空载荷**，不是 404/500（界面据此显示
 *      空态而不是报错）；
 *   4. 文件超过扫描窗口时如实回报 `windowed`（更早的启动不在列表里）。
 */
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildSessionBanner } from "~/lib/session-banner.server";
import { parseLogSessions } from "~/lib/log/log-sessions";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "log-sessions-"));
const comfyLog = path.join(tmp, "comfyui-runtime.log");

/* 路径全部落到本用例自己的临时目录：`log/` 在 .gitignore 里，CI / 干净检出上
 * 根本不存在（与 `current/route.test.ts` 同一口径，避免「本机绿、CI 红」）。 */
vi.mock("~/lib/log/log-paths", async () => {
  const actual = await vi.importActual("~/lib/log/log-paths");
  return {
    ...(actual as Record<string, unknown>),
    COMFYUI_RUNTIME_LOG: comfyLog,
    /* 来源表**整体替换**：它在真实模块初始化时就由那些常量拼好了，只覆盖常量
     * 不会生效（端点读的是表里的值）。 */
    RUNTIME_LOG_FILES: { "comfyui-runtime": comfyLog },
  };
});

const { GET } = await import("./route");

interface Payload {
  sessions: Array<{ id: string; title: string; startedAt: number | null }>;
  selectedId: string | null;
  content: string;
  truncated: boolean;
  windowed: boolean;
  size: number;
  error?: string;
}

async function get(query: string): Promise<{ status: number; data: Payload }> {
  const res = await GET(
    new Request(`http://localhost/api/logs/sessions?${query}`),
  );
  return { status: res.status, data: (await res.json()) as Payload };
}

/** 追加一条会话横幅（走真实实现，格式与运行时写下的完全一致）。 */
function appendBanner(kind: "start" | "end", title: string): void {
  fs.appendFileSync(comfyLog, buildSessionBanner(kind, title), "utf8");
}

/** 写「两次启动」的日志：第一次带 spawn 行与退出横幅，第二次带 pid=2。 */
function writeTwoSessions(): void {
  appendBanner("start", "▶ ComfyUI 启动会话");
  fs.appendFileSync(comfyLog, "2026-09-18 10:01:00 [spawn] pid=1\n", "utf8");
  appendBanner("end", "■ ComfyUI 进程已退出（code=0）");
  appendBanner("start", "▶ ComfyUI 启动会话");
  fs.appendFileSync(comfyLog, "2026-09-18 10:03:00 [spawn] pid=2\n", "utf8");
}

beforeEach(() => {
  fs.writeFileSync(comfyLog, "", "utf8");
});

afterEach(() => {
  fs.rmSync(comfyLog, { force: true });
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("GET /api/logs/sessions", () => {
  it("来源不在表里 → 400（并给出明确的原因，而不是空列表）", async () => {
    const { status, data } = await get("source=不存在的来源");
    expect(status).toBe(400);
    expect(data.error).toContain("unknown source");
    expect(data.sessions).toEqual([]);
  });

  it("日志文件不存在 → 200 空载荷（界面显示空态，而不是报错）", async () => {
    fs.rmSync(comfyLog, { force: true });
    const { status, data } = await get("source=comfyui-runtime");
    expect(status).toBe(200);
    expect(data.sessions).toEqual([]);
    expect(data.selectedId).toBeNull();
    expect(data.content).toBe("");
    expect(data.size).toBe(0);
  });

  it("缺省回最新一次启动：列表按行序、正文只含那一次的输出", async () => {
    writeTwoSessions();
    const { data } = await get("source=comfyui-runtime");
    expect(data.sessions).toHaveLength(2);
    expect(data.windowed).toBe(false);
    expect(data.selectedId).toBe(data.sessions[1]!.id);
    expect(data.content).toContain("pid=2");
    expect(data.content).not.toContain("pid=1");
    expect(data.size).toBe(fs.statSync(comfyLog).size);
  });

  it("带 session 时只回那一次（多次启动不混在一条时间线上）", async () => {
    writeTwoSessions();
    const all = parseLogSessions(fs.readFileSync(comfyLog, "utf8"));
    const first = all[0]!;
    const { data } = await get(
      `source=comfyui-runtime&session=${encodeURIComponent(first.id)}`,
    );
    expect(data.selectedId).toBe(first.id);
    expect(data.content).toContain("pid=1");
    expect(data.content).not.toContain("pid=2");
  });

  it("id 已不在列表里 → 回落最新，并在 selectedId 里如实回报", async () => {
    writeTwoSessions();
    const { data } = await get("source=comfyui-runtime&session=99999");
    expect(data.selectedId).toBe(data.sessions[data.sessions.length - 1]!.id);
    expect(data.content).toContain("pid=2");
  });

  it("列表最多保留最近 30 次启动（更老的不进下拉，也不占响应体）", async () => {
    for (let i = 0; i < 35; i += 1) {
      appendBanner("start", "▶ ComfyUI 启动会话");
      fs.appendFileSync(
        comfyLog,
        `2026-09-18 10:00:00 [spawn] pid=${i}\n`,
        "utf8",
      );
    }
    const { data } = await get("source=comfyui-runtime");
    const expected = parseLogSessions(fs.readFileSync(comfyLog, "utf8"));
    expect(data.sessions).toHaveLength(30);
    expect(data.sessions.map((s) => s.id)).toEqual(
      expected.slice(-30).map((s) => s.id),
    );
    expect(data.content).toContain("pid=34");
  });

  it("文件超过扫描窗口 → windowed=true（更早的启动不在列表里，界面据此说明）", async () => {
    /* 造一份超过尾窗的日志：窗口内的行归「更早的日志」，横幅那次仍是最新。 */
    let filler = "";
    while (filler.length < 4 * 1024 * 1024) {
      filler += "2026-09-18 09:00:00 旧日志填充行\n";
    }
    fs.writeFileSync(comfyLog, filler, "utf8");
    appendBanner("start", "▶ ComfyUI 启动会话");
    fs.appendFileSync(comfyLog, "2026-09-18 10:00:00 [spawn] pid=9\n", "utf8");

    const { data } = await get("source=comfyui-runtime");
    expect(data.windowed).toBe(true);
    expect(data.sessions[data.sessions.length - 1]!.title).toBe(
      "▶ ComfyUI 启动会话",
    );
    expect(data.content).toContain("pid=9");
  });
});
