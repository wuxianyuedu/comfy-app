/**
 * `scripts/ci/ci-cnb-attachment.mjs` 的契约：把一份文本传成 CNB 仓库附件。
 *
 * 钉住最容易静默失效的几件（与 relay 那一族同一条端到端探针结论，ISSUE #3437）：
 *   ① `POST /-/upload/files` 的 body 是 `{name,size}`，`size` 是 UTF-8 字节数；
 *   ② `PUT <upload_url>` 收到的就是原文（不转码、不打包）；
 *   ③ `assets.path` 只取 `/-/files/` 之后的尾段，链接拼成相对形状 `[](/-/files/…)`;
 *   ④ 任何一步失败都给 `{ok:false, detail}`，绝不冒充成功——发布前 `GET` 恒 404
 *      是平台口径，不是上传失败（校验只看上传命令自身的应答）；
 *   ⑤ 文件名归一：白名单外字符替换成 `_`，不给平台拒名的机会。
 */
import { describe, expect, it } from "vitest";

import {
  assetLink,
  cnbRequest,
  safeFileName,
  uploadCnbTextFile,
} from "../scripts/ci/ci-cnb-attachment.mjs";

/** 真 `Response`：`cnbRequest` 只读 `ok` / `status` / `text()`，返回真件就免去类型断言。 */
function res(status: number, body: unknown = ""): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, {
    headers: { "content-type": "application/json" },
    status,
  });
}

/** CNB 侧假 fetch：记录每一步，可让上传 / PUT 任一步失败。 */
function fakeCnb(opts: { fail?: "upload" | "put"; path?: string } = {}) {
  const calls: Array<{ body?: string; method: string; url: string }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    await Promise.resolve();
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";
    calls.push({ body: typeof init?.body === "string" ? init.body : undefined, method, url });
    if (method === "POST" && url.endsWith("/-/upload/files")) {
      if (opts.fail === "upload") return res(403, { message: "forbidden" });
      return res(200, {
        assets: { path: opts.path ?? "/moon-read/comfy-app-t3/-/files/u/key/ga-daily.log" },
        token: "tk",
        upload_url: "https://asset.cnb.cool/put",
      });
    }
    if (method === "PUT") {
      if (opts.fail === "put") return res(500, "boom");
      return res(200, "");
    }
    return res(404, { message: `unexpected ${method} ${url}` });
  };
  return { calls, fetchImpl };
}

const IO = {
  endpoint: "https://api.cnb.cool",
  fileName: "ga-daily-44421408529-6592195d.log",
  repo: "moon-read/comfy-app-t3",
  text: "== run 44421408529 ==\n##[error]boom\n",
  token: "cnb_fake",
};

