/**
 * `log-file-client` 的出口契约（这份模块自己此前没有执行者）。
 *
 * 它是日志面板与设置页唯一的取数面，而四个出口的**失败语义刻意不同**：
 *   · `fetchFileLogSlice` 只把「HTTP 不成功」降级成 `null`，网络层异常**原样抛出** ——
 *     它跑在面板那条已经很确定服务端在的轮询里，异常要交给轮询的调用方处置；
 *   · `fetchLogSessions` 两种失败都降级成 `null` —— 设置页挂载就会调一次，
 *     用户可能正处在服务重启的窗口期，报错只会污染控制台；
 *   · `saveLogExport` 把失败收成 `{ ok: false, error }`，面板显示「保存失败」而不卡住；
 *   · `postAppRuntimeLog` 完全静默（写日志是补记，绝不阻塞业务主流程）。
 * 这四档差别没有一行代码会报错，只有用例能锁住 —— 所以逐档钉，并钉「另一档不许串过来」。
 *
 * 另一件要钉的事是**查询串的拼法**：`offset` 是游标，`0` 表示「从头上读」，
 * 是被省略就会改变服务端行为的那一类值；`bootId` 反过来是「上一轮的服务端进程标识」，
 * 首轮没有时整个键必须不发（发空串会被服务端读成一次「比对不上」）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchFileLogSlice,
  fetchLogSessions,
  postAppRuntimeLog,
  saveDiagnosticsPackage,
  saveLogExport,
  type LogSourceKind,
} from "./log-file-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 一次调用的元组形状（与被测出口实际发的那一条一致）。 */
type FetchCall = readonly [RequestInfo | URL, RequestInit?];

