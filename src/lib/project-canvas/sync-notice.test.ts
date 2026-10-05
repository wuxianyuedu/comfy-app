// @vitest-environment jsdom
/**
 * 画布「服务端镜像」失败状态的判据。
 *
 * 这一层的存在理由只有一句：`catch {}` 把「服务端明确不收这一份」与
 * 「服务端此刻拿不到」压成同一种静默，于是前者那种**重试一万次也不会成功**的
 * 失败既不进日志、也不告诉用户 —— 用户以为画布已经存进服务端，换端口一看是空的。
 * 用例因此主要盯两件事：**分类判得对不对**（判错就是把重启误报成拒收、
 * 或把拒收放成静音），以及**登记与广播只在状态真的变化时发生**
 *（自动保存每 500ms 撞一次，不去重会把界面刷成一串同样的提示）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { subscribeAppEvent } from "~/lib/app-events";

import {
  clearSyncFailure,
  isPermanentRefusal,
  listSyncNotices,
  recordSyncFailure,
  reportMirrorFailure,
} from "./sync-notice";

/** tRPC 客户端错误的真实形状：码在 `data.code`，原文在 `shape.message`。 */
function trpcError(code: string, message: string): unknown {
  return Object.assign(new Error(message), {
    data: { code },
    shape: { message, code },
  });
}

let broadcasts = 0;
let off: (() => void) | null = null;

beforeEach(() => {
  broadcasts = 0;
  off = subscribeAppEvent("comfyapp:canvas-sync-changed", () => {
    broadcasts += 1;
  });
});

afterEach(() => {
  off?.();
  off = null;
  vi.restoreAllMocks();
});

describe("isPermanentRefusal：重试有没有用是唯一的那把尺", () => {
  it.for([
    ["FORBIDDEN", "该项目 id 已属于其他用户"],
    ["BAD_REQUEST", "name too small"],
    ["UNAUTHORIZED", "未登录"],
    ["CONFLICT", "名字已占用"],
    ["PRECONDITION_FAILED", "缺少前置条件"],
    ["PAYLOAD_TOO_LARGE", "画布过大"],
  ] as const)("%s 是拒收（服务端明确回了一句不收）", ([code, message]) => {
    expect(isPermanentRefusal(trpcError(code, message))).toBe(true);
  });

  it.for([
    ["TIMEOUT", "请求超时"],
    ["TOO_MANY_REQUESTS", "打得太勤"],
    ["INTERNAL_SERVER_ERROR", "no such table"],
    ["SERVICE_UNAVAILABLE", "服务未就绪"],
    ["BAD_GATEWAY", "上游错误"],
    ["GATEWAY_TIMEOUT", "上游超时"],
    ["PARSE_ERROR", "<!DOCTYPE ...> is not valid JSON"],
    ["CLIENT_CLOSED_REQUEST", "signal is aborted without reason"],
  ] as const)("%s 是可重试（不许打扰用户）", ([code, message]) => {
    expect(isPermanentRefusal(trpcError(code, message))).toBe(false);
  });

  it("取不到码 = 压根没拿到响应（离线 / 连不上）⇒ 不算拒收", () => {
    expect(isPermanentRefusal(new Error("Failed to fetch"))).toBe(false);
    expect(isPermanentRefusal(undefined)).toBe(false);
    expect(isPermanentRefusal("boom")).toBe(false);
  });

  it("码在 `shape` 或裸 `code` 上也认（取值链与日志那一份同源）", () => {
    expect(
      isPermanentRefusal(Object.assign(new Error("x"), { code: "FORBIDDEN" })),
    ).toBe(true);
    expect(
      isPermanentRefusal(
        Object.assign(new Error("x"), { shape: { code: "UNAUTHORIZED" } }),
      ),
    ).toBe(true);
    /* 空串不是码：`{ code: "" }` 判成拒收会让每一次奇怪抛值都弹提示。 */
    expect(
      isPermanentRefusal(Object.assign(new Error("x"), { data: { code: "" } })),
    ).toBe(false);
  });
});

