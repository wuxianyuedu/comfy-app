/**
 * `media-source.server.ts` 的媒体源解析判据。
 *
 * 这个模块此前**零执行者** —— 本批把它的「地址 → 磁盘」换成共用判据
 * （`~/lib/media/output-paths` 的 `artifactDiskPath`），改了一个判据却没有一份
 * 执行者，就是「改了判据却没挂执行者」那个老形状（§11.2.1「挂载即欠执行者」）。所以用例按
 * **改了什么就钉什么**来写，重点是那一条边界：
 * 旧实现用 `abs.startsWith(GENERATED_DIR)` 收根，同级的 `generatedX` 目录
 * 前缀相同 → 会被算作根内（`/api/generated/../generatedX/evil.png` 归一后就是它）。
 *
 * mock 边界：只 spy `process.cwd()`（产物根由它派生，本机真实 cwd 会让判据随
 * 开发机的目录形态而变）；文件读写走**自己的临时目录**，不碰仓库的 `public/`。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { parseDataUrl } from "~/lib/media/data-url";
import { generatedRoot } from "~/lib/media/output-paths";
import { DEFAULT_IMAGE_MIME } from "~/lib/media/mime-ext";
import {
  intField,
  readUpstreamJson,
  resolveMediaBytes,
  resolveMediaDataUrl,
  strField,
} from "~/lib/workshop/media-source.server";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "media-source-"));
const ROOT = generatedRoot(TMP);

const cwdSpy = vi.spyOn(process, "cwd");

beforeAll(() => {
  fs.mkdirSync(ROOT, { recursive: true });
});

beforeEach(() => {
  cwdSpy.mockReturnValue(TMP);
});

afterEach(() => {
  // 只清调用记录，不 restore：restore 之后再把值塞回同一个 spy 就不生效了，
  // 表现为「后一半用例突然读到真实 cwd」
  cwdSpy.mockClear();
});

afterAll(() => {
  cwdSpy.mockRestore();
  // Windows：句柄未释放时 rmSync 会 EPERM，按仓库既有做法带重试
  fs.rmSync(TMP, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
});

describe("resolveMediaBytes —— 本地产物地址", () => {
  it("产物根内的真实文件：读到字节，mime 按扩展名", async () => {
    const file = path.join(ROOT, "t-1", "img_0.png");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from("fake-png"));

    const { buffer, mime } = await resolveMediaBytes(
      "/api/generated/t-1/img_0.png",
      "http://127.0.0.1:3100",
    );
    expect(buffer.toString()).toBe("fake-png");
    expect(mime).toBe("image/png");
  });

  it("非 png 的产物按扩展名给出类型（此前恒回 image/png）", async () => {
    /* 上面那条用例的文件恰好是 `.png` —— 传错参数（把整条路径喂给只认扩展名的
     * `mimeForExt`）在它身上**看不出来**，永远落到 `image/png` 这个默认值上。
     * 换一张 `.jpg` 才判得到：这一支的 MIME 会被 data URL 带进远程通道，
     * 标错就是「webp/jpeg 被声明成 png」。断言值仍来自语义（文件名里的扩展名），
     * 不是从实现抄（§11.2.1「用例的期望值要从语义推，不能从实现抄」）。 */
    const file = path.join(ROOT, "t-jpg", "img_0.jpg");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from("fake-jpeg"));
    const got = await resolveMediaBytes("/api/generated/t-jpg/img_0.jpg", "http://127.0.0.1:3100");
    expect(got.mime).toBe("image/jpeg");
    expect(got.buffer.toString()).toBe("fake-jpeg");
  });

  it("历史留下的 /generated/… 形状答得出同一个文件（两种形状同答案）", async () => {
    const { buffer } = await resolveMediaBytes("/generated/t-1/img_0.png", "http://127.0.0.1:3100");
    expect(buffer.toString()).toBe("fake-png");
  });

  it("同级 generatedX 不算根内：判据带 path.sep 边界", async () => {
    const outside = path.join(TMP, "public", "generatedX", "evil.png");
    fs.mkdirSync(path.dirname(outside), { recursive: true });
    fs.writeFileSync(outside, "not-mine");
    // 归一化之后落到的正是那个同级目录 —— startsWith(根) 会把它放行
    await expect(
      resolveMediaBytes("/api/generated/../generatedX/evil.png", "http://127.0.0.1:3100"),
    ).rejects.toThrow("无法定位本地生成文件");
  });

  it("越出产物根 → 拒绝，而不是读盘", async () => {
    const secret = path.join(TMP, "secrets.env");
    fs.writeFileSync(secret, "TOP-SECRET");
    await expect(
      resolveMediaBytes("/api/generated/../secrets.env", "http://127.0.0.1:3100"),
    ).rejects.toThrow("无法定位本地生成文件");
  });

  it("不是产物地址的相对路径同样拒绝（不给「换个前缀就能读任意文件」留缝）", async () => {
    await expect(resolveMediaBytes("/api/other/x.png", "http://127.0.0.1:3100")).rejects.toThrow(
      "无法定位本地生成文件",
    );
  });
});