/** 记一次 fetch 的出口：拿到请求 URL 与init，并决定这一轮怎么回。 */
function stubFetch(reply: { body?: unknown; ok?: boolean } | { throws: unknown }) {
  const spy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    if ("throws" in reply) throw reply.throws;
    return new Response(JSON.stringify(reply.body ?? {}), {
      status: reply.ok === false ? 500 : 200,
    });
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

/* 下面三个读数都**先收窄类型**再返回：`String(url)` / `String(init.body)` 会把
 * 非字符串的载荷打成 `[object Object]`（eslint 的 no-base-to-string 拦的就是它），
 * 那等于「断言读不出内容时照样比过」。 */

/** 请求地址。这几个出口只该发字符串，出现 URL 对象就是这一档没量到。 */
function urlOf(call: FetchCall | undefined): string {
  const target = call?.[0];
  if (typeof target !== "string") {
    throw new Error("请求地址不是字符串 —— 这一档没测到任何事");
  }
  return target;
}

/** 请求方法。 */
function methodOf(call: FetchCall | undefined): string | undefined {
  return call?.[1]?.method;
}

/** JSON 请求体。 */
function bodyOf(call: FetchCall | undefined): Record<string, unknown> {
  const raw = typeof call?.[1]?.body === "string" ? call[1].body : "{}";
  return /* SAFETY: 类型断言已复核 */ JSON.parse(raw) as Record<string, unknown>;
}

describe("fetchFileLogSlice —— 增量游标", () => {
  it("dev 档换成服务端的 source 名，offset=0 原样发出去（0 是游标不是缺值）", async () => {
    const fetchMock = stubFetch({ body: { content: "", size: 0, offset: 0 } });
    await expect(fetchFileLogSlice("dev", 0)).resolves.toEqual({
      content: "",
      size: 0,
      offset: 0,
    });
    expect(urlOf(fetchMock.mock.calls[0])).toBe("/api/logs/current?source=dev-launcher&offset=0");
  });

  it("首轮没有 bootId 时整个键不发；带上时参与比对", async () => {
    const fetchMock = stubFetch({ body: { content: "", size: 1, offset: 1 } });
    await fetchFileLogSlice("app", 1);
    await fetchFileLogSlice("app", 1, "boot-7");
    expect(urlOf(fetchMock.mock.calls[0])).toBe("/api/logs/current?source=app&offset=1");
    expect(urlOf(fetchMock.mock.calls[1])).toBe(
      "/api/logs/current?source=app&offset=1&bootId=boot-7",
    );
  });

  it("source 名逐档映射（只有 dev 换名，其余原样）", async () => {
    const cases: Array<[LogSourceKind, string]> = [
      ["dev", "dev-launcher"],
      ["launcher", "launcher"],
      ["shell", "shell"],
      ["shell-launch", "shell-launch"],
      ["app-runtime", "app-runtime"],
      ["comfyui-runtime", "comfyui-runtime"],
      ["drizzle-studio-runtime", "drizzle-studio-runtime"],
      ["ollama-runtime", "ollama-runtime"],
    ];
    for (const [kind, expected] of cases) {
      const fetchMock = stubFetch({
        body: { content: "", size: 0, offset: 0 },
      });
      await fetchFileLogSlice(kind, 0);
      expect(urlOf(fetchMock.mock.calls[0])).toContain(`source=${expected}`);
    }
  });

  it("HTTP 不成功 → null（这一轮面板什么都不改）", async () => {
    stubFetch({ ok: false, body: { error: "missing" } });
    await expect(fetchFileLogSlice("app", 40)).resolves.toBeNull();
  });

  it("网络层异常原样抛出，不在这条出口上被咽成 null", async () => {
    /* 与 `fetchLogSessions` 相反是**刻意的**（见文件头）。这一条防的是
     * 「有人后来加了一层 try/catch 让两档同形」——那会把面板的重启窗口
     * 表现成「日志一直空着」，而调用方再也分不出两种坏法。 */
    stubFetch({ throws: new TypeError("fetch failed") });
    await expect(fetchFileLogSlice("app", 0)).rejects.toThrow("fetch failed");
  });

  it("sessionStart 为 null 时保持 null（面板据此不做时间线截断，而不是当成 0）", async () => {
    stubFetch({
      body: {
        content: "x",
        size: 1,
        offset: 0,
        sessionStart: null,
        mismatch: true,
      },
    });
    await expect(fetchFileLogSlice("app", 0)).resolves.toMatchObject({
      sessionStart: null,
      mismatch: true,
    });
  });
});

describe("fetchLogSessions —— 会话视图", () => {
  it("缺省会话时只发 source；指定会话时带上 session", async () => {
    const fetchMock = stubFetch({ body: { sessions: [], content: "" } });
    await fetchLogSessions("comfyui-runtime");
    await fetchLogSessions("comfyui-runtime", null);
    await fetchLogSessions("ollama-runtime", "s-2");
    expect(urlOf(fetchMock.mock.calls[0])).toBe("/api/logs/sessions?source=comfyui-runtime");
    expect(urlOf(fetchMock.mock.calls[1])).toBe("/api/logs/sessions?source=comfyui-runtime");
    expect(urlOf(fetchMock.mock.calls[2])).toBe(
      "/api/logs/sessions?source=ollama-runtime&session=s-2",
    );
  });

  it("HTTP 不成功 → null", async () => {
    stubFetch({ ok: false });
    await expect(fetchLogSessions("comfyui-runtime")).resolves.toBeNull();
  });

  it("网络层异常也收成 null（设置页挂载即调用，不许污染控制台）", async () => {
    stubFetch({ throws: new TypeError("fetch failed") });
    await expect(fetchLogSessions("ollama-runtime")).resolves.toBeNull();
  });
});

describe("saveLogExport —— 导出到本机", () => {
  it("POST 带上 label 与正文，并把服务端写下的路径原样回传", async () => {
    const payload = {
      ok: true,
      path: "C:\\log\\exports\\a.log",
      relativePath: "exports/a.log",
      bytes: 12,
    };
    const fetchMock = stubFetch({ body: payload });
    await expect(saveLogExport("面板", "正文")).resolves.toEqual(payload);
    const call = fetchMock.mock.calls[0];
    expect(urlOf(call)).toBe("/api/logs/export");
    expect(methodOf(call)).toBe("POST");
    expect(call?.[1]?.headers).toMatchObject({
      "Content-Type": "application/json",
    });
    expect(bodyOf(call)).toEqual({ label: "面板", content: "正文" });
  });

  it("网络失败收成 { ok:false, error: 原因 }，不抛（面板还要继续用）", async () => {
    stubFetch({ throws: new Error("ENOSPC 磁盘满") });
    await expect(saveLogExport("面板", "正文")).resolves.toEqual({
      ok: false,
      error: "ENOSPC 磁盘满",
    });
  });

  it("拒绝的不是 Error 时给一个可读的兜底原因，而不是 undefined", async () => {
    stubFetch({ throws: "boom" });
    await expect(saveLogExport("面板", "正文")).resolves.toEqual({
      ok: false,
      error: "network",
    });
  });

  it("服务端回了非 JSON（比如网关的 HTML 错误页）同样收成失败而不是抛", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>502</html>", { status: 502 })),
    );
    await expect(saveLogExport("面板", "正文")).resolves.toMatchObject({
      ok: false,
    });
  });
});

