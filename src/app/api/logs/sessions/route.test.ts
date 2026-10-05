/**
 * `GET /api/logs/sessions` 的**一次启动一份文件**读取契约（ISSUE #1326）。
 *
 * 这一层回答的是用户原话：「comfyui-runtime.log / ollama-runtime.log /
 * drizzle-studio-runtime.log / app-runtime.log 这四份也要改成每个文件只存储
 * 单次运行的历史，单次里如果执行多次也存放多个文件，这样看起来清晰」。
 *
 * 四条契约：
 *   1. 列表 = 该来源在 `services/` 下的单次文件（新→旧），**只列本来源的**
 *      （同一目录里还有别的来源的文件）；
 *   2. 正文 = **选中那一份整份**（不再有「减去前一份」这回事 —— 一份文件只属于
 *      一次启动，这正是本次改造要消掉的那类判据）；
 *   3. 列表被上限截断时如实回报一共几份（`total`），界面据此说明还有更早的；
 *   4. 来源不认识 / 一份都没有 / 请求的文件已被清掉时都有**明确的空载荷**，
 *      不是 404/500。
 *
 * 用例造的是**真的目录结构**（按写方的命名规则），不是 mock 出来的内容 ——
 * 「哪些文件属于这个来源」这条判据来自文件名，夹具必须按那个规则造，否则用例
 * 是自证的（判据变红时也会先怀疑夹具）。
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "log-sessions-"));
/** 夹具的日志根（与 `log-paths` 的 `LOG_ROOT` 同口径）。 */
const logRoot = path.join(tmp, "log");
/** 四份 runtime 日志的落点（与 `log-paths` 的 `SERVICES_LOG_DIR` 同口径）。 */
const servicesDir = path.join(logRoot, "current", "services");

