// 运行态快照的判决测试（ISSUE #339）。
//
// 为什么值得单独测：这里的每一条规则都对应一次「外部明明启动了 ComfyUI，
// 设置页却显示未运行」的误报——
//   · 进程表查询超时不得当成「没在跑」；
//   · 进程活着但端口还没绑定 = 启动中，不是未运行；
//   · 解释器候选要覆盖 pythonw / standalone-env（Comfy Desktop 由 uv 起，
//     命令行里没有 main.py）；
//   · 快照有 TTL 但不长期缓存（外部刚起来的实例必须能被认出来）。
// 这些规则读代码看不出回归，只有把「事实 → 结论」钉成断言才拦得住。

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("../app-settings/app-settings.server", () => ({
  COMFYUI_DEFAULT_PORT: 8188,
  getSettingsSync: vi.fn(),
}));
vi.mock("./launch-path", () => ({ resolveComfyLaunchPlan: vi.fn() }));
vi.mock("./instance-kind", () => ({ classifyComfyInstall: vi.fn() }));
vi.mock("./proc-detect", () => ({
  findPidForMainPyDetailed: vi.fn(),
  findPidListeningPort: vi.fn(),
}));
vi.mock("./env-python", () => ({ collectComfyPythonCandidates: vi.fn() }));
/* 「配置端口抢跑」用的直连探测：测试里默认「没人应答」，避免真发 HTTP。
 * 需要它的用例（端口抢跑）自行改 mock 返回值。
 *
 * `/probe` 与 `./client` 分别 mock：`probeComfyAtPort` 是零依赖叶子（§12.7 断环时
 * 从 `client.ts` 下沉出去），而 status 只经它取「已知端口是否应答」。 */
vi.mock("./probe", () => ({
  probeComfyAtPort: vi.fn(async () => null),
}));
vi.mock("./client", () => ({
  probeComfyBase: vi.fn(async () => null),
  resolveComfyBase: vi.fn(async () => "http://127.0.0.1:8188"),
  resetComfyBase: vi.fn(),
}));
vi.mock("~/lib/core/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  getComfyRuntimeSnapshot,
  resetComfyRuntimeSnapshot,
  setBoundChildPidReader,
  launcherCommandCandidates,
  readRegisteredLauncher,
  COMFY_SNAPSHOT_TTL_MS,
  COMFY_UNBOUND_PORT_TTL_MS,
} from "./status";
import { getSettingsSync } from "../app-settings/app-settings.server";
import { resolveComfyLaunchPlan } from "./launch-path";
import { classifyComfyInstall } from "./instance-kind";
import { findPidForMainPyDetailed, findPidListeningPort } from "./proc-detect";
import { collectComfyPythonCandidates } from "./env-python";
import { probeComfyAtPort } from "./probe";

const plan = {
  cmd: "C:\\Comfy\\python_embeded\\python.exe",
  baseArgs: ["-s", "C:\\Comfy\\main.py"],
  cwd: "C:\\Comfy",
  mainPy: "C:\\Comfy\\main.py",
};

beforeEach(() => {
  vi.mocked(getSettingsSync).mockReturnValue({
    comfyuiPath: "C:\\Comfy",
    comfyuiPort: 0,
  } as never);
  vi.mocked(resolveComfyLaunchPlan).mockReturnValue(plan);
  vi.mocked(classifyComfyInstall).mockReturnValue({
    kind: "portable",
    instanceRoot: "C:\\Comfy",
    instanceIdFile: null,
  } as never);
  vi.mocked(findPidForMainPyDetailed).mockResolvedValue({
    pid: null,
    failed: false,
  });
  vi.mocked(findPidListeningPort).mockResolvedValue(null);
  vi.mocked(collectComfyPythonCandidates).mockReturnValue([]);
  // 快照挂在 globalThis（HMR 单例）+ mock 调用历史都是跨用例共享的：
  // 逐用例重置，否则「未调用」类断言会被上一个用例的调用污染。
  vi.clearAllMocks();
  /* clearAllMocks 也会清掉工厂里写的实现（返回 undefined），所以「配置端口
   * 抢跑」的直连探测必须在清完**之后**重新钉成「没人应答」——否则
   * resolvePortFast 会拿到 undefined，把「进程在跑」的实例当成没端口。 */
  vi.mocked(probeComfyAtPort).mockResolvedValue(null);
  resetComfyRuntimeSnapshot();
  setBoundChildPidReader(() => null);
});