describe("saveDiagnosticsPackage —— 打包整份诊断现场", () => {
  /* 与 `saveLogExport` 的分工是**两件事**：那个存「面板当前筛选到的行」，
   * 这个让服务端把 `log/current/` + 最近几次 `log/runs/` 打成 zip。
   * 差别落在请求形状上：诊断打包没有正文可带（内容由服务端自己收），
   * 所以「不该发 body、也不该带 Content-Type」是要钉住的那一半。 */
  it("POST 到诊断端点，不带请求体（现场由服务端自己收）", async () => {
    const payload = {
      ok: true,
      path: "C:\\log\\exports\\diagnostics.zip",
      relativePath: "exports/diagnostics.zip",
      bytes: 4096,
    };
    const fetchMock = stubFetch({ body: payload });
    await expect(saveDiagnosticsPackage()).resolves.toEqual(payload);
    const call = fetchMock.mock.calls[0];
    expect(urlOf(call)).toBe("/api/logs/diagnostics");
    expect(methodOf(call)).toBe("POST");
    expect(call?.[1]?.body).toBeUndefined();
  });

  it("网络失败收成 { ok:false, error }，与导出同一档（面板显示「打包失败」而不卡住）", async () => {
    stubFetch({ throws: new Error("ENOSPC 磁盘满") });
    await expect(saveDiagnosticsPackage()).resolves.toEqual({
      ok: false,
      error: "ENOSPC 磁盘满",
    });
  });

  it("拒绝的不是 Error 时给兜底原因", async () => {
    stubFetch({ throws: "boom" });
    await expect(saveDiagnosticsPackage()).resolves.toEqual({
      ok: false,
      error: "network",
    });
  });

  it("服务端回了非 JSON（网关的 HTML 错误页）同样收成失败而不是抛", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>504</html>", { status: 504 })),
    );
    await expect(saveDiagnosticsPackage()).resolves.toMatchObject({
      ok: false,
    });
  });
});

describe("postAppRuntimeLog —— 补记必须绝不影响主流程", () => {
  it("POST 带上命名空间 / 级别 / 正文 / 字段", async () => {
    const fetchMock = stubFetch({ body: { ok: true } });
    await postAppRuntimeLog("settings", "warn", "配置读不到", { key: "x" });
    const call = fetchMock.mock.calls[0];
    expect(urlOf(call)).toBe("/api/logs/app-runtime");
    expect(methodOf(call)).toBe("POST");
    expect(bodyOf(call)).toEqual({
      ns: "settings",
      level: "warn",
      msg: "配置读不到",
      fields: { key: "x" },
    });
  });

  it("字段缺省时整键不发（服务端按「没有附加字段」处理）", async () => {
    const fetchMock = stubFetch({ body: { ok: true } });
    await postAppRuntimeLog("app", "info", "一条");
    expect(bodyOf(fetchMock.mock.calls[0])).toEqual({
      ns: "app",
      level: "info",
      msg: "一条",
      fields: undefined,
    });
  });

  it("网络失败静默返回，绝不抛给调用方", async () => {
    stubFetch({ throws: new TypeError("fetch failed") });
    await expect(postAppRuntimeLog("app", "error", "一条")).resolves.toBeUndefined();
  });
});