describe("recordSyncFailure", () => {
  it("登记一条拒收：可查、带画布名字、原因含动作前缀，并广播一次", () => {
    const changed = recordSyncFailure(
      "这份画布没能存进服务端",
      { id: "proj_rec1", name: "灵感板" },
      trpcError("FORBIDDEN", "该项目 id 已属于其他用户"),
    );
    expect(changed).toBe(true);
    expect(broadcasts).toBe(1);

    const notices = listSyncNotices().filter(
      (n) => n.projectId === "proj_rec1",
    );
    expect(notices).toHaveLength(1);
    expect(notices[0]?.projectName).toBe("灵感板");
    /* 动作前缀一定在（一句笼统的「同步失败」会把两种后果压平），
     * 而正文是**按码翻好的人话** —— 服务端原文另有去处（`logSyncIssue` 那一行）。 */
    expect(notices[0]?.detail).toContain("这份画布没能存进服务端：");
    expect(notices[0]?.detail).toContain("已经属于别的用户");
  });

  it("BAD_REQUEST 的提示不许是 zod 的 JSON 原文（那是内部形状，不是出口）", () => {
    /* 真实形状：tRPC 把入参校验失败的服务端 message 原样带回来，
     * 里面是 `too_small` / `inclusive` / `path` 那一坨 —— 直接进 toast 用户读不下去，
     * 而「有个 toast」不等于「有用户可见出口」。 */
    recordSyncFailure(
      "这份画布没能存进服务端",
      { id: "proj_zod1", name: "空名画布" },
      trpcError(
        "BAD_REQUEST",
        '[\n  {\n    "code": "too_small",\n    "minimum": 1,\n    "path": ["name"]\n  }\n]',
      ),
    );
    const [only] = listSyncNotices().filter((n) => n.projectId === "proj_zod1");
    expect(only?.detail).toContain("多半是名字为空");
    expect(only?.detail).not.toContain("too_small");
  });

  it("没有对应人话的码走已翻译的原文，不硬编一句假的好话", () => {
    recordSyncFailure(
      "这份画布没能存进服务端",
      { id: "proj_zod2", name: "A" },
      trpcError("CONFLICT", "这个名字已经被占用了"),
    );
    const [only] = listSyncNotices().filter((n) => n.projectId === "proj_zod2");
    expect(only?.detail).toContain("这个名字已经被占用了");
  });

  it("同一份画布的同一句原因只登记一次（自动保存会反复撞）", () => {
    const err = trpcError("FORBIDDEN", "该项目 id 已属于其他用户");
    expect(
      recordSyncFailure("没能存进服务端", { id: "proj_rec2", name: "A" }, err),
    ).toBe(true);
    expect(
      recordSyncFailure("没能存进服务端", { id: "proj_rec2", name: "A" }, err),
    ).toBe(false);
    expect(
      recordSyncFailure("没能存进服务端", { id: "proj_rec2", name: "A" }, err),
    ).toBe(false);
    expect(broadcasts).toBe(1);
    expect(
      listSyncNotices().filter((n) => n.projectId === "proj_rec2"),
    ).toHaveLength(1);
  });

  it("原因变了要重新登记并再广播（改了名字之后变成另一条拒收）", () => {
    recordSyncFailure(
      "没能存进服务端",
      { id: "proj_rec3", name: "旧名" },
      trpcError("FORBIDDEN", "该项目 id 已属于其他用户"),
    );
    broadcasts = 0;
    const changed = recordSyncFailure(
      "没能存进服务端",
      { id: "proj_rec3", name: "新名" },
      trpcError("CONFLICT", "这个名字已经被占用了"),
    );
    expect(changed).toBe(true);
    expect(broadcasts).toBe(1);
    const [only] = listSyncNotices().filter((n) => n.projectId === "proj_rec3");
    expect(only?.detail).toContain("这个名字已经被占用了");
  });

  it("暂时性失败不登记、不广播", () => {
    const changed = recordSyncFailure(
      "没能存进服务端",
      { id: "proj_rec4", name: "A" },
      trpcError("INTERNAL_SERVER_ERROR", "no such table"),
    );
    expect(changed).toBe(false);
    expect(broadcasts).toBe(0);
    expect(listSyncNotices().some((n) => n.projectId === "proj_rec4")).toBe(
      false,
    );
  });
});

describe("clearSyncFailure", () => {
  it("重新同步成功后撤掉记录并广播（旧提示不能继续留在界面上）", () => {
    recordSyncFailure(
      "没能存进服务端",
      { id: "proj_clr1", name: "A" },
      trpcError("FORBIDDEN", "别人的项目"),
    );
    broadcasts = 0;
    expect(clearSyncFailure("proj_clr1")).toBe(true);
    expect(broadcasts).toBe(1);
    expect(listSyncNotices().some((n) => n.projectId === "proj_clr1")).toBe(
      false,
    );
  });

  it("本来就没有这条时不广播（每次成功都发一条空事件是噪音）", () => {
    expect(clearSyncFailure("proj_clr2")).toBe(false);
    expect(broadcasts).toBe(0);
  });
});

describe("reportMirrorFailure：两个分支都要有痕迹", () => {
  it("拒收走两条通道：界面拿人话、日志拿原文与码", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    reportMirrorFailure(
      "这份画布没能存进服务端",
      { id: "proj_rep1", name: "A" },
      trpcError("FORBIDDEN", "该项目 id 已属于其他用户"),
    );
    const [only] = listSyncNotices().filter((n) => n.projectId === "proj_rep1");
    expect(only?.detail).toContain("已经属于别的用户");
    /* 界面上看不到 `FORBIDDEN` 这个字，所以日志那一行必须把它带回来 ——
     * 少了这一半，「到底是哪个码拒的」就只能靠猜。 */
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = (warn.mock.calls[0] ?? []) as unknown[];
    expect(logged.map((part) => String(part)).join(" ")).toContain(
      "code=FORBIDDEN",
    );
    expect(logged.at(-1)).toBe("proj_rep1");
  });

  it("暂时性只留一行日志（不打扰用户，但也不能什么都不说）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    reportMirrorFailure(
      "这份画布没能从服务端删掉",
      { id: "proj_rep2", name: "B" },
      new Error("Failed to fetch"),
    );
    expect(warn).toHaveBeenCalledTimes(1);
    /* 日志里得能看出是哪一条画布、以及翻译后的人话 —— 只写出「Failed to fetch」
     * 等于把网络层原文搬进面板（口径同 `~/lib/error-message`）。
     * `console.warn` 的实参在类型上是 `any[]`，先收成 `unknown[]` 再取，
     * 否则断言拿到的是 `any`，写错了也不会红。 */
    const logged = (warn.mock.calls[0] ?? []) as unknown[];
    expect(String(logged[0])).toContain("暂时性");
    expect(logged.at(-1)).toBe("proj_rep2");
    expect(listSyncNotices().some((n) => n.projectId === "proj_rep2")).toBe(
      false,
    );
  });
});
