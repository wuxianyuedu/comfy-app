/**
 * setting.router 的闸门用例（台账 A5 那条口径在这里复算）。
 *
 * 这个路由是「设置页背后那台机器」的入口：它写的每一项都会变成**本机副作用**
 * （启动参数、解释器路径、端口、闩锁），它也有一个直接把地址交给系统浏览器的
 * 出口。所以用例按三条线组织，而不是按 procedure 顺序铺：
 *  1. **拒绝必须发生在写之前 / spawn 之前** —— 端口越界、协议不对时，
 *     `saveSettings` 与 `spawn` 一次都不许被调用；
 *  2. **协议白名单收成一处后的两个方向** —— `HTTPS://x` 不再被误拒、
 *     `http://␣␣` 不再被误放行（旧的前缀正则两个方向都错）；
 *  3. **闩锁的清除条件**（`comfyuiAutoStart:true` / 改了路径或启动参数）——
 *     这是 ISSUE #290 / #335 那两条「用户修好了却因为老闩锁不重试」的判据。
 *
 * mock 边界：`~/lib/app-settings/app-settings.server`、`~/lib/comfyui/lifecycle`、
 * `~/lib/comfyui/instance-kind`、`~/lib/drizzle-studio/lifecycle`（本机进程与配置的
 * 真实副作用一律不进用例）、`~/lib/comfy/comfy-embed` 的 `probeComfyEmbeddable`
 * 一条（探测要发真实 HTTP，其余成员走真实实现）。
 * **`~/lib/shell/open-in-browser` 不 mock，只 mock `child_process`** —— 这样
 * `openExternal` 这一条测的是「路由没有绕开地基那道闸」，而不是「路由调到了地基」。
 */
import type * as ComfyEmbedModule from "~/lib/comfy/comfy-embed";
import { describe, expect, it, vi, beforeEach } from "vitest";

const {
  spawnMock,
  probeMock,
  getSettingsMock,
  getSettingsSyncMock,
  saveSettingsMock,
  clearManualStopMock,
  clearAutoStartFailureMock,
  ensureReadyMock,
  statusMock,
  openComfyMock,
  stopComfyMock,
  describeInstanceMock,
  studioProbeMock,
  studioStartingMock,
  studioEnsureMock,
  studioStopMock,
  studioOpenMock,
} = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  probeMock: vi.fn<() => Promise<{ embeddable: boolean; reason: string }>>(
    async () => ({ embeddable: true, reason: "ok" }),
  ),
  getSettingsMock: vi.fn<() => Promise<Record<string, unknown>>>(async () => ({
    comfyuiPort: 8188,
    comfyuiPath: "",
  })),
  getSettingsSyncMock: vi.fn<() => Record<string, unknown>>(() => ({
    comfyuiPort: 8188,
    comfyuiPath: "C:/ComfyUI",
    comfyuiAutoStart: true,
  })),
  saveSettingsMock: vi.fn<
    (partial: Record<string, unknown>) => Promise<Record<string, unknown>>
  >(async (partial) => ({ comfyuiPort: 8188, ...partial })),
  clearManualStopMock: vi.fn<() => void>(),
  clearAutoStartFailureMock: vi.fn<() => void>(),
  ensureReadyMock: vi.fn<() => Promise<{ ok: boolean; detail: string }>>(
    async () => ({ ok: true, detail: "已就绪" }),
  ),
  statusMock: vi.fn<() => Promise<Record<string, unknown>>>(async () => ({
    up: true,
    base: "http://127.0.0.1:8188",
    starting: false,
    probing: false,
    stopping: false,
    port: null,
    via: "external",
  })),
  openComfyMock: vi.fn<() => Promise<{ ok: boolean; detail: string }>>(
    async () => ({ ok: true, detail: "已打开" }),
  ),
  stopComfyMock: vi.fn<() => Promise<{ ok: boolean }>>(async () => ({
    ok: true,
  })),
  describeInstanceMock: vi.fn<() => { kind: string }>(() => ({
    kind: "portable",
  })),
  studioProbeMock: vi.fn<(port: number) => Promise<boolean>>(async () => true),
  studioStartingMock: vi.fn<() => boolean>(() => false),
  studioEnsureMock: vi.fn<() => Promise<{ ok: boolean }>>(async () => ({
    ok: true,
  })),
  studioStopMock: vi.fn<() => Promise<{ ok: boolean }>>(async () => ({
    ok: true,
  })),
  studioOpenMock: vi.fn<() => Promise<{ ok: boolean }>>(async () => ({
    ok: true,
  })),
}));