describe("resolveMediaBytes —— 内联 data URL", () => {
  it("data URL 直接解出字节与 MIME", async () => {
    const base64 = Buffer.from("hello").toString("base64");
    const { buffer, mime } = await resolveMediaBytes(
      `data:image/jpeg;base64,${base64}`,
      "http://127.0.0.1:3100",
    );
    expect(buffer.toString()).toBe("hello");
    expect(mime).toBe("image/jpeg");
  });

  it("坏编码的 data URL 有明确文案（不是一句栈噪声）", async () => {
    await expect(
      resolveMediaBytes("data:image/jpeg;base64", "http://127.0.0.1:3100"),
    ).rejects.toThrow();
  });
});

/* ── http(s) 那一支：远端图源「不可用 / 半路撒谎」时的判据 ────────────────
 * 参考图来自用户粘贴或上游生成的地址，最常见的两种坏法是：连不上（网关、DNS）
 * 与「200 但回的不是图」（错误页 HTML、空类型头）。这两种都必须**在拉字节这一层**
 * 就得出可读结论 —— 落到后面就是一张黑图或一次 500，而用户看不出是图源的问题（硬规则 4）。
 */
/* 与 `~/lib/log/log-file-client.test.ts` 的同名夹具同一形状：把「这一轮怎么回」写成
 * 两支互斥的联合，`in` 收窄后抛值仍是 unknown —— 判据要钉的正是「上游拒绝出来的东西
 * 未必是 Error」，所以这里不许把它收窄成 Error。 */
