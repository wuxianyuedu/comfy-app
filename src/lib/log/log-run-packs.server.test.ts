/**
 * 「运行包」的**服务端 IO** 判据（ISSUE #1326，用户原话「保留跨包翻转」）。
 *
 * 这一层只做两件必须碰磁盘的事：列 `runs/` 下的包、读每个包里该来源的份。
 * 守的是三条「漂开就静默出错」的契约：
 *   1. **只列有这个来源的份的包**：一台机器上 ComfyUI 可能一直没装，把那几次
 *      运行列进下拉、点开每一项都是空窗口 —— 那不是历史，是噪声；
 *   2. **包里只认本来源的份**：一个目录里四个来源并存，按名字过滤；
 *   3. **路径不由本模块拼**：调用方从 `run.mjs` 取 `runs/`（归档写方的唯一定义），
 *      本模块只接受传进来的目录。
 *
 * 用例全部在自己的临时目录里跑（硬规则 17：测试不许碰仓库的 log/）。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { scanRunPacks } from "./log-run-packs.server";

let root: string;
let runs: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "log-run-packs-"));
  runs = path.join(root, "log", "runs");
  fs.mkdirSync(runs, { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { force: true, recursive: true });
});

type PackSpec = {
  crashed?: boolean;
  files?: Record<string, string>;
  /** 不写 `run.json`（模拟被截断 / 手工搬进来的包）。 */
  noRunJson?: boolean;
};

/**
 * 造一个运行包（目录名与 `run.mjs` 的 `runDirName` 同形）。
 *
 * 夹具按**真实归档形态**造：`services/` 下是命名规则的份、`run.json` 是收尾补全
 * 的那一份。不直接构造一个「只有几个字段」的假对象 —— 那样用例是自证的。
 */
function makePack(name: string, spec: PackSpec = {}): void {
  const dir = path.join(runs, name);
  const svc = path.join(dir, "services");
  fs.mkdirSync(svc, { recursive: true });
  for (const [file, content] of Object.entries(spec.files ?? {})) {
    fs.writeFileSync(path.join(svc, file), content, "utf8");
  }
  if (spec.noRunJson) {
    return;
  }
  fs.writeFileSync(
    path.join(dir, "run.json"),
    JSON.stringify({
      crashed: spec.crashed === true,
      runId: name.slice(name.lastIndexOf("-") + 1),
      startedAt: new Date(2026, 9, 4, 14, 0, 0).toISOString(),
    }),
    "utf8",
  );
}

/** 调被测函数（参数与端点那一侧同形）。 */
async function scan(
  source: Parameters<typeof scanRunPacks>[0]["source"] = "comfyui-runtime",
  maxPacks = 50,
) {
  return scanRunPacks({
    maxPacks,
    runJsonName: "run.json",
    runsDir: runs,
    source,
    sourceDir: "services",
  });
}

