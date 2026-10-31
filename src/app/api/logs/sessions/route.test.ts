/**
 * `GET /api/logs/sessions` 的读取契约：**一次启动一份文件**（ISSUE #1326）
 * 且**跨运行包**（ISSUE #1587）。
 *
 * 这一层回答两句用户原话。第一句（#1326）：「comfyui-runtime.log /
 * ollama-runtime.log / drizzle-studio-runtime.log / app-runtime.log 这四份也要
 * 改成每个文件只存储单次运行的历史，单次里如果执行多次也存放多个文件，这样看起来
 * 清晰」。第二句（#1587）：「日志会归档到 runs 中，但应用内缺少入口查看」——
 * `current/` 被归档、清空之后，`runs/` 里那一包中的份此前没有任何界面能打开。
 *
 * 六条契约：
 *   1. 列表 = **本次运行**（`current/services/` 下该来源的份，新→旧、恒在最前）
 *      + **各历史包**里的份（包名倒序），**只列本来源的**（同一目录里还有别的
 *      来源的文件）；
 *   2. 正文 = **选中那一份整份**（不再有「减去前一份」这回事 —— 一份文件只属于
 *      一次启动，这正是 #1326 要消掉的那类判据）；
 *   3. 归档份的 id 带包名（`<包名>/<文件名>`），切过去拿到的是**那一包那一份**；
 *   4. 列表被上限截断时如实回报一共几份（`total`），界面据此说明还有更早的；
 *   5. 来源不认识 / 一份都没有 / 请求的份已被清掉 / 畸形 id 都有**明确的空载荷
 *      或回落**，不是 404/500，也不拿它去拼路径；
 *   6. 没有该来源份的包**不列**（点开只会是空窗口，那不是历史是噪声）。
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
/**
 * 归档包的落点（与 `run.mjs` 的 `runsDir(root)` 同口径：`logRoot` 就是 `root/log`，
 * 端点是拿 `path.dirname(LOG_ROOT)` 去算的 —— 这里造的就是那样一棵树）。
 */
const runsDir = path.join(logRoot, "runs");

vi.mock("~/lib/log/log-paths", async () => {
  const actual = await vi.importActual("~/lib/log/log-paths");
  return {
    .../* SAFETY: 类型断言已复核 */ (actual as Record<string, unknown>),
    LOG_ROOT: logRoot,
    SERVICES_LOG_DIR: servicesDir,
  };
});

const { GET } = await import("./route");

type Payload = {
  content: string;
  error?: string;
  selectedId: string | null;
  sessions: Array<{
    crashed: boolean;
    id: string;
    scope: "current" | "runs";
    startedAt: number | null;
    title: string;
  }>;
  size: number;
  total: number;
  truncated: boolean;
  windowed: boolean;
};

async function get(query: string): Promise<{ data: Payload; status: number }> {
  const res = await GET(new Request(`http://localhost/api/logs/sessions?${query}`));
  return {
    data: /* SAFETY: 类型断言已复核 */ (await res.json()) as Payload,
    status: res.status,
  };
}

/** 造一份某来源的启动日志文件（名字按写方那套规则）。 */
function makeFile(name: string, content: string): void {
  fs.mkdirSync(servicesDir, { recursive: true });
  fs.writeFileSync(path.join(servicesDir, name), content, "utf8");
}

/**
 * 造一个**已归档的运行包**（目录名与 `run.mjs` 的 `runDirName` 同形、
 * `services/` 下是命名规则的份、`run.json` 是收尾补全的那一份）。
 *
 * 夹具按真实归档形态造：归档是整目录复制 ⇒ 包内结构与 `current/` 逐字同构，
 * 这正是跨包那一层「复用包内判据」的前提。手写一个「只有几个字段」的假对象会
 * 让用例自证。
 */
function makePack(
  name: string,
  files: Record<string, string>,
  opts: { crashed?: boolean; startedAt?: Date } = {},
): void {
  const dir = path.join(runsDir, name);
  fs.mkdirSync(path.join(dir, "services"), { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, "services", file), content, "utf8");
  }
  fs.writeFileSync(
    path.join(dir, "run.json"),
    JSON.stringify({
      crashed: opts.crashed === true,
      runId: name.slice(name.lastIndexOf("-") + 1),
      startedAt: (opts.startedAt ?? new Date(2026, 8, 30, 19, 36, 12)).toISOString(),
    }),
    "utf8",
  );
}

beforeEach(() => {
  fs.rmSync(path.join(logRoot, "current"), { force: true, recursive: true });
  fs.rmSync(runsDir, { force: true, recursive: true });
  fs.mkdirSync(servicesDir, { recursive: true });
});

afterAll(() => {
  fs.rmSync(tmp, { force: true, recursive: true });
});