function stubFetch(
  reply: { body?: BodyInit; status?: number; contentType?: string | null } | { throws: unknown },
) {
  const spy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    if ("throws" in reply) {
      throw reply.throws;
    }
    const headers: Record<string, string> = {};
    if (reply.contentType) {
      headers["content-type"] = reply.contentType;
    } else if (reply.contentType === "") {
      headers["content-type"] = "";
    }
    return new Response(reply.body ?? "bytes", {
      status: reply.status ?? 200,
      headers,
    });
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveMediaBytes 的 http(s) 分支", () => {
  it("请求带一个未触发的超时信号（沉默的上游不许挂住整条流水线）", async () => {
    const spy = stubFetch({ contentType: "image/png" });
    await expect(
      resolveMediaBytes("https://cdn.example.com/a.png", "http://127.0.0.1:3100"),
    ).resolves.toMatchObject({ mime: "image/png" });
    const signal = spy.mock.calls[0]?.[1]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
  });

  it("content-type 带参数时用主类型（image/jpeg; charset=x 不许整串当 MIME）", async () => {
    stubFetch({ contentType: "image/jpeg; charset=binary" });
    await expect(
      resolveMediaBytes("https://cdn.example.com/a.jpg", "http://x"),
    ).resolves.toMatchObject({ mime: "image/jpeg" });
  });

  it("上游回的不是图（网关错误页的 text/html）时按扩展名回落", async () => {
    stubFetch({ body: "<html>502</html>", contentType: "text/html" });
    const got = await resolveMediaBytes("https://cdn.example.com/dir/pic.png", "http://x");
    /* 回落不是将就：远程通道与 ComfyUI input 都按 MIME 决定怎么解码，
     * 拿着 text/html 的字节标成图片会让下游解不出图。 */
    expect(got.mime).toBe("image/png");
  });

  it("类型头缺失或为空时同样按扩展名回落；扩展名也给不出就落到默认图片类型", async () => {
    stubFetch({ contentType: "" });
    await expect(
      resolveMediaBytes("https://cdn.example.com/a.webp", "http://x"),
    ).resolves.toMatchObject({ mime: "image/webp" });
    await expect(
      resolveMediaBytes("https://cdn.example.com/noext", "http://x"),
    ).resolves.toMatchObject({ mime: DEFAULT_IMAGE_MIME });
  });

  it("HTTP 不成功 → 文案里带状态码（只说「失败了」等于没说）", async () => {
    stubFetch({ status: 502, contentType: "text/plain" });
    await expect(resolveMediaBytes("https://cdn.example.com/a.png", "http://x")).rejects.toThrow(
      "502",
    );
  });

  it("网络层抛错也翻成「哪儿错了 + 为什么」的一句话，不冒栈噪声", async () => {
    stubFetch({ throws: new TypeError("fetch failed") });
    await expect(resolveMediaBytes("https://down.example.com/a.png", "http://x")).rejects.toThrow(
      /^拉取参考图失败：/,
    );
  });

  it("拒绝出来的不是 Error 时回落兜底，而不是 undefined / [object Object]", async () => {
    /* 代理与 polyfill 会 `reject("...")` 丢一个裸字符串。这里拼的是给用户看的
     * 一句提示（硬规则 4）：详情取不到时宁可写「未知错误」，也不许把 undefined 递上去。 */
    stubFetch({ throws: "boom" });
    await expect(resolveMediaBytes("https://weird.example.com/a.png", "http://x")).rejects.toThrow(
      /^拉取参考图失败：未知错误$/,
    );
  });

  it("超过 24MB 就拒（远端图源不许把内存吃掉）", async () => {
    stubFetch({
      body: new Uint8Array(24 * 1024 * 1024 + 1),
      contentType: "image/png",
    });
    await expect(resolveMediaBytes("https://cdn.example.com/big.png", "http://x")).rejects.toThrow(
      "24MB",
    );
  });

  it("只认三扇门：data URL / 产物根内 / http(s)。file: 之类一律拒", async () => {
    /* 这一支的输入是用户粘的或上游给的地址。若允许 `file:`，
     * 「参考图」就变成「读本机任意文件」——工坊会把它编码成 data URL 发去远程通道。 */
    for (const src of ["file:///etc/passwd", "javascript:alert(1)", "ftp://x/a.png"]) {
      await expect(resolveMediaBytes(src, "http://x")).rejects.toThrow("不支持的图片来源");
    }
  });

  it("协议相对地址（//host/x.png）不联网，走本地产物那一支并被拒", async () => {
    /* 它以 `/` 开头 → 先进「本地产物地址」那一支，`artifactDiskPath` 认不出它 →
     * 明确报错。**结论同样是拒绝，但文案不同**：这一档要钉的是「不会被当成远端
     * 地址去 fetch」——那是一条 SSRF 形状的缝。 */
    await expect(resolveMediaBytes("//cdn.example.com/a.png", "http://x")).rejects.toThrow(
      "无法定位本地生成文件",
    );
  });
});

describe("resolveMediaDataUrl", () => {
  it("与字节出口同一条判据，且 data URL 能解回同一份字节与类型", async () => {
    stubFetch({ body: "hello-bytes", contentType: "image/png" });
    const url = await resolveMediaDataUrl("https://cdn.example.com/a.png", "http://x");
    const parsed = parseDataUrl(url);
    expect(parsed?.mime).toBe("image/png");
    expect(Buffer.from(parsed?.base64 ?? "", "base64").toString()).toBe("hello-bytes");
  });

  it("图源不可用时把错误原样交回调用方（不在这里咽成空串）", async () => {
    stubFetch({ status: 404, contentType: "image/png" });
    await expect(
      resolveMediaDataUrl("https://cdn.example.com/gone.png", "http://x"),
    ).rejects.toThrow("404");
  });
});