afterEach(() => {
  setBoundChildPidReader(() => null);
});

describe("getComfyRuntimeSnapshot — 外部实例也要认出来", () => {
  it("配置路径进程表命中即「在跑」，并带出监听端口", async () => {
    vi.mocked(findPidForMainPyDetailed).mockResolvedValue({
      pid: 4242,
      failed: false,
    });
    vi.mocked(findPidListeningPort).mockResolvedValue(8188);
    const snap = await getComfyRuntimeSnapshot({ force: true });
    expect(snap.running).toBe(true);
    expect(snap.pid).toBe(4242);
    expect(snap.port).toBe(8188);
    expect(snap.source).toBe("process");
    expect(snap.unverified).toBe(false);
  });

  it("进程表查询失败（超时/高负载）→ unverified，绝不当成「没在跑」", async () => {
    vi.mocked(findPidForMainPyDetailed).mockResolvedValue({
      pid: null,
      failed: true,
    });
    const snap = await getComfyRuntimeSnapshot({ force: true });
    expect(snap.running).toBe(false);
    expect(snap.unverified).toBe(true);
  });

  it("解释器候选落空但 setup 登记的启动器命中（Comfy Desktop / uv 起法）", async () => {
    // 主 main.py 查询成功返回「没有」，登记的启动器命中。
    vi.mocked(findPidForMainPyDetailed).mockImplementation(
      async (needle: string) =>
        needle.includes("uv.exe")
          ? { pid: 777, failed: false }
          : { pid: null, failed: false },
    );
    vi.mocked(findPidListeningPort).mockResolvedValue(8190);
    // 把登记启动器伪装成 uv.exe：用一个真实存在的小文件承载 .comfy-cli 内容。
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comfycli-"));
    const cliDir = path.join(dir, ".venv", "Lib", "site-packages", "comfy_cli");
    fs.mkdirSync(cliDir, { recursive: true });
    fs.writeFileSync(
      path.join(cliDir, ".comfy-cli"),
      JSON.stringify({ setup: { cmds: '"C:\\\\uv\\\\uv.exe" run main.py' } }),
      "utf8",
    );
    vi.mocked(getSettingsSync).mockReturnValue({
      comfyuiPath: dir,
      comfyuiPort: 0,
    } as never);
    vi.mocked(resolveComfyLaunchPlan).mockReturnValue({
      ...plan,
      mainPy: path.join(dir, "main.py"),
    });
    vi.mocked(classifyComfyInstall).mockReturnValue({
      kind: "desktop",
      instanceRoot: dir,
      instanceIdFile: null,
    } as never);

    const snap = await getComfyRuntimeSnapshot({ force: true });
    expect(snap.running).toBe(true);
    expect(snap.source).toBe("launcher");
    expect(snap.via).toContain("启动器");
  });

  it("第 5 级：按 standalone-env 的 pyvenv.cfg 反查出解释器进程（Desktop / uv 起法）", async () => {
    // 配置路径的 main.py、setup 登记启动器、实例根解释器候选**全部落空**，
    // 只有环境反查给出的 uv 托管解释器命中——这正是 ISSUE #344 里
    // 「外部实例在跑、状态行却压着不动」的那类实例。
    const uvExe =
      "C:\\Users\\me\\AppData\\Local\\uv\\python\\cpython-3.12.8\\python.exe";
    vi.mocked(collectComfyPythonCandidates).mockReturnValue([
      { exe: uvExe, via: "standalone-env 的 pyvenv.cfg" },
    ]);
    vi.mocked(findPidForMainPyDetailed).mockImplementation(
      async (needle: string) =>
        needle.includes("uv\\python")
          ? { pid: 888, failed: false }
          : { pid: null, failed: false },
    );
    vi.mocked(findPidListeningPort).mockResolvedValue(8188);

    const snap = await getComfyRuntimeSnapshot({ force: true });
    expect(snap.running).toBe(true);
    expect(snap.source).toBe("any");
    expect(snap.pid).toBe(888);
    expect(snap.via).toContain("pyvenv.cfg");
    expect(collectComfyPythonCandidates).toHaveBeenCalled();
  });

  it("第 5 级也要在「配置路径的 main.py 查询失败」时照常兜底", async () => {
    // main.py 那次查询超时（unverified）不能提前 return：反查命中仍应报在跑。
    vi.mocked(findPidForMainPyDetailed).mockImplementation(
      async (needle: string) =>
        needle.includes("uv.exe")
          ? { pid: 999, failed: false }
          : { pid: null, failed: true },
    );
    vi.mocked(collectComfyPythonCandidates).mockReturnValue([
      { exe: "C:\\uv\\uv.exe", via: "uv 托管的解释器" },
    ]);
    vi.mocked(findPidListeningPort).mockResolvedValue(8190);

    const snap = await getComfyRuntimeSnapshot({ force: true });
    expect(snap.running).toBe(true);
    expect(snap.source).toBe("any");
    expect(snap.unverified).toBe(false);
  });

  it("反查候选全部落空且查询都成功 → 未运行（不误报在跑）", async () => {
    vi.mocked(collectComfyPythonCandidates).mockReturnValue([
      { exe: "C:\\uv\\python.exe", via: "uv 托管的解释器" },
    ]);
    vi.mocked(findPidForMainPyDetailed).mockResolvedValue({
      pid: null,
      failed: false,
    });
    const snap = await getComfyRuntimeSnapshot({ force: true });
    expect(snap.running).toBe(false);
    expect(snap.unverified).toBe(false);
  });

  it("本进程 bound 子进程优先：不经任何进程表查询即判定在跑", async () => {
    setBoundChildPidReader(() => 31337);
    vi.mocked(findPidListeningPort).mockResolvedValue(8188);
    const snap = await getComfyRuntimeSnapshot({ force: true });
    expect(snap.running).toBe(true);
    expect(snap.source).toBe("bound");
    expect(snap.pid).toBe(31337);
    expect(findPidForMainPyDetailed).not.toHaveBeenCalled();
  });

  it("未配置路径且无 bound 子进程 → 未运行", async () => {
    vi.mocked(getSettingsSync).mockReturnValue({
      comfyuiPath: "",
      comfyuiPort: 0,
    } as never);
    const snap = await getComfyRuntimeSnapshot({ force: true });
    expect(snap.running).toBe(false);
    expect(snap.unverified).toBe(false);
  });
});