describe("uploadCnbTextFile", () => {
  it("两步齐发：POST 取链接（body 是 name+UTF-8 字节数）→ PUT 原文；回执给 /-/files/ 尾段", async () => {
    const { calls, fetchImpl } = fakeCnb();
    const up = await uploadCnbTextFile({ ...IO, fetchImpl });
    expect(up).toMatchObject({
      assetPath: "u/key/ga-daily.log",
      bytes: Buffer.byteLength(IO.text, "utf8"),
      fileName: IO.fileName,
      ok: true,
    });
    expect(calls.length).toBe(2);
    const [post, put] = calls;
    expect(post?.method).toBe("POST");
    expect(post?.url).toBe(`https://api.cnb.cool/${IO.repo}/-/upload/files`);
    expect(JSON.parse(post?.body ?? "{}")).toEqual({
      name: IO.fileName,
      size: Buffer.byteLength(IO.text, "utf8"),
    });
    expect(put?.method).toBe("PUT");
    expect(put?.url).toBe("https://asset.cnb.cool/put");
    expect(put?.body).toBe(IO.text);
  });

  it("应答带 {data:{…}} 信封时同样解析（平台两种形状都回过）", async () => {
    const { fetchImpl } = fakeCnb({
      path: "/moon-read/comfy-app-t3/-/files/u/key/enveloped.log",
    });
    /* 平台只对 JSON 应答带信封；PUT 的空应答没有 body 可包 —— 原样透传。 */
    const wrapped: typeof fetch = async (input, init) => {
      const r = await fetchImpl(input, init);
      const text = await r.text();
      try {
        const inner: unknown = JSON.parse(text);
        return res(r.status, { data: inner });
      } catch {
        return res(r.status, text);
      }
    };
    const up = await uploadCnbTextFile({ ...IO, fetchImpl: wrapped });
    expect(up).toMatchObject({ assetPath: "u/key/enveloped.log", ok: true });
  });

  it("取链接失败（403）⇒ ok:false，detail 带 HTTP 状态，不发 PUT", async () => {
    const { calls, fetchImpl } = fakeCnb({ fail: "upload" });
    const up = await uploadCnbTextFile({ ...IO, fetchImpl });
    const detail = up.ok ? "" : up.detail;
    expect(up.ok).toBe(false);
    expect(detail).toContain("403");
    expect(calls.filter((c) => c.method === "PUT")).toEqual([]);
  });

  it("应答缺 upload_url / assets.path ⇒ ok:false（不把残缺回执当成功）", async () => {
    const fetchImpl: typeof fetch = () => Promise.resolve(res(200, { token: "tk" }));
    const up = await uploadCnbTextFile({ ...IO, fetchImpl });
    const detail = up.ok ? "" : up.detail;
    expect(up.ok).toBe(false);
    expect(detail).toContain("upload_url");
  });

  it("PUT 失败（500）⇒ ok:false，detail 指到 PUT 那一步", async () => {
    const { fetchImpl } = fakeCnb({ fail: "put" });
    const up = await uploadCnbTextFile({ ...IO, fetchImpl });
    const detail = up.ok ? "" : up.detail;
    expect(up.ok).toBe(false);
    expect(detail).toContain("PUT");
  });

  it("网络抛异常 ⇒ ok:false（detail 是错误名），不冒充成功也不抛出", async () => {
    const fetchImpl: typeof fetch = () => Promise.reject(new Error("network down"));
    const up = await uploadCnbTextFile({ ...IO, fetchImpl });
    expect(up.ok).toBe(false);
  });
});

describe("safeFileName / assetLink", () => {
  it("文件名白名单外的字符替换成 _（run id / sha / 点 / 横线都保留）", () => {
    expect(safeFileName("ga-daily-44421408529-6592195d.log")).toBe(
      "ga-daily-44421408529-6592195d.log",
    );
    expect(safeFileName("ga/daily:run 44421408529#red?.log")).toBe(
      "ga_daily_run_44421408529_red_.log",
    );
    expect(safeFileName("")).toBe("");
  });

  it("assetLink 是相对 Markdown 链接（平台回读时自己补绝对 URL）", () => {
    expect(assetLink("ga.log", "u/key/ga.log")).toBe("[ga.log](/-/files/u/key/ga.log)");
  });
});

describe("cnbRequest（自 relay 上移后的同一份传输层）", () => {
  it("写不重试：失败原样返回，body 按 JSON / 文本两种形状发", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push(`${String(init?.method)} ${url}`);
      return Promise.resolve(res(500, "no"));
    };
    const ctx = { token: "t" };
    const j = await cnbRequest({ ctx, fetchImpl }, "POST", "https://api.cnb.cool/x/-/y", {
      json: { a: 1 },
    });
    expect(j.ok).toBe(false);
    const t = await cnbRequest({ ctx, fetchImpl }, "PUT", "https://asset/put", {
      text: "payload",
      contentType: "text/plain; charset=utf-8",
    });
    expect(t.ok).toBe(false);
    expect(calls).toEqual(["POST https://api.cnb.cool/x/-/y", "PUT https://asset/put"]);
  });
});
