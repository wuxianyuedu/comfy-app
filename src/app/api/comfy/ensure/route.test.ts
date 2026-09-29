/**
 * `POST /api/comfy/ensure` —— 「需要 ComfyUI」的动作的统一入口（ISSUE #345）。
 *
 * 这个端点的存在理由是一条**三态契约**，前端 `ensureComfyReady` 完全按它渲染：
 *   200 `{ ok: true }`                       → 现在就能用，重试即可
 *   202 `{ ok: false, pending: true, … }`    → 正在启动 / 用户关了自动启动，稍后重试
 *   503 `{ ok: false, pending: false, … }`   → 启动失败，`detail` 直接给用户看
 * 三态被压成两态（比如把 pending 当失败）就是当初那个事故：上传位只甩一句
 * `Configured ComfyUI instance is not running`，用户分不清「没启动」还是「启动中」。
 *
 * 另外三条容易在重构中丢掉的性质，也各有用例：
 *   · **已在运行就不重复拉起**（探活命中必须直接返回，不碰 `ensureComfyUiReady`）；
 *   · 单次请求只等**短窗口**（8s），等不到就 202 让前端继续轮 —— 把整段冷启动
 *     塞进一个请求里，用户看到的是挂死的按钮，中途也看不见「正在启动」；
 *   · 未登录时不探活也不拉起（副作用闸门在鉴权之后）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const AUTOSTART_TIMEOUT_MS = 120_000;

/** `ensureComfyUiReady` 的入参形状（路由传的是短窗口 timeoutMs + onLog）。 */
type EnsureOptions = { timeoutMs: number; onLog: (msg: string) => void };

const { requireRequestUser, probeComfyUi, ensureComfyUiReady, logger } =
  vi.hoisted(() => ({
    requireRequestUser: vi.fn<() => Promise<{ id: string } | null>>(),
    probeComfyUi: vi.fn<(ms: number) => Promise<string | null>>(),
    ensureComfyUiReady: vi.fn<(options: EnsureOptions) => Promise<unknown>>(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }));

vi.mock("~/server/auth/request-user", () => ({
  requireRequestUser: () => requireRequestUser(),
}));

vi.mock("~/lib/comfyui/lifecycle", () => ({
  probeComfyUi: (ms: number) => probeComfyUi(ms),
  ensureComfyUiReady: (options: EnsureOptions) => ensureComfyUiReady(options),
  COMFYUI_AUTOSTART_TIMEOUT_MS: 120_000,
}));

vi.mock("~/server/lib/logger", () => ({ logger }));

beforeEach(() => {
  requireRequestUser.mockReset();
  requireRequestUser.mockResolvedValue({ id: "u-1" });
  probeComfyUi.mockReset();
  ensureComfyUiReady.mockReset();
  logger.info.mockClear();
  logger.error.mockClear();
});

describe("POST /api/comfy/ensure", () => {
  it("未登录 → 401，且既不探活也不拉起", async () => {
    requireRequestUser.mockResolvedValue(null);
    const { POST } = await import("./route");
    const res = await POST();
    expect(res.status).toBe(401);
    expect(probeComfyUi).not.toHaveBeenCalled();
    expect(ensureComfyUiReady).not.toHaveBeenCalled();
  });

  it("已在运行 → 200，且**不重复拉起**实例", async () => {
    probeComfyUi.mockResolvedValueOnce("http://127.0.0.1:8188");
    const { POST } = await import("./route");
    const res = await POST();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      base: "http://127.0.0.1:8188",
      detail: "ComfyUI 已在运行",
    });
    expect(ensureComfyUiReady).not.toHaveBeenCalled();
  });

  it("探活没中、拉起后就绪 → 200 带 ensure 给的 base/detail，且拉起过程有留痕", async () => {
    probeComfyUi.mockResolvedValueOnce(null);
    // 真实实现会往 `onLog` 里灌进度；这里照它的契约调一次，既覆盖这个回调，
    // 也钉住「拉起过程必须落日志」（AGENTS 硬规则 4：失败路径与长路径都要可追）。
    ensureComfyUiReady.mockImplementationOnce(async (options) => {
      options.onLog("正在拉起 ComfyUI…");
      return {
        ok: true,
        base: "http://127.0.0.1:8189",
        detail: "已启动并就绪",
      };
    });
    const { POST } = await import("./route");
    const res = await POST();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      base: "http://127.0.0.1:8189",
      detail: "已启动并就绪",
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("[comfyui-ensure] 正在拉起 ComfyUI…"),
    );
  });

  it("还在启动中 → 202 pending，并回自动启动的等待上限供前端计时", async () => {
    probeComfyUi.mockResolvedValueOnce(null);
    ensureComfyUiReady.mockResolvedValueOnce({
      ok: false,
      detail: "ComfyUI 正在启动，请稍候",
    });
    const { POST } = await import("./route");
    const res = await POST();
    expect(res.status).toBe(202);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      pending: true,
      detail: "ComfyUI 正在启动，请稍候",
      timeoutMs: AUTOSTART_TIMEOUT_MS,
    });
  });

  it("启动失败 → 503 pending:false，detail 是错误原文（可直接给用户看）", async () => {
    probeComfyUi.mockResolvedValueOnce(null);
    ensureComfyUiReady.mockRejectedValueOnce(
      new Error("找不到 comfy-cli 的虚拟环境"),
    );
    const { POST } = await import("./route");
    const res = await POST();
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      ok: boolean;
      pending: boolean;
      detail: string;
    };
    expect(body).toEqual({
      ok: false,
      pending: false,
      detail: "找不到 comfy-cli 的虚拟环境",
    });
    // 失败必须有日志（AGENTS 硬规则 4），不能只回一个状态码。
    expect(logger.error).toHaveBeenCalled();
  });

  it("抛的不是 Error 时也有兜底文案，不给前端一个 undefined", async () => {
    probeComfyUi.mockResolvedValueOnce(null);
    ensureComfyUiReady.mockRejectedValueOnce("boom");
    const { POST } = await import("./route");
    const body = (await (await POST()).json()) as { detail: string };
    expect(body.detail).toBeTruthy();
    expect(body.detail).not.toBe("undefined");
  });

  it("单次请求只等短窗口：整段冷启动交给前端轮，而不是把请求挂死", async () => {
    probeComfyUi.mockResolvedValueOnce(null);
    ensureComfyUiReady.mockResolvedValueOnce({ ok: false, detail: "启动中" });
    const { POST } = await import("./route");
    await POST();
    const options = ensureComfyUiReady.mock.calls[0]?.[0];
    expect(options?.timeoutMs).toBeLessThan(AUTOSTART_TIMEOUT_MS);
    expect(options?.timeoutMs).toBeGreaterThan(0);
  });

  it("探活窗口也是短的（1.5s），且带 onLog 让拉起过程可追", async () => {
    probeComfyUi.mockResolvedValueOnce("http://127.0.0.1:8188");
    const { POST } = await import("./route");
    await POST();
    expect(probeComfyUi.mock.calls[0]?.[0]).toBeLessThan(5_000);
  });

  it("必须 force-dynamic：这个端点被缓存等于「启动中」永远不变", async () => {
    const mod = await import("./route");
    expect(mod.dynamic).toBe("force-dynamic");
    expect(mod.runtime).toBe("nodejs");
  });
});