describe("配置端口抢跑 — 不让 Get-NetTCPConnection 一个人占满首屏", () => {
  it("配置端口已应答 → 不等权威端口查询返回，直接采信配置端口", async () => {
    // 主场景：实例就在配置端口上跑。权威查询（Get-NetTCPConnection，本机
    // ~2.5s）很慢，但配置端口毫秒级就有应答 —— 抢先给出结论，
    // 「设置页打开要等一会」里被白等的那段就是它。
    vi.mocked(getSettingsSync).mockReturnValue({
      comfyuiPath: "C:\\Comfy",
      comfyuiPort: 8188,
    } as never);
    vi.mocked(findPidForMainPyDetailed).mockResolvedValue({
      pid: 4242,
      failed: false,
    });
    vi.mocked(probeComfyAtPort).mockResolvedValue("http://127.0.0.1:8188");
    vi.mocked(findPidListeningPort).mockImplementation(
      () => new Promise((r) => setTimeout(() => r(8188), 5000)),
    );

    const t0 = Date.now();
    const snap = await getComfyRuntimeSnapshot({ force: true });
    const dt = Date.now() - t0;

    expect(snap.running).toBe(true);
    expect(snap.port).toBe(8188);
    // 没有被那个 5s 的权威查询拖住。
    expect(dt).toBeLessThan(2000);
  });

  it("配置端口没人应答 → 仍以权威查询为准（不猜、不误报端口）", async () => {
    vi.mocked(getSettingsSync).mockReturnValue({
      comfyuiPath: "C:\\Comfy",
      comfyuiPort: 8188,
    } as never);
    vi.mocked(findPidForMainPyDetailed).mockResolvedValue({
      pid: 4242,
      failed: false,
    });
    // 实例偏移到了 8190，配置端口上没人应答。
    vi.mocked(probeComfyAtPort).mockResolvedValue(null);
    vi.mocked(findPidListeningPort).mockResolvedValue(8190);

    const snap = await getComfyRuntimeSnapshot({ force: true });
    expect(snap.running).toBe(true);
    expect(snap.port).toBe(8190);

    vi.mocked(probeComfyAtPort).mockResolvedValue(null);
    vi.mocked(findPidListeningPort).mockResolvedValue(null);
  });
});