vi.mock("~/lib/log/log-paths", async () => {
  const actual = await vi.importActual("~/lib/log/log-paths");
  return {
    ...(actual as Record<string, unknown>),
    LOG_ROOT: logRoot,
    SERVICES_LOG_DIR: servicesDir,
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
  total: number;
  error?: string;
}

async function get(query: string): Promise<{ status: number; data: Payload }> {
  const res = await GET(
    new Request(`http://localhost/api/logs/sessions?${query}`),
  );
  return { status: res.status, data: (await res.json()) as Payload };
}

/** 造一份某来源的启动日志文件（名字按写方那套规则）。 */
function makeFile(name: string, content: string): void {
  fs.mkdirSync(servicesDir, { recursive: true });
  fs.writeFileSync(path.join(servicesDir, name), content, "utf8");
}

beforeEach(() => {
  fs.rmSync(servicesDir, { recursive: true, force: true });
  fs.mkdirSync(servicesDir, { recursive: true });
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("来源与空态的明确出口", () => {
  it("来源不在表里 → 400（给出原因，而不是空列表）", async () => {
    const { status, data } = await get("source=不存在的来源");
    expect(status).toBe(400);
    expect(data.error).toContain("unknown source");
    expect(data.sessions).toEqual([]);
  });

  it("一份都没有（这个服务从没启动过）→ 200 空载荷（界面显示空态，不是报错）", async () => {
    const { status, data } = await get("source=comfyui-runtime");
    expect(status).toBe(200);
    expect(data.sessions).toEqual([]);
    expect(data.selectedId).toBeNull();
    expect(data.content).toBe("");
    expect(data.total).toBe(0);
  });

  it("只列**本来源**的文件（同一目录里还有别的来源）", async () => {
    makeFile("comfyui-runtime-20261005-093612.log", "comfy\n");
    makeFile("ollama-runtime-20261005-093700.log", "ollama\n");
    makeFile("app-runtime-20261005-093800.log", "app\n");

    const { data } = await get("source=comfyui-runtime");
    expect(data.sessions.map((s) => s.id)).toEqual([
      "comfyui-runtime-20261005-093612.log",
    ]);
  });

  it("不认的日志文件不列（同目录里的 keepalive / trace 之类）", async () => {
    makeFile("comfyui-keepalive-2026-10-05-09-36-12.out.log", "keepalive\n");
    makeFile("comfyui-runtime-20261005-093612.log", "comfy\n");

    const { data } = await get("source=comfyui-runtime");
    expect(data.sessions.map((s) => s.id)).toEqual([
      "comfyui-runtime-20261005-093612.log",
    ]);
  });
});

describe("列表：新→旧，正文 = 那一份整份", () => {
  it("列表最新在最上（写方按旧→新命名，字典序即时间序）", async () => {
    makeFile("comfyui-runtime-20261005-090000.log", "第一次\n");
    makeFile("comfyui-runtime-20261005-093612.log", "第二次\n");
    makeFile("comfyui-runtime-20261005-100000.log", "第三次\n");

    const { data } = await get("source=comfyui-runtime");
    expect(data.sessions.map((s) => s.id)).toEqual([
      "comfyui-runtime-20261005-100000.log",
      "comfyui-runtime-20261005-093612.log",
      "comfyui-runtime-20261005-090000.log",
    ]);
    /* 缺省选最新那一份，正文就是它整份 */
    expect(data.selectedId).toBe("comfyui-runtime-20261005-100000.log");
    expect(data.content).toBe("第三次\n");
  });

  it("切到中间那一份 → 拿到的是它**整份**，不含别的启动的内容", async () => {
    makeFile("comfyui-runtime-20261005-090000.log", "第一次的输出\n");
    makeFile("comfyui-runtime-20261005-093612.log", "第二次的输出\n");

    const { data } = await get(
      "source=comfyui-runtime&session=comfyui-runtime-20261005-090000.log",
    );
    expect(data.selectedId).toBe("comfyui-runtime-20261005-090000.log");
    expect(data.content).toBe("第一次的输出\n");
    /* 关键反向断言：**不再**有「从装应用那天起的全部输出」这回事 */
    expect(data.content).not.toContain("第二次的输出");
  });

  it("下拉文案是名字里那个时刻（跨天也能分清）", async () => {
    makeFile("comfyui-runtime-20261005-093612.log", "x\n");
    makeFile("comfyui-runtime-20260930-190000.log", "y\n");

    const { data } = await get("source=comfyui-runtime");
    const titles = data.sessions.map((s) => s.title);
    expect(titles[0]).toBe("10-05 09:36:12");
    expect(titles[1]).toBe("09-30 19:00:00");
    /* startedAt 必须是本地时区解出来的毫秒（界面/排序都靠它） */
    expect(data.sessions[1]!.startedAt).toBe(
      new Date(2026, 8, 30, 19, 0, 0).getTime(),
    );
  });

  it("迁移前的旧固定名也列出来（排在最旧，没有时刻）", async () => {
    /* 用户盘上已经有 `<来源>.log`：改名把它丢掉比留着一条「更早的日志」糟得多。 */
    makeFile("comfyui-runtime.log", "迁移前的全部\n");
    makeFile("comfyui-runtime-20261005-093612.log", "新的\n");

    const { data } = await get("source=comfyui-runtime");
    expect(data.sessions.map((s) => s.id)).toEqual([
      "comfyui-runtime-20261005-093612.log",
      "comfyui-runtime.log",
    ]);
    expect(data.sessions[1]!.startedAt).toBeNull();
    expect(data.sessions[1]!.title).toBe("更早的日志");
  });

  it("同一秒内多次启动（名字带 -2 分叉）都列出来", async () => {
    makeFile("comfyui-runtime-20261005-093612.log", "第一次\n");
    makeFile("comfyui-runtime-20261005-093612-2.log", "第二次\n");

    const { data } = await get("source=comfyui-runtime");
    expect(data.sessions).toHaveLength(2);
  });
});

describe("列表上限与 total", () => {
  it("最多列 30 份，但 total 如实报一共几份（界面据此说明还有更早的）", async () => {
    for (let i = 0; i < 35; i += 1) {
      const hh = String(Math.floor(i / 60)).padStart(2, "0");
      const mm = String(i % 60).padStart(2, "0");
      makeFile(`comfyui-runtime-20261005-${hh}${mm}00.log`, `第 ${i} 份\n`);
    }

    const { data } = await get("source=comfyui-runtime");
    expect(data.sessions).toHaveLength(30);
    expect(data.total).toBe(35);
    /* 留下的必须是**最新**那 30 份：最早的 5 份不在了 */
    const ids = data.sessions.map((s) => s.id);
    expect(ids).not.toContain("comfyui-runtime-20261005-000000.log");
    expect(ids[0]).toBe("comfyui-runtime-20261005-003400.log");
  });

  it("没被截断时 total === 列表长度（界面不显示提示）", async () => {
    makeFile("comfyui-runtime-20261005-093612.log", "x\n");
    const { data } = await get("source=comfyui-runtime");
    expect(data.total).toBe(1);
    expect(data.sessions).toHaveLength(1);
  });
});

describe("正文窗口与选中项回落", () => {
  it("正文超上限时取尾部并掐头对齐到行边界（windowed / truncated 一并回报）", async () => {
    /* 造一份超过 400000 字节的文件：单行 100 字节 × 5000 行。 */
    const line = `${"x".repeat(98)}\n`; // 99 字节/行
    makeFile("comfyui-runtime-20261005-093612.log", line.repeat(5000));

    const { data } = await get("source=comfyui-runtime");
    expect(data.windowed).toBe(true);
    expect(data.truncated).toBe(true);
    expect(data.size).toBe(5000 * 99);
    /* 尾部窗口对齐到行首：首字符不能是被截断的半行内容 */
    expect(data.content.startsWith("x".repeat(98))).toBe(true);
    expect(data.content.endsWith(`${"x".repeat(98)}\n`)).toBe(true);
  });

  it("请求的文件已不在列表里（被保留策略删了）→ 回落最新那一份并如实回报", async () => {
    makeFile("comfyui-runtime-20261005-093612.log", "最新\n");
    const { data } = await get(
      "source=comfyui-runtime&session=comfyui-runtime-19990101-000000.log",
    );
    expect(data.selectedId).toBe("comfyui-runtime-20261005-093612.log");
    expect(data.content).toBe("最新\n");
  });
});