vi.mock("~/server/db", async () => {
  const { createTestDb } = await import("../../../../tests/helpers/test-db");
  return { db: createTestDb() };
});
vi.mock("~/server/better-auth", () => ({
  auth: { api: { getSession: vi.fn(async () => null) } },
}));
vi.mock("child_process", () => ({ spawn: spawnMock }));
vi.mock("~/lib/app-settings/app-settings.server", () => ({
  getSettings: getSettingsMock,
  getSettingsSync: getSettingsSyncMock,
  saveSettings: saveSettingsMock,
}));
vi.mock("~/lib/comfyui/lifecycle", () => ({
  clearComfyAutoStartFailure: clearAutoStartFailureMock,
  clearComfyManualStop: clearManualStopMock,
  ensureComfyUiReady: ensureReadyMock,
  getComfyUiStatus: statusMock,
  openComfyUi: openComfyMock,
  stopComfyUiProcess: stopComfyMock,
}));
vi.mock("~/lib/comfyui/instance-kind", () => ({
  describeComfyInstance: describeInstanceMock,
}));
vi.mock("~/lib/drizzle-studio/lifecycle", () => ({
  ensureDrizzleStudioUp: studioEnsureMock,
  isDrizzleStudioStarting: studioStartingMock,
  openDrizzleStudio: studioOpenMock,
  probeDrizzleStudio: studioProbeMock,
  stopDrizzleStudio: studioStopMock,
  DRIZZLE_STUDIO_DEFAULT_PORT: 3210,
}));
vi.mock("~/lib/comfy/comfy-embed", async (importOriginal) => ({
  ...(await importOriginal<typeof ComfyEmbedModule>()),
  probeComfyEmbeddable: probeMock,
}));

import { createCallerFactory } from "~/server/api/trpc";
import { settingRouter } from "~/server/api/routers/setting";
import { getTestDb } from "../../../../tests/helpers/test-db";
import { makeCtx } from "../../../../tests/helpers/trpc";

const createCaller = createCallerFactory(settingRouter);
const tdb = getTestDb();