describe("配置端口只探一次 — 失败路径不重复付超时", () => {
  it("步骤 1.5 探过配置端口且无人应答后，定位端口不再重探", async () => {
    // 这一条拦的是「同一件事问两遍」的回归：`snapshotOnce` 的步骤 1.5 已经探过
    // 配置端口，`resolvePortFast` 若再探一次，失败路径每次都要等满 1.5s 超时
    // ——「没在跑」这个主场景下就是白加一整条链（ISSUE #346 的耗时代价）。
    vi.mocked(getSettingsSync).mockReturnValue({
      comfyuiPath: "C:\Comfy",
      comfyuiPort: 8188,
    } as never);
    // 进程表命中，但配置端口没人应答（实例在别处 / 还没绑端口）。
    vi.mocked(findPidForMainPyDetailed).mockResolvedValue({
      pid: 4242,
      failed: false,
    });
    vi.mocked(probeComfyAtPort).mockResolvedValue(null);
    vi.mocked(findPidListeningPort).mockResolvedValue(8190);

    const snap = await getComfyRuntimeSnapshot({ force: true });
    expect(snap.port).toBe(8190);
    // 整条快照里配置端口只被探过一次（步骤 1.5 那次）。
    expect(vi.mocked(probeComfyAtPort).mock.calls.length).toBe(1);
  });

  it("bound 子进程路径没有预探结论，仍需探一次配置端口抢跑", async () => {
    // bound 分支在步骤 1.5 之前就返回了，没有现成结论 —— 抢跑必须照常做，
    // 否则「本应用自己拉起的实例」就会退化成都等权威查询。
    setBoundChildPidReader(() => 4242);
    try {
      vi.mocked(getSettingsSync).mockReturnValue({
        comfyuiPath: "C:\Comfy",
        comfyuiPort: 8188,
      } as never);
      vi.mocked(probeComfyAtPort).mockResolvedValue("http://127.0.0.1:8188");
      vi.mocked(findPidListeningPort).mockResolvedValue(8188);

      const snap = await getComfyRuntimeSnapshot({ force: true });
      expect(snap.source).toBe("bound");
      expect(snap.port).toBe(8188);
      expect(vi.mocked(probeComfyAtPort).mock.calls.length).toBe(1);
    } finally {
      setBoundChildPidReader(() => null);
    }
  });
});