describe("列包", () => {
  it("runs/ 还不存在（从没正常退出过）→ 空列表，不是错误", async () => {
    fs.rmSync(runs, { force: true, recursive: true });
    expect(await scan()).toEqual({ packs: [], total: 0 });
  });

  it("按名字升序 = 时间序（新→旧由调用方翻转，本层给时间序）", async () => {
    makePack("2026-10-04_140000-bbbbbb", {
      files: { "comfyui-runtime-20261004-140000.log": "b\n" },
    });
    makePack("2026-09-30_193612-a1b2c3", {
      files: { "comfyui-runtime-20260930-193612.log": "a\n" },
    });

    const { packs } = await scan();
    expect(packs.map((p) => p.name)).toEqual([
      "2026-10-04_140000-bbbbbb",
      "2026-09-30_193612-a1b2c3",
    ]);
  });

  it("**没有该来源的份的包不列**（那次运行没启动过这个服务）", async () => {
    makePack("2026-10-04_140000-bbbbbb", {
      files: { "comfyui-runtime-20261004-140000.log": "有\n" },
    });
    makePack("2026-10-03_100000-aaaaaa", {
      files: { "ollama-runtime-20261003-100000.log": "别的来源\n" },
    });

    const { packs, total } = await scan();
    expect(packs.map((p) => p.name)).toEqual(["2026-10-04_140000-bbbbbb"]);
    expect(total).toBe(1);
  });

  it("只列本来源的份（一个包里四个来源并存）", async () => {
    makePack("2026-10-04_140000-bbbbbb", {
      files: {
        "app-runtime-20261004-140002.log": "app\n",
        "comfyui-runtime-20261004-140000.log": "comfy\n",
        "ollama-runtime-20261004-140001.log": "ollama\n",
      },
    });

    const { packs } = await scan();
    expect(packs[0]!.files.map((f) => f.name)).toEqual(["comfyui-runtime-20261004-140000.log"]);
  });

  it("不认的日志文件不列（同目录里的 keepalive 之类）", async () => {
    makePack("2026-10-04_140000-bbbbbb", {
      files: {
        "comfyui-keepalive-2026-10-04.out.log": "keepalive\n",
        "comfyui-runtime-20261004-140000.log": "comfy\n",
      },
    });

    const { packs } = await scan();
    expect(packs[0]!.files.map((f) => f.name)).toEqual(["comfyui-runtime-20261004-140000.log"]);
  });

  it("包内多份按时间序（旧→新）给，同秒分叉也在", async () => {
    makePack("2026-10-04_140000-bbbbbb", {
      files: {
        "comfyui-runtime-20261004-140001-2.log": "同秒第二次\n",
        "comfyui-runtime-20261004-140001.log": "第一次\n",
        "comfyui-runtime-20261004-140003.log": "第三次\n",
      },
    });

    const { packs } = await scan();
    expect(packs[0]!.files.map((f) => f.name)).toEqual([
      "comfyui-runtime-20261004-140001.log",
      "comfyui-runtime-20261004-140001-2.log",
      "comfyui-runtime-20261004-140003.log",
    ]);
  });

  it("迁移前的旧固定名也列（排最前 —— 「更早」是对它的定义）", async () => {
    makePack("2026-10-04_140000-bbbbbb", {
      files: {
        "comfyui-runtime-20261004-140000.log": "新的\n",
        "comfyui-runtime.log": "迁移前的全部\n",
      },
    });

    const { packs } = await scan();
    expect(packs[0]!.files.map((f) => f.name)).toEqual([
      "comfyui-runtime.log",
      "comfyui-runtime-20261004-140000.log",
    ]);
    expect(packs[0]!.files[0]!.startedAt).toBeNull();
  });
});

describe("包的元信息（run.json）", () => {
  it("crashed 如实带出来（崩溃现场最该看，界面要标）", async () => {
    makePack("2026-10-04_140000-bbbbbb", {
      crashed: true,
      files: { "comfyui-runtime-20261004-140000.log": "崩\n" },
    });
    expect((await scan()).packs[0]!.crashed).toBe(true);
  });

  it("startedAt 取 run.json 的（它比名字里那个更准）", async () => {
    makePack("2026-10-04_140000-bbbbbb", {
      files: { "comfyui-runtime-20261004-140000.log": "x\n" },
    });
    expect((await scan()).packs[0]!.startedAt).toBe(new Date(2026, 9, 4, 14, 0, 0).getTime());
  });

  it("坏 / 缺 run.json 不让列表带崩（crashed 退 false、时刻退名字里那个）", async () => {
    makePack("2026-10-04_140000-bbbbbb", {
      files: { "comfyui-runtime-20261004-140000.log": "x\n" },
      noRunJson: true,
    });
    const { packs } = await scan();
    expect(packs).toHaveLength(1);
    expect(packs[0]!.crashed).toBe(false);
    expect(packs[0]!.startedAt).toBe(new Date(2026, 9, 4, 14, 0, 0).getTime());
  });
});

describe("条数上限与 total", () => {
  it("只扫最近 maxPacks 个包，但 total 数的是**全部**份", async () => {
    for (const [i, day] of [1, 2, 3, 4].entries()) {
      const name = `2026-10-0${day}_140000-aaaaa${i}`;
      makePack(name, {
        files: { [`comfyui-runtime-2026100${day}-140000.log`]: "x\n" },
      });
    }
    const { packs, total } = await scan("comfyui-runtime", 2);
    expect(packs.map((p) => p.name)).toEqual([
      "2026-10-04_140000-aaaaa3",
      "2026-10-03_140000-aaaaa2",
    ]);
    /* 4 个包各 1 份 = 4 份，不受 maxPacks 影响 */
    expect(total).toBe(4);
  });
});