/** 假子进程：注册完就延一拍发 `spawn`（= 命令已交给 OS）。 */
function installFakeChild() {
  const handlers: Record<string, ((...a: unknown[]) => void)[]> = {};
  spawnMock.mockImplementation(() => {
    const handle = {
      on: (ev: string, cb: (...a: unknown[]) => void) => {
        (handlers[ev] ??= []).push(cb);
      },
      unref: vi.fn(),
      kill: vi.fn(),
    };
    setTimeout(() => {
      for (const cb of handlers.spawn ?? []) cb();
    }, 0);
    return handle;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  installFakeChild();
  tdb.$reset();
  getSettingsMock.mockResolvedValue({ comfyuiPort: 8188, comfyuiPath: "" });
  getSettingsSyncMock.mockReturnValue({
    comfyuiPort: 8188,
    comfyuiPath: "C:/ComfyUI",
    comfyuiAutoStart: true,
  });
  saveSettingsMock.mockImplementation(async (partial) => ({
    comfyuiPort: 8188,
    ...partial,
  }));
  probeMock.mockResolvedValue({ embeddable: true, reason: "ok" });
  statusMock.mockResolvedValue({
    up: true,
    base: "http://127.0.0.1:8188",
    starting: false,
    probing: false,
    stopping: false,
    port: null,
    via: "external",
  });
  studioProbeMock.mockResolvedValue(true);
  studioStartingMock.mockReturnValue(false);
});

// ────────────────────────────────────── get ──────────────────────────────────────

describe("setting.get", () => {
  it("原样回服务端设置", async () => {
    const res = await createCaller(makeCtx()).get();
    expect(res.settings).toMatchObject({ comfyuiPort: 8188 });
  });
});

// ────────────────────────────────────── save ──────────────────────────────────────

describe("setting.save", () => {
  it("合法写入：落盘一次，并回保存后重新读到的设置", async () => {
    const res = await createCaller(makeCtx()).save({ comfyuiPort: 8190 });
    expect(saveSettingsMock).toHaveBeenCalledTimes(1);
    expect(saveSettingsMock.mock.calls[0]?.[0]).toMatchObject({
      comfyuiPort: 8190,
    });
    expect(res.settings).toMatchObject({ comfyuiPort: 8188 });
  });

  /* 拒绝发生在写之前：端口这一档此前是「先写库再靠别处兜」，越界值会直接进设置文件。 */
  it.each([
    [{ comfyuiPort: -1 }],
    [{ comfyuiPort: 65536 }],
    [{ comfyuiPort: 1.5 }],
  ])("端口非法 %j → BAD_REQUEST 且一次都不写", async (input) => {
    await expect(createCaller(makeCtx()).save(input)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(saveSettingsMock).not.toHaveBeenCalled();
  });

  describe("trainerUrl 的协议白名单（判据在 ~/lib/url-scheme，两个方向都要对）", () => {
    it.each([
      [""], // 空串 = 未配置，是合法值（设置页用它清掉这一项）
      ["http://127.0.0.1:7860"],
      ["https://x.example/t"],
      // 大写协议是合法地址：旧的前缀正则大小写敏感，在这里会误拒
      ["HTTPS://x.example/t"],
    ])("%j 放行并写进设置", async (url) => {
      await createCaller(makeCtx()).save({ trainerUrl: url });
      expect(saveSettingsMock.mock.calls[0]?.[0]).toMatchObject({
        trainerUrl: url,
      });
    });

    it.each([
      ["file:///C:/Windows"],
      ["javascript:alert(1)"],
      // 前缀匹配放得行、但不是合法 URL —— 存进去之后每次连它都换回一句难查的错误
      ["http://  "],
      ["not a url"],
    ])("%j → BAD_REQUEST 且不写", async (url) => {
      await expect(
        createCaller(makeCtx()).save({ trainerUrl: url }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(saveSettingsMock).not.toHaveBeenCalled();
    });
  });

  describe("闩锁的清除条件（ISSUE #290 / #335）", () => {
    it("显式重新开启自动启动 → 清掉「手动关闭后不启动」闩锁", async () => {
      await createCaller(makeCtx()).save({ comfyuiAutoStart: true });
      expect(clearManualStopMock).toHaveBeenCalledTimes(1);
    });

    it("关掉自动启动 → 不动那个闩锁", async () => {
      await createCaller(makeCtx()).save({ comfyuiAutoStart: false });
      expect(clearManualStopMock).not.toHaveBeenCalled();
    });

    it("改了安装路径或启动参数 → 清掉「启动失败后不再重试」闩锁", async () => {
      await createCaller(makeCtx()).save({ comfyuiPath: "D:/ComfyUI" });
      expect(clearAutoStartFailureMock).toHaveBeenCalledTimes(1);
      await createCaller(makeCtx()).save({ comfyuiExtraArgs: "--foo" });
      expect(clearAutoStartFailureMock).toHaveBeenCalledTimes(2);
    });

    it("只改端口 → 不清失败闩锁（成因没变，清了就是白重试一轮）", async () => {
      await createCaller(makeCtx()).save({ comfyuiPort: 8190 });
      expect(clearAutoStartFailureMock).not.toHaveBeenCalled();
    });
  });
});

// ─────────────────────────────── openExternal ───────────────────────────────

describe("setting.openExternal —— 交给系统浏览器之前的协议闸（A5 漏网的第四个落点）", () => {
  it("http(s) 放行：URL 作为独立 argv 元素交给 spawn", async () => {
    const res = await createCaller(makeCtx()).openExternal({
      url: "https://example.com/out.mp4",
    });
    expect(res.ok).toBe(true);
    const args = spawnMock.mock.calls[0]?.[1] as string[];
    expect(args.at(-1)).toBe("https://example.com/out.mp4");
  });

  /* 这些都能过 `z.string().url()` —— 它们不是「非法 URL」，是「合法的危险协议」。
     拦在 spawn 之前才算拦住：发出去就等于本机程序已经被拉起了。 */
  it.each([
    ["file:///C:/Users/me/.env"],
    ["file:///etc/passwd"],
    ["javascript:alert(document.cookie)"],
    ["comfyapp://open?path=C:/"],
    ["search-ms:query=x"],
  ])("%j → ok:false 且一次都不 spawn", async (url) => {
    const res = await createCaller(makeCtx()).openExternal({ url });
    expect(res.ok).toBe(false);
    expect(res.detail).toContain("http/https");
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("连 URL 都不是的串 → BAD_REQUEST（与「合法但危险」是两个不同的出口）", async () => {
    await expect(
      createCaller(makeCtx()).openExternal({ url: "not a url" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(spawnMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────── comfyEmbeddable ───────────────────────────────

describe("setting.comfyEmbeddable", () => {
  it("两个地址都是 http(s) → 回探测结论与页签目标", async () => {
    const res = await createCaller(makeCtx()).comfyEmbeddable({
      base: "http://127.0.0.1:8188",
      hostOrigin: "http://127.0.0.1:3100",
    });
    expect(probeMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8188",
      "http://127.0.0.1:3100",
    );
    expect(res).toMatchObject({ embeddable: true });
    expect(res.target).toBeTruthy();
  });

  it.each([
    ["file:///C:/ComfyUI", "http://127.0.0.1:3100"],
    ["http://127.0.0.1:8188", "javascript:alert(1)"],
  ])(
    "输入层就拒非 http(s)（%j / %j），不发探测请求",
    async (base, hostOrigin) => {
      await expect(
        createCaller(makeCtx()).comfyEmbeddable({ base, hostOrigin }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(probeMock).not.toHaveBeenCalled();
    },
  );

  it("不是 URL 的串同样被拦（`.url()` 那道闸还在）", async () => {
    await expect(
      createCaller(makeCtx()).comfyEmbeddable({
        base: "127.0.0.1:8188",
        hostOrigin: "http://127.0.0.1:3100",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

// ─────────────────────────────── 状态与进程动作 ───────────────────────────────

describe("setting 的状态读与进程动作", () => {
  it("comfyStatus：结论来自 getComfyUiStatus，端口在探测无值时回落到设置项", async () => {
    const res = await createCaller(makeCtx()).comfyStatus();
    expect(res).toMatchObject({
      up: true,
      base: "http://127.0.0.1:8188",
      port: 8188,
      via: "external",
      autoStart: true,
      path: "C:/ComfyUI",
    });
  });

  it("comfyInstance 用配置里的路径做形态判定（与运行态探测分开，首屏不等端口）", async () => {
    await createCaller(makeCtx()).comfyInstance();
    expect(describeInstanceMock).toHaveBeenCalledWith("C:/ComfyUI");
  });

  it("comfyStart：manual=true（用户明确要求），超时上限由调用方给", async () => {
    const res = await createCaller(makeCtx()).comfyStart({
      timeoutMs: 60_000,
    });
    expect(ensureReadyMock).toHaveBeenCalledWith({
      timeoutMs: 60_000,
      manual: true,
    });
    expect(res).toMatchObject({ ok: true });
  });

  it("comfyStart 不给 timeoutMs 时透传 undefined（不设硬超时是有意口径）", async () => {
    await createCaller(makeCtx()).comfyStart({});
    expect(ensureReadyMock).toHaveBeenCalledWith({
      timeoutMs: undefined,
      manual: true,
    });
  });

  it("comfyStop / comfyOpen / 数据库三件事都是直委托，不改语义", async () => {
    const caller = createCaller(makeCtx());
    await caller.comfyStop();
    await caller.comfyOpen();
    await caller.dbStudioStart();
    await caller.dbStudioStop();
    await caller.dbStudioOpen();
    expect(stopComfyMock).toHaveBeenCalledTimes(1);
    expect(openComfyMock).toHaveBeenCalledTimes(1);
    expect(studioEnsureMock).toHaveBeenCalledTimes(1);
    expect(studioStopMock).toHaveBeenCalledTimes(1);
    expect(studioOpenMock).toHaveBeenCalledTimes(1);
  });

  it("dbStudioStatus：探测挂了按「未运行」降级，而不是抛错把三个按钮全禁掉（#92）", async () => {
    studioProbeMock.mockRejectedValueOnce(new Error("EACCES"));
    studioStartingMock.mockReturnValue(true);
    const res = await createCaller(makeCtx()).dbStudioStatus();
    expect(res).toEqual({ up: false, port: 3210, starting: true });
  });
});