describe("快照缓存 — 便宜但不失时效", () => {
  it("TTL 内复用同一结果，不在途重复查进程表", async () => {
    // 已绑定端口的「在跑」结论才允许缓存：它不会在下一秒变成别的结论。
    vi.mocked(findPidForMainPyDetailed).mockResolvedValue({
      pid: 1,
      failed: false,
    });
    vi.mocked(findPidListeningPort).mockResolvedValue(8188);
    await getComfyRuntimeSnapshot({ force: true });
    const calls = vi.mocked(findPidForMainPyDetailed).mock.calls.length;
    await getComfyRuntimeSnapshot();
    expect(vi.mocked(findPidForMainPyDetailed).mock.calls.length).toBe(calls);
  });

  it("「进程在但端口未绑定」的快照不缓存：状态行必须能立刻翻成「运行中」", async () => {
    // 这条对应 ISSUE #344 的「ComfyUI 早就启动了，设置界面还是显示启动中」：
    // 端口未绑定是「正在启动」的中间态，下一步就是绑定端口 —— 缓存它会
    // 把状态行按在「启动中」上不动。
    vi.mocked(findPidForMainPyDetailed).mockResolvedValue({
      pid: 1,
      failed: false,
    });
    vi.mocked(findPidListeningPort).mockResolvedValue(null);
    const first = await getComfyRuntimeSnapshot({ force: true });
    expect(first.running).toBe(true);
    expect(first.port).toBeNull();
    // 复取必须重新查事实，而不是沿用「还没有端口」的旧结论。
    vi.mocked(findPidListeningPort).mockResolvedValue(8189);
    const second = await getComfyRuntimeSnapshot();
    expect(second.port).toBe(8189);
  });

  it("force 绕过 TTL：外部刚启动的实例立刻能被认出来", async () => {
    vi.mocked(findPidForMainPyDetailed).mockResolvedValue({
      pid: null,
      failed: false,
    });
    const first = await getComfyRuntimeSnapshot({ force: true });
    expect(first.running).toBe(false);
    vi.mocked(findPidForMainPyDetailed).mockResolvedValue({
      pid: 99,
      failed: false,
    });
    const second = await getComfyRuntimeSnapshot({ force: true });
    expect(second.running).toBe(true);
  });

  it("TTL 很短（秒级）：不会长时间沿用旧结论", () => {
    expect(COMFY_SNAPSHOT_TTL_MS).toBeLessThanOrEqual(3_000);
  });

  it("「启动中」快照的 TTL 比普通 TTL 更短（不缓存）", () => {
    expect(COMFY_UNBOUND_PORT_TTL_MS).toBeLessThan(COMFY_SNAPSHOT_TTL_MS);
  });
});

