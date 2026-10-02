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
 * 一条（探测要发真实 HTTP，其余成员走真实实现）、`node:fs` 的 `realpathSync`
 * 一条**默认透传的代理**（只有 `fsState.failRoot` 打开时让「取检出根」那一次抛错，
 * 见 `revealPath` 的用例）。
 * **`~/lib/shell/open-in-browser` 不 mock，只 mock `child_process`** —— 这样
 * `openExternal` 这一条测的是「路由没有绕开地基那道闸」，而不是「路由调到了地基」。
 */
import type * as NodeFs from "node:fs";
import { basename, join, resolve } from "node:path";

import type * as ComfyEmbedModule from "~/lib/comfy/comfy-embed";
import { describe, expect, it, vi, beforeEach } from "vitest";

const {
  spawnMock,
  probeMock,
  fsState,
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
  /** 让「取检出根」那一次 `realpath` 抛错的开关（探针在每次调用开头读它）。 */
  fsState: { failRoot: false },
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
/**
 * `realpathSync` 换成「可指挥的代理」：默认原样转给真实实现，只有打开
 * `fsState.failRoot` 时让**取检出根那一次**（参数正是 `process.cwd()`）抛错。
 * 需要它是因为 `projectScopedProbe()` 的失败分支在真机上不可达 —— 当前工作目录
 * 一定存在，而「根取不到」是这条闸唯一的 fail-closed 出口。
 */
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>();
  return {
    ...actual,
    realpathSync: (target: NodeFs.PathLike) => {
      if (fsState.failRoot && String(target) === process.cwd()) {
        throw Object.assign(new Error("ENOENT: no such file or directory"), {
          code: "ENOENT",
        });
      }
      return actual.realpathSync(target);
    },
  };
});
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
  fsState.failRoot = false;
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

// ─────────────────────────────── revealPath ───────────────────────────────

/**
 * `setting.revealPath` —— 把「日志里那段文本」变成「在本机执行一个外部程序」之前
 * 的两道闸（ISSUE #1365）。
 *
 * 与上面 `openExternal` 那组同一族，但威胁面不同：那个的入参是 URL（协议闸能穷举），
 * 这个的入参是**任意候选文本**（日志原文里扫出来的），所以闸门落在「磁盘上真存在」
 * + 「在检出目录内」两条上。这里的用例全部用**本仓库里真实存在的路径**（
 * `process.cwd()` 下的文件），因为闸门第 ① 条问的就是文件系统 —— 造一个假路径
 * 只能测到「不存在被拒」，测不到「存在且在检出内被放行」。
 *
 * mock 边界与上面一致：只 mock `child_process`，`~/lib/shell/reveal-path` 走真实
 * 实现 —— 这样测的是「路由没有绕开地基那两道闸」，而不是「路由调到了地基」。
 */