describe("来源与空态的明确出口", () => {
  it("来源不在表里 → 400（给出原因，而不是空列表）", async () => {
    const { data, status } = await get("source=不存在的来源");
    expect(status).toBe(400);
    expect(data.error).toContain("unknown source");
    expect(data.sessions).toEqual([]);
  });

  it("一份都没有（这个服务从没启动过）→ 200 空载荷（界面显示空态，不是报错）", async () => {
    const { data, status } = await get("source=comfyui-runtime");
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
    expect(data.sessions.map((s) => s.id)).toEqual(["comfyui-runtime-20261005-093612.log"]);
  });

  it("不认的日志文件不列（同目录里的 keepalive / trace 之类）", async () => {
    makeFile("comfyui-keepalive-2026-10-05-09-36-12.out.log", "keepalive\n");
    makeFile("comfyui-runtime-20261005-093612.log", "comfy\n");

    const { data } = await get("source=comfyui-runtime");
    expect(data.sessions.map((s) => s.id)).toEqual(["comfyui-runtime-20261005-093612.log"]);
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
    /* 本次运行的份带「本次运行」那一段（跨包之后必须能看出它属于哪一次运行，
     * 段末没有 runId —— 它还没归档、没有包名）。 */
    expect(titles[0]).toBe("10-05 09:36:12 · 本次运行");
    expect(titles[1]).toBe("09-30 19:00:00 · 本次运行");
    /* startedAt 必须是本地时区解出来的毫秒（界面/排序都靠它） */
    expect(data.sessions[1]!.startedAt).toBe(new Date(2026, 8, 30, 19, 0, 0).getTime());
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
    expect(data.sessions[1]!.title).toBe("更早的日志 · 本次运行");
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

/**
 * 跨运行包（ISSUE #1587）：归档之后的份在应用内必须有入口。
 *
 * 用户原话：「日志会归档到 runs 中，但应用内缺少入口查看」。
 */
describe("跨包：列表含历史包里的份，正文按包取", () => {
  it("列表 = 本次运行（最前）+ 各历史包（新→旧），归档份标出**哪一次运行**", async () => {
    makeFile("comfyui-runtime-20261005-093612.log", "本次\n");
    makePack(
      "2026-10-04_140000-bbbbbb",
      { "comfyui-runtime-20261004-140000.log": "上一包\n" },
      { startedAt: new Date(2026, 9, 4, 14, 0, 0) },
    );
    makePack(
      "2026-10-03_100000-aaaaaa",
      { "comfyui-runtime-20261003-100000.log": "上上包\n" },
      { startedAt: new Date(2026, 9, 3, 10, 0, 0) },
    );

    const { data } = await get("source=comfyui-runtime");
    expect(data.sessions.map((s) => s.id)).toEqual([
      "comfyui-runtime-20261005-093612.log",
      "2026-10-04_140000-bbbbbb/comfyui-runtime-20261004-140000.log",
      "2026-10-03_100000-aaaaaa/comfyui-runtime-20261003-100000.log",
    ]);
    expect(data.sessions.map((s) => s.scope)).toEqual(["current", "runs", "runs"]);
    /* 归档份的文案三段：时刻 · 退出形态 · runId —— runId 是跨包 `grep` 的唯一入口 */
    expect(data.sessions[1]!.title).toBe("10-04 14:00:00 · 正常退出 · bbbbbb");
    expect(data.total).toBe(3);
    /* 缺省选**本次运行**那一份（列表第一项） */
    expect(data.selectedId).toBe("comfyui-runtime-20261005-093612.log");
    expect(data.content).toBe("本次\n");
  });

  /* 这条是本组最要紧的一条：切到归档份拿到的是**那一包那一眼**的内容 —— 不是
   * 本次运行的同名文件、也不是别的包。反向断言两件事，否则用例可能只是
   * 「恰好读到了什么」而自证。 */
  it("切到归档份 → 拿到那一包那一份整份（不是本次运行的同名文件）", async () => {
    makeFile("comfyui-runtime-20261005-093612.log", "本次运行的内容\n");
    makePack("2026-10-04_140000-bbbbbb", {
      "comfyui-runtime-20261004-140000.log": "上一包的内容\n",
    });

    const { data } = await get(
      "source=comfyui-runtime" +
        "&session=2026-10-04_140000-bbbbbb/comfyui-runtime-20261004-140000.log",
    );
    expect(data.selectedId).toBe("2026-10-04_140000-bbbbbb/comfyui-runtime-20261004-140000.log");
    expect(data.content).toBe("上一包的内容\n");
    expect(data.content).not.toContain("本次运行的内容");
  });

  it("两个包里有同名份时各读各的（id 带包名就是为了这个）", async () => {
    /* 同一秒内两次启动的 `-2`、迁移前的旧固定名都会让两个包出现同名文件。 */
    makePack("2026-10-04_140000-bbbbbb", {
      "comfyui-runtime.log": "b 包的旧固定名\n",
    });
    makePack("2026-10-03_100000-aaaaaa", {
      "comfyui-runtime.log": "a 包的旧固定名\n",
    });

    const b = await get(
      "source=comfyui-runtime" + "&session=2026-10-04_140000-bbbbbb/comfyui-runtime.log",
    );
    const a = await get(
      "source=comfyui-runtime" + "&session=2026-10-03_100000-aaaaaa/comfyui-runtime.log",
    );
    expect(b.data.content).toBe("b 包的旧固定名\n");
    expect(a.data.content).toBe("a 包的旧固定名\n");
  });

  it("崩溃的那一包标「异常退出」（形态与正常退出完全不同，先标出来才知道在看什么）", async () => {
    makePack(
      "2026-10-04_140000-bbbbbb",
      { "comfyui-runtime-20261004-140000.log": "崩\n" },
      { crashed: true },
    );

    const { data } = await get("source=comfyui-runtime");
    expect(data.sessions[0]!.crashed).toBe(true);
    expect(data.sessions[0]!.title).toContain("异常退出");
  });

  it("没有该来源份的包**不列**（点开只会是空窗口 —— 那不是历史是噪声）", async () => {
    makePack("2026-10-04_140000-bbbbbb", {
      "ollama-runtime-20261004-140000.log": "别的来源\n",
    });
    makePack("2026-10-03_100000-aaaaaa", {
      "comfyui-runtime-20261003-100000.log": "本来源\n",
    });

    const { data } = await get("source=comfyui-runtime");
    expect(data.sessions.map((s) => s.id)).toEqual([
      "2026-10-03_100000-aaaaaa/comfyui-runtime-20261003-100000.log",
    ]);
    expect(data.total).toBe(1);
  });

  it("本次运行恒在最前（即使某个历史包的时刻更晚）", async () => {
    makeFile("comfyui-runtime-20261005-093612.log", "本次\n");
    makePack(
      "2026-10-09_235959-ffffff",
      { "comfyui-runtime-20261009-235959.log": "时钟更晚的包\n" },
      { startedAt: new Date(2026, 9, 9, 23, 59, 59) },
    );

    const { data } = await get("source=comfyui-runtime");
    expect(data.sessions[0]!.scope).toBe("current");
  });

  it("`runs/` 还不存在（从没正常退出过）→ 只有本次运行，不是错误", async () => {
    fs.rmSync(runsDir, { force: true, recursive: true });
    makeFile("comfyui-runtime-20261005-093612.log", "本次\n");

    const { data, status } = await get("source=comfyui-runtime");
    expect(status).toBe(200);
    expect(data.sessions.map((s) => s.id)).toEqual(["comfyui-runtime-20261005-093612.log"]);
  });

  it("本次运行的份已经被归档清空 → 列表全是历史包（退化也要能看）", async () => {
    fs.rmSync(servicesDir, { force: true, recursive: true });
    makePack("2026-10-04_140000-bbbbbb", {
      "comfyui-runtime-20261004-140000.log": "上一包\n",
    });

    const { data } = await get("source=comfyui-runtime");
    expect(data.sessions.map((s) => s.scope)).toEqual(["runs"]);
    expect(data.content).toBe("上一包\n");
  });

  /* 脏 id（客户端缓存过、或人手敲的）不许拿去拼路径 —— 形态判据在
   * `parsePackScopedId`，端点只回落最新那一份。 */
  it("畸形 / 穿越形态的 id 一律回落最新那一份（不拿它拼路径）", async () => {
    makeFile("comfyui-runtime-20261005-093612.log", "本次\n");
    for (const dirty of [
      "../../../etc/passwd",
      "not-a-pack/x.log",
      "a/b/c.log",
      "2026-10-04_140000-bbbbbb/",
    ]) {
      const { data, status } = await get(
        `source=comfyui-runtime&session=${encodeURIComponent(dirty)}`,
      );
      expect(status).toBe(200);
      expect(data.selectedId).toBe("comfyui-runtime-20261005-093612.log");
      expect(data.content).toBe("本次\n");
    }
  });

  it("`.zip` 形态的包不列（读它要解压，列进来只会得到一堆点开就报错的项）", async () => {
    fs.mkdirSync(runsDir, { recursive: true });
    fs.writeFileSync(path.join(runsDir, "2026-10-04_140000-bbbbbb.zip"), "PK", "utf8");
    makeFile("comfyui-runtime-20261005-093612.log", "本次\n");

    const { data } = await get("source=comfyui-runtime");
    expect(data.sessions.map((s) => s.id)).toEqual(["comfyui-runtime-20261005-093612.log"]);
  });
});