describe("候选查询并发化 — 冷启动等待不叠成 N 倍（ISSUE #339 残留延迟）", () => {
  it("多个候选的进程表查询**同时**发出，而不是一个个排队", async () => {
    // 命中场景：配置路径的 main.py 落空，setup 登记的启动器与环境反查都要试。
    // 串行实现里这三个查询会排队相加（每个 PowerShell 枚举 ~2.5s，三个就是
    // 7s+），用户看到的正是「ComfyUI 已经启动了，打开设置页还要等一会」。
    // 这里用一个「记录并发峰值」的桩把这件事钉住：峰值必须 > 1。
    let inFlight = 0;
    let peak = 0;
    vi.mocked(getSettingsSync).mockReturnValue({
      comfyuiPath: "C:\\Comfy",
      comfyuiPort: 0,
    } as never);
    vi.mocked(findPidForMainPyDetailed).mockImplementation(
      async (needle: string) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        // 每个查询都「慢」一拍，串行实现下峰值只能是 1。
        await new Promise((r) => setTimeout(r, 20));
        inFlight -= 1;
        // 只有最后一个候选命中：前面几级都必须问过，判据链才完整。
        return needle.includes("pythonw")
          ? { pid: 4321, failed: false }
          : { pid: null, failed: false };
      },
    );
    vi.mocked(findPidListeningPort).mockResolvedValue(8188);

    const snap = await getComfyRuntimeSnapshot({ force: true });
    expect(snap.running).toBe(true);
    expect(snap.pid).toBe(4321);
    expect(peak).toBeGreaterThan(1);
  });

  it("几路同时命中时，仍按候选声明顺序取第一个（顺序语义不变）", async () => {
    let call = 0;
    vi.mocked(getSettingsSync).mockReturnValue({
      comfyuiPath: "C:\\Comfy",
      comfyuiPort: 0,
    } as never);
    vi.mocked(findPidForMainPyDetailed).mockImplementation(async () => {
      call += 1;
      // 让**后**发出的请求先返回：并发实现若按「谁先返回」取结论，
      // 这里就会取到错误的那一个。
      const delay = call === 1 ? 40 : 5;
      await new Promise((r) => setTimeout(r, delay));
      return { pid: 100 + call, failed: false };
    });
    vi.mocked(findPidListeningPort).mockResolvedValue(8190);

    const snap = await getComfyRuntimeSnapshot({ force: true });
    // 第一个候选是配置路径的 main.py（声明顺序里最先），必须先取它。
    expect(snap.pid).toBe(101);
    expect(snap.via).toBe("配置路径的实例");
  });
});

describe("launcherCommandCandidates — 覆盖 pythonw 与桌面 standalone-env", () => {
  it("同一环境目录内枚举 pythonw / python / 原解释器", () => {
    const exe = path.join("comfy", "python_embeded", "python.exe");
    const dir = path.dirname(exe);
    const list = launcherCommandCandidates(exe);
    // 同目录内枚举 pythonw / python，并带上原解释器；重复项已去重。
    expect(list).toContain(exe);
    expect(new Set(list).size).toBe(list.length);
    expect(list.length).toBeGreaterThan(1);
    expect(list.some((c) => c.startsWith(dir) && c.includes("pythonw"))).toBe(
      true,
    );
  });
});

describe("readRegisteredLauncher — 读不到就静默返回 null", () => {
  it("路径不存在 → null", () => {
    expect(
      readRegisteredLauncher(path.join(os.tmpdir(), "definitely-missing-xyz")),
    ).toBeNull();
  });
});

/* ── 「这次到底查过进程表没有」（ISSUE #442）──────────────────────────
 * 上层把「快照没命中」读成「未运行」的证据，前提是**确实问过**。而
 * 「0 条候选」（配置路径存在但推不出任何解释器候选）与「查过但失败」
 * 在旧字段下长得一模一样（running=false, unverified=false），于是一次
 * 什么都不代表空的快照被当成事实，状态行跟着闪回「未运行」。
 * 这两条把新字段的语义钉住。 */
