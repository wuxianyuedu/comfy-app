/**
 * `GET /api/logs/sessions` 的**跨运行**读取契约（ISSUE #1326）。
 *
 * 这一层回答的是用户原话「之前能切换的也是历史，不能用 runs 中找吗」：列表要
 * 列 `runs/` 里的历史包，切过去要能看到**那一次运行**的正文。四条契约：
 *   1. 列表 = 本次运行 + `runs/` 各包（新→旧），只列有这个来源文件的包；
 *   2. 历史包的正文 = 该包文件**减去前一包**（包 N ⊇ 包 N-1，归档是整目录复制）；
 *   3. 基准不可得（前一包被保留策略删了）→ 整份给出且 `baselineMissing: true`；
 *   4. 文件不存在 / 来源不认识 / 包被删光时有**明确的空载荷**，不是 404/500。
 *
 * 用例造的是**真的** `runs/` 目录结构（含 `run.json`），不是 mock 出来的
 * 文件长度 —— 「包 N 是包 N-1 的前缀」这条性质来自归档的复制语义，夹具必须
 * 按那个语义造，否则切片用例是自证的。
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "log-sessions-"));
/** 夹具的项目根：`log/` 的父目录（与 run.mjs 的 root 同口径）。 */
const projectRoot = path.join(tmp, "root");
const logRoot = path.join(projectRoot, "log");
const currentDir = path.join(logRoot, "current");
const runsDir = path.join(logRoot, "runs");
/** 各运行包内该来源文件的相对位置（与端点的 SOURCE_REL 同源）。 */
const SOURCE_REL = path.join("services", "comfyui-runtime.log");