describe("readUpstreamJson / 字段守卫", () => {
  it("上游回非 JSON 时给出状态码与被截断的片段（长响应不许整包进错误）", async () => {
    const long = "<html>" + "x".repeat(4_000) + "</html>";
    const message = await readUpstreamJson(new Response(long, { status: 502 })).then(
      () => "",
      (e: unknown) => (e instanceof Error ? e.message : String(e)),
    );
    expect(message).toContain("上游返回非 JSON (502)");
    /* 片段是有界的：拿整包 HTML 当错误消息会顺着日志与界面文案一路扩散。
     * 长度单独断一句，而不是靠 `toThrow(正则)` 蒙过去。 */
    expect(message.length).toBeLessThan(1_000);
    expect(message.length).toBeLessThan(long.length);
  });

  it("正常 JSON 原样解析（是 unknown，收窄交给调用方）", async () => {
    await expect(readUpstreamJson(new Response('{"a":[1,2]}', { status: 200 }))).resolves.toEqual({
      a: [1, 2],
    });
  });

  it("strField：非字符串 / 空串 / 全空格都算「没给」", () => {
    expect(strField({ a: " 值 " }, "a")).toBe(" 值 ");
    expect(strField({ a: "" }, "a")).toBeUndefined();
    expect(strField({ a: "   " }, "a")).toBeUndefined();
    expect(strField({ a: 42 }, "a")).toBeUndefined();
    expect(strField({}, "a")).toBeUndefined();
  });

  it("intField：字符串数字收、非有限值拒、越界夹到上下界", () => {
    expect(intField({ n: "12" }, "n", 0, 100)).toBe(12);
    expect(intField({ n: -5 }, "n", 0, 100)).toBe(0);
    expect(intField({ n: 999 }, "n", 0, 100)).toBe(100);
    expect(intField({ n: "abc" }, "n", 0, 100)).toBeUndefined();
    expect(intField({ n: Number.POSITIVE_INFINITY }, "n", 0, 100)).toBeUndefined();
    expect(intField({ n: true }, "n", 0, 100)).toBeUndefined();
  });
});

/* ── 三条出口的「尺寸 / 空值」兜底档 ─────────────────────────────────────
 * `MAX_BYTES` 与「解码为空」两档在 data URL 分支上是独立写的（不是共用一个守卫），
 * 所以逐支判；本地分支的「扩展名推不出类型」也补上 —— 产物根里躺着的可能是
 * `.bin` / `.txt`，那一档的答案必须是**显式的默认图片类型**而不是 undefined。
 */
describe("尺寸与空值的兜底档", () => {
  it("data URL 载荷为空 → 被拒（不当成「一张空图」往下走）", async () => {
    /* 实测落点是「格式无效」而不是「解码为空」：`parseDataUrl` 在更早的一步就把空载荷
     * 判掉了。两条文案都指向同一个结论（这一下不该往下发），所以判的是**必拒**；
     * 而「解码为空」那一支因此按构造走不到 —— **没有**为了凑满分支去构造一个
     * `base64,====` 形状的输入（那测的是解析器的边角，不是这一层的判据；
     * 口径同台账 E8 那批不可达防御支的处置）。 */
    await expect(resolveMediaBytes("data:image/png;base64,", "http://x")).rejects.toThrow(
      /data URL/,
    );
  });

  it("data URL 超 24MB → 拒（远程通道的那一侧按尺寸付账）", async () => {
    /* 载荷是 base64：24MB+1 的字节需要约 32MB 的字符串。这条分配是一次性的，
     * 换来的是「超限」这一档在**每一支**上都有人判，而不是只判了 http 那一支。 */
    const big = Buffer.alloc(24 * 1024 * 1024 + 1, 0x41).toString("base64");
    await expect(resolveMediaBytes(`data:image/png;base64,${big}`, "http://x")).rejects.toThrow(
      "24MB",
    );
  });

  it("产物根里扩展名推不出的文件 → 显式落到默认图片类型，而不是 undefined", async () => {
    const file = path.join(ROOT, "t-bin", "payload");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from("no-extension"));
    const got = await resolveMediaBytes("/api/generated/t-bin/payload", "http://127.0.0.1:3100");
    expect(got.mime).toBe(DEFAULT_IMAGE_MIME);
    /* 这一档的存在本身值得留话：MIME 交给远程通道时不许是 undefined，
     * 否则拼出来的 data URL 头是 `data:undefined;base64,…`，症状出现在远端。 */
    expect(got.mime).not.toBeUndefined();
  });
});