describe("didQueryProcTable — 区分「查过没命中」与「根本没查」", () => {
  it("进程表命中（配置路径的实例）→ 查过", async () => {
    vi.mocked(findPidForMainPyDetailed).mockResolvedValue({
      pid: 4242,
      failed: false,
    });
    vi.mocked(findPidListeningPort).mockResolvedValue(8188);
    const snap = await getComfyRuntimeSnapshot({ force: true });
    expect(snap.didQueryProcTable).toBe(true);
  });

  it("查了但都没命中 → 仍是「查过」（这是可信的「不在跑」）", async () => {
    vi.mocked(collectComfyPythonCandidates).mockReturnValue([
      { exe: "C:\\uv\\python.exe", via: "uv 托管的解释器" },
    ]);
    vi.mocked(findPidForMainPyDetailed).mockResolvedValue({
      pid: null,
      failed: false,
    });
    const snap = await getComfyRuntimeSnapshot({ force: true });
    expect(snap.running).toBe(false);
    expect(snap.unverified).toBe(false);
    expect(snap.didQueryProcTable).toBe(true);
  });

  it("一条候选都没有（没得查）→ 没查过，上层不得据此报「未运行」", async () => {
    // 配置路径存在，但 plan 解析失败、没有登记启动器、环境反查也拿不到解释器。
    vi.mocked(resolveComfyLaunchPlan).mockReturnValue({ error: "路径不存在" });
    vi.mocked(classifyComfyInstall).mockReturnValue({
      kind: "unknown",
      instanceRoot: null,
      instanceIdFile: null,
    } as never);
    vi.mocked(collectComfyPythonCandidates).mockReturnValue([]);
    const snap = await getComfyRuntimeSnapshot({ force: true });
    expect(snap.running).toBe(false);
    expect(snap.unverified).toBe(false);
    expect(snap.didQueryProcTable).toBe(false);
  });

  it("本进程 bound 子进程也算查过（它是最强的那条事实）", async () => {
    setBoundChildPidReader(() => 31337);
    vi.mocked(findPidListeningPort).mockResolvedValue(8188);
    const snap = await getComfyRuntimeSnapshot({ force: true });
    expect(snap.didQueryProcTable).toBe(true);
  });
});

/* ── 配置端口已应答：跳过整条进程表判据链（ISSUE #553）───────────────
 * 一个只认 localhost 的实例如果**真的**在跑，它监听的端口已经把这个事实
 * 答出来了。此时再去枚举 Win32_Process 与 uv 托管目录，换来的是同一句
 * 「在跑」，代价却是冷启动高负载下的秒级等待——而这正是「启动一次要等很久」
 * 里最不该付的那一段。反过来，端口上没人应答才是「没在跑」的主场景，
 * 进程表与端口扫描此时必须照跑（否则外部实例的端口偏移会被漏掉）。
 */
describe("配置端口已应答 → 直接判「在跑」，不再枚举进程表", () => {
  it("端口有人应答即命中，且一次进程表查询都不发", async () => {
    vi.mocked(probeComfyAtPort).mockResolvedValue("http://127.0.0.1:8188");
    const snap = await getComfyRuntimeSnapshot({ force: true });
    expect(snap.running).toBe(true);
    expect(snap.port).toBe(8188);
    expect(snap.source).toBe("port");
    expect(snap.unverified).toBe(false);
    // 「端口有人应答」是比进程表更强的证据，不必再问一遍进程
    expect(findPidForMainPyDetailed).not.toHaveBeenCalled();
    expect(collectComfyPythonCandidates).not.toHaveBeenCalled();
    // 上层据此把「没命中」坐实成「未运行」是安全的：这次结论不是「没得查」
    expect(snap.didQueryProcTable).toBe(true);
  });

  it("端口没人应答 → 照旧走完整条判据链（不因快路径漏掉端口偏移的实例）", async () => {
    vi.mocked(probeComfyAtPort).mockResolvedValue(null);
    vi.mocked(findPidForMainPyDetailed).mockResolvedValue({
      pid: 4242,
      failed: false,
    });
    vi.mocked(findPidListeningPort).mockResolvedValue(8190);
    const snap = await getComfyRuntimeSnapshot({ force: true });
    expect(snap.running).toBe(true);
    expect(snap.port).toBe(8190);
    expect(snap.source).toBe("process");
    expect(findPidForMainPyDetailed).toHaveBeenCalled();
  });

  it("配置里显式写了端口时，快路径问的就是那个端口", async () => {
    vi.mocked(getSettingsSync).mockReturnValue({
      comfyuiPath: "C:\\Comfy",
      comfyuiPort: 9000,
    } as never);
    vi.mocked(probeComfyAtPort).mockResolvedValue("http://127.0.0.1:9000");
    const snap = await getComfyRuntimeSnapshot({ force: true });
    expect(probeComfyAtPort).toHaveBeenCalledWith(9000);
    expect(snap.port).toBe(9000);
  });
});