describe("setting.revealPath —— 打开本机路径之前的存在性 + 检出目录闸", () => {
  /** 本检出里必然存在的一份文件（用它当「合法目标」的样本）。 */
  const insideProject = "package.json";

  it("检出目录内且真实存在的路径 → 放行，并把「选中它」交给文件管理器", async () => {
    const res = await createCaller(makeCtx()).revealPath({
      path: join(process.cwd(), insideProject),
    });
    expect(res.ok).toBe(true);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [cmd, args] = spawnMock.mock.calls[0] as [string, string[]];
    if (process.platform === "win32") {
      /* `/select,"<路径>"` 必须是**一个**参数：拆成两个时 explorer 会把含空格的
       * 路径截断，表现是「打开了资源管理器但什么都没选中」。 */
      expect(cmd).toMatch(/cmd(\.exe)?$/i);
      expect(args.at(-1)).toMatch(/^\/select,".+package\.json"$/);
    } else if (process.platform === "darwin") {
      /* macOS：`open -R` 把**目标本身**交给 Finder。 */
      expect(args).toEqual(["-R", join(process.cwd(), insideProject)]);
    } else {
      /* Linux：各文件管理器没有统一的「选中」协议，退化为打开**父目录** ——
       * 点一个文件的意图是「到它那儿去」，用编辑器打开它不是。 */
      expect(args).toEqual([process.cwd()]);
    }
  });

  it("不存在的路径 → 拒绝，且**不 spawn**（拒绝必须发生在动作之前）", async () => {
    const res = await createCaller(makeCtx()).revealPath({
      path: join(process.cwd(), "no-such-file-1365.txt"),
    });
    expect(res.ok).toBe(false);
    expect(res.detail).toContain("找不到可在文件管理器里打开的路径");
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("检出目录之外的路径 → 拒绝，且不 spawn（文本可以来自任何地方，必须拦）", async () => {
    /* 造一个**真实存在**但在检出外的目标：本项目的 `..`（上一级目录）。它与上面
     * 那条的区别正是这道闸存在的理由 —— 存在性判据放行它，检出闸必须拦下。 */
    const outside = resolve(process.cwd(), "..");
    const res = await createCaller(makeCtx()).revealPath({ path: outside });
    expect(res.ok).toBe(false);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("`..` 折出去的路径 → 拒绝（判据走 realpath，字符串前缀比会被绕过）", async () => {
    const res = await createCaller(makeCtx()).revealPath({
      path: join(process.cwd(), "..", basename(process.cwd())),
    });
    /* 折回来正好是检出根 → 这条**放行**是对的（它就在检出里）；用例要钉的是
     * 「判据看的是归一化结果而不是字面量」，所以再折一层到检出外。 */
    expect(res.ok).toBe(true);

    spawnMock.mockClear();
    const escape = await createCaller(makeCtx()).revealPath({
      path: join(process.cwd(), "..", ".."),
    });
    expect(escape.ok).toBe(false);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("空串入参 → zod 拦下（不给地基一个「打开空路径」的机会）", async () => {
    await expect(
      createCaller(makeCtx()).revealPath({ path: "" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(spawnMock).not.toHaveBeenCalled();
  });
});

/**
 * `revealPath` 那道闸**自己坏掉时**的方向。
 *
 * 上面几组判的都是「闸在工作」时的取舍；这一组判的是闸读不到检出根时倒向哪一侧。
 * 真机上 `realpath(process.cwd())` 不会失败（当前工作目录一定存在），所以这条
 * 分支只能靠代理把它逼出来 —— 而它恰恰是最需要钉住的一侧：闸门失效时如果默认
 * 全放，「一句精心构造的日志让面板去打开 `C:\Windows\System32`」就从**文本判据**
 * 进不来了改从**闸自己**进来了。
 */
describe("setting.revealPath —— 取不到检出根时全拒，且这个结论不粘", () => {
  /** 与上面同一条样本：检出内、真实存在 —— 闸正常时它必须放行。 */
  const insideProject = "package.json";

  it("取不到根 → **连检出内且真实存在的路径也拒绝**，且不 spawn", async () => {
    fsState.failRoot = true;
    const res = await createCaller(makeCtx()).revealPath({
      path: join(process.cwd(), insideProject),
    });
    expect(res.ok).toBe(false);
    /* 说明照旧给到（硬规则 4：失败必须有用户可见出口），且**不区分**「不存在」与
     * 「根读不到」—— 后者是本机目录结构的信息，不是请求方该拿到的探测结果。 */
    expect(res.detail).toContain("找不到可在文件管理器里打开的路径");
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("根只是**这一轮**读不到 → 下一轮请求恢复放行（探针每次调用现取根）", async () => {
    fsState.failRoot = true;
    const refused = await createCaller(makeCtx()).revealPath({
      path: join(process.cwd(), insideProject),
    });
    expect(refused.ok).toBe(false);

    /* 关键在后半句：全拒不许被记住。探针是在**每次 procedure 调用里**重新取根，
     * 于是「服务被搬到别的检出」「根短暂不可读」之后通道会自己活回来；如果那个
     * null 被缓存到进程级，整条通道会永久哑掉而界面上没有任何症状。 */
    fsState.failRoot = false;
    spawnMock.mockClear();
    const again = await createCaller(makeCtx()).revealPath({
      path: join(process.cwd(), insideProject),
    });
    expect(again.ok).toBe(true);
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });
});