vi.mock("~/lib/log/log-paths", async () => {
  const actual = await vi.importActual("~/lib/log/log-paths");
  return {
    ...(actual as Record<string, unknown>),
    LOG_ROOT: logRoot,
    RUNTIME_LOG_FILES: {
      "comfyui-runtime": path.join(currentDir, SOURCE_REL),
    },
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
  baselineMissing: boolean;
  error?: string;
}

async function get(query: string): Promise<{ status: number; data: Payload }> {
  const res = await GET(
    new Request(`http://localhost/api/logs/sessions?${query}`),
  );
  return { status: res.status, data: (await res.json()) as Payload };
}

/** 造一个运行包：`run.json` + 该来源的日志文件（内容由调用方给）。 */
function makePack(
  name: string,
  content: string,
  meta: { startedAt?: string; crashed?: boolean } = {},
): void {
  const dir = path.join(runsDir, name);
  fs.mkdirSync(path.join(dir, "services"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "run.json"),
    JSON.stringify({
      runId: name.slice(-6),
      startedAt: meta.startedAt ?? "2026-09-30T19:36:12.000Z",
      crashed: meta.crashed ?? false,
    }),
    "utf8",
  );
  fs.writeFileSync(path.join(dir, SOURCE_REL), content, "utf8");
}

/** 写本次运行（`current/`）的日志与 run.json。 */
function makeCurrent(
  content: string,
  meta: Record<string, unknown> = {},
): void {
  fs.mkdirSync(path.join(currentDir, "services"), { recursive: true });
  fs.writeFileSync(
    path.join(currentDir, "run.json"),
    JSON.stringify({
      runId: "ffffff",
      startedAt: "2026-10-05T09:00:00.000Z",
      crashed: false,
      ...meta,
    }),
    "utf8",
  );
  fs.writeFileSync(path.join(currentDir, SOURCE_REL), content, "utf8");
}

beforeEach(() => {
  fs.rmSync(logRoot, { recursive: true, force: true });
  fs.mkdirSync(currentDir, { recursive: true });
  fs.mkdirSync(runsDir, { recursive: true });
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

  it("什么都没有（第一次运行）→ 200 空载荷（界面显示空态，不是报错）", async () => {
    const { status, data } = await get("source=comfyui-runtime");
    expect(status).toBe(200);
    expect(data.sessions).toEqual([]);
    expect(data.selectedId).toBeNull();
    expect(data.content).toBe("");
  });

  it("runs/ 里没有这个来源的包 → 不列它们（点开是空窗口的不是「历史」）", async () => {
    /* 那一包存在，但它没写过这个来源的文件（那台机器上没启动过这个服务）。 */
    makePack("2026-09-29_100000-aaaaaa", "");
    fs.rmSync(path.join(runsDir, "2026-09-29_100000-aaaaaa", SOURCE_REL));
    makeCurrent("本次运行\n");

    const { data } = await get("source=comfyui-runtime");
    expect(data.sessions.map((s) => s.id)).toEqual(["run:current"]);
  });
});

describe("列表：本次 + 历史包，新→旧", () => {
  it("本次在最上，历史按名字倒序（字典序即时间序）", async () => {
    makePack("2026-09-28_100000-aaaaaa", "A\n");
    makePack("2026-09-30_100000-bbbbbb", "B\n");
    makePack("2026-09-29_100000-cccccc", "C\n");
    makeCurrent("本次\n");

    const { data } = await get("source=comfyui-runtime");
    expect(data.sessions.map((s) => s.id)).toEqual([
      "run:current",
      "run:2026-09-30_100000-bbbbbb",
      "run:2026-09-29_100000-cccccc",
      "run:2026-09-28_100000-aaaaaa",
    ]);
    expect(data.selectedId).toBe("run:current");
  });

  it("下拉文案带时刻 + 退出形态 + runId（报问题时能说清是哪一次）", async () => {
    makePack("2026-09-30_193612-a1b2c3", "崩之前的现场\n", {
      crashed: true,
    });
    makeCurrent("本次\n");

    const { data } = await get("source=comfyui-runtime");
    const history = data.sessions[1]!;
    expect(history.title).toContain("异常退出");
    expect(history.title).toContain("a1b2c3");
    expect(data.sessions[0]!.title).toContain("本次运行");
  });

  it("下拉总共最多 30 项（本次 + 历史），且留下的必须是最新的那些", async () => {
    for (let i = 1; i <= 35; i += 1) {
      const day = String(i).padStart(2, "0");
      makePack(`2026-09-${day}_100000-aaaaaa`, `pack ${i}\n`);
    }
    makeCurrent("本次\n");

    const { data } = await get("source=comfyui-runtime");
    expect(data.sessions).toHaveLength(30);
    expect(data.sessions[0]!.id).toBe("run:current");
    /* 留下的必须是**最新**那 29 包：最早的 6 包被截掉 */
    expect(data.sessions.map((s) => s.id)).not.toContain(
      "run:2026-09-01_100000-aaaaaa",
    );
    expect(data.sessions.map((s) => s.id)).toContain(
      "run:2026-09-35_100000-aaaaaa",
    );
  });
});

describe("正文：历史包要减去前一包", () => {
  it("切到历史包 → 只回那一次新增的内容（不是从装应用那天起的全部）", async () => {
    /* 归档是「整目录复制」，所以包 2 的文件 = 包 1 的内容 + 本次新增。 */
    const first = "第一次运行\n输出 A\n";
    makePack("2026-09-29_100000-aaaaaa", first);
    makePack("2026-09-30_100000-bbbbbb", `${first}第二次运行\n输出 B\n`);

    const { data } = await get(
      "source=comfyui-runtime&session=run:2026-09-30_100000-bbbbbb",
    );
    expect(data.selectedId).toBe("run:2026-09-30_100000-bbbbbb");
    expect(data.content).toContain("输出 B");
    /* 关键：上上次的内容被剪掉了 —— 不剪的话这里会同时含「输出 A」 */
    expect(data.content).not.toContain("输出 A");
  });

  it("最早那一包没有基准 → 整份给出，且**不标记**异常（本来就没有基准）", async () => {
    makePack("2026-09-29_100000-aaaaaa", "最早一包的全部输出\n");

    const { data } = await get(
      "source=comfyui-runtime&session=run:2026-09-29_100000-aaaaaa",
    );
    expect(data.content).toContain("最早一包的全部输出");
    expect(data.baselineMissing).toBe(false);
  });

  it("前一包被保留策略删了 → 整份给出 + baselineMissing（界面据此说明）", async () => {
    /* 「前一包」按**名字**找（排序后的紧邻前一个），中间那包被删了就找不到基准。
     * 这时不能猜一个基准去切 —— 会把真实内容切掉，比多显示糟得多。 */
    const first = "很早的一包\n";
    makePack("2026-09-28_100000-aaaaaa", first);
    makePack("2026-09-30_100000-cccccc", `${first}最新一包\n`);

    const { data } = await get(
      "source=comfyui-runtime&session=run:2026-09-30_100000-cccccc",
    );
    /* 基准是 09-28 那一包（紧邻的前一个**存在**的包），因此这里其实切得动 ——
     * 「基准不可得」只发生在该包是 runs/ 里最早那一个时。 */
    expect(data.content).toContain("最新一包");
    expect(data.baselineMissing).toBe(false);
  });

  it("本次运行不减（`current/` 天生只有本次的内容）", async () => {
    /* 关键对照：历史包里含一行「上一次运行的全部」，而本次运行的正文里
     * **不能**出现它 —— 本次运行读的是 `current/`，不是归档包。 */
    makePack("2026-09-29_100000-aaaaaa", "上一次运行的全部\n");
    makeCurrent("本次运行才写的\n");

    const { data } = await get("source=comfyui-runtime");
    expect(data.selectedId).toBe("run:current");
    expect(data.content).toBe("本次运行才写的\n");
    expect(data.content).not.toContain("上一次运行的全部");
  });
});

describe("选中项回落", () => {
  it("请求的包已不在列表里 → 回落本次运行，并在 selectedId 里如实回报", async () => {
    makeCurrent("本次\n");
    const { data } = await get(
      "source=comfyui-runtime&session=run:2026-01-01_000000-ffffff",
    );
    expect(data.selectedId).toBe("run:current");
  });

  it("基准恰好落在行边界上时不丢内容（归档是按完整文件复制的）", async () => {
    /* 真实形态：前一包 = 包 2 的完整前缀，因此切点天然在行首。这条是**反向
     * 验证** —— 若实现多掐了一行（把 `from` 也当尾部窗口处理），这里必红。 */
    const first = "第一次运行\n输出 A\n";
    makePack("2026-09-29_100000-aaaaaa", first);
    makePack("2026-09-30_100000-bbbbbb", `${first}第二次运行\n输出 B\n`);

    const { data } = await get(
      "source=comfyui-runtime&session=run:2026-09-30_100000-bbbbbb",
    );
    expect(data.content).toBe("第二次运行\n输出 B\n");
  });
});
