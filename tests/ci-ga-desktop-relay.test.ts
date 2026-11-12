/**
 * `scripts/ci-ga-desktop-relay.mjs` 的判据（ISSUE #3607 GA 桌包成品回传 CNB）。
 *
 * 钉住最容易静默失效的几件：
 *   ① 前提 fail-closed：缺令牌 / 仓库 / 成品一份都没有 ⇒ 没判过（2），不是绿；
 *   ② 成品从盘上真读，不硬编码 tauri 生成名；安装包带形态前缀免同名撞车；
 *   ③ `verify_url` 拆 upload_token / asset_path（含含斜杠的 path、绝对 / 相对 URL）；
 *   ④ 创建 Release 必带 `target_commitish`（#3611 现场：服务端 400 `target_commitish is
 *      required`），上传链「取地址 → PUT → 确认」三步缺一步即失败，不假装送达；
 *   ⑤ PUT 不带 Authorization（预签名 URL 自带授权），确认带 `ttl=0`；
 *   ⑥ 失败回话脱敏（令牌形状不回显）；
 *   ⑦ `--dry-run` 一条网络都不发；
 *   ⑧ 出口话术给出 CNB 站内取包地（不是 GitHub）。
 *   ⑨ #3607 纯壳：单文件 `ComfyAPP-shell.exe` 从盘上真读（不重编 / 不打包），
 *      与完整成品分列；#3621 PUT 墙钟是分钟级、超时 / 网络类失败按既有判据重试、
 *      HTTP 应答一次交账不重试。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { CODE } from "../scripts/ci-github-mirror-push.mjs";
import {
  collectBundles,
  ensureRelease,
  main,
  parseVerifyUrl,
  putAsset,
  PUT_MAX_ATTEMPTS,
  PUT_TIMEOUT_MS,
  redact,
  RELEASE_TAG,
  resolveDesktopRelayContext,
  SHELL_ASSET_NAME,
  uploadAsset,
} from "../scripts/ci-ga-desktop-relay.mjs";

const tempRoots: string[] = [];
afterEach(() => {
  for (const r of tempRoots) fs.rmSync(r, { force: true, recursive: true });
  tempRoots.length = 0;
});

const BASE_ENV = {
  CNB_RELEASE_TOKEN: "release-token",
  CNB_REPO_SLUG: "moon-read/comfy-app-t3",
  CNB_API_ENDPOINT: "https://api.cnb.cool",
  GITHUB_RUN_ID: "4242",
  GITHUB_SHA: "a".repeat(40),
};

/** 造一棵独立的纯壳树：真实 GA 里 `app.exe` 在 `target/release/`、bundle 在
 * `target/release/bundle/`（父子不相交），夹具照这个关系放在**另一个**临时根，
 * 免得 `collectBundles` 遍历 bundleDir 时把这一个 .exe 又当安装包收一遍。 */
function makeShell() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ga-desktop-shell-"));
  tempRoots.push(root);
  const dir = path.join(root, "src-tauri", "target", "release");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "app.exe"), "SHELL");
  return path.join(dir, "app.exe");
}

const CTX = {
  endpoint: "https://api.cnb.cool",
  repo: "moon-read/comfy-app-t3",
  token: "release-token",
};

const neverFetch: typeof fetch = () => Promise.reject(new Error("这一跑不该发任何网络"));

/** 是不是可按字段取值的对象（type predicate，避开 JSON.parse 的 any 断言）。 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function lines() {
  const out: string[] = [];
  return { log: (l: string) => out.push(l), out };
}

/** 造一棵临时成品树：nsis/*.exe + msi/*.msi + portable/*.zip。 */
function makeBundles() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ga-desktop-relay-"));
  for (const d of ["nsis", "msi", "portable"]) {
    fs.mkdirSync(path.join(root, d), { recursive: true });
  }
  const files: Record<string, string> = {
    "nsis/ComfyAPP_0.1.0_x64-setup.exe": "EXE",
    "msi/ComfyAPP_0.1.0_x64_en-US.msi": "MSI",
    "portable/ComfyAPP-portable.zip": "ZIP",
    "nsis/readme.txt": "not an installer",
  };
  for (const [rel, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, rel), content);
  }
  return root;
}

describe("① 前提 fail-closed：缺一件就是没判过", () => {
  it("齐全时可发起", () => {
    const ctx = resolveDesktopRelayContext(BASE_ENV);
    expect(ctx.ok).toBe(true);
    expect(ctx.ok && ctx.repo).toBe("moon-read/comfy-app-t3");
  });

  it("纯壳落点缺省 app.exe、可由 DESKTOP_SHELL_EXE 覆盖", () => {
    const base = resolveDesktopRelayContext(BASE_ENV);
    expect(base.ok && base.shellExe).toBe("src-tauri/target/release/app.exe");
    const overridden = resolveDesktopRelayContext({
      ...BASE_ENV,
      DESKTOP_SHELL_EXE: "out/shell.exe",
    });
    expect(overridden.ok && overridden.shellExe).toBe("out/shell.exe");
  });

  it("缺 CNB_RELEASE_TOKEN / CNB_REPO_SLUG 都退 2，且逐条点名", async () => {
    for (const missing of ["CNB_RELEASE_TOKEN", "CNB_REPO_SLUG"] as const) {
      const env = { ...BASE_ENV, [missing]: "" };
      const { out, log } = lines();
      // oxlint-disable-next-line no-await-in-loop -- 逐个前提串行验「缺一件就退 2」，顺序即读数
      const code = await main({ argv: [], cwd: os.tmpdir(), env, fetchImpl: neverFetch, log });
      expect(code).toBe(CODE.NO_FACT);
      expect(out.join("\n")).toContain(missing);
    }
  });

  it("一份成品都没有 ⇒ 没判过（不是绿），话术指到构建落点", async () => {
    const { out, log } = lines();
    const code = await main({
      argv: [],
      cwd: os.tmpdir(),
      env: BASE_ENV,
      fetchImpl: neverFetch,
      log,
    });
    expect(code).toBe(CODE.NO_FACT);
    expect(out.join("\n")).toContain("没判过");
    expect(out.join("\n")).toContain("bundle");
  });
});

describe("② 成品收集：从盘上真读，不硬编码文件名", () => {
  it("收 nsis/*.exe + msi/*.msi + portable zip，跳过 .txt，附件名带形态前缀", () => {
    const root = makeBundles();
    tempRoots.push(root);
    const files = collectBundles(
      { bundleDir: root, portable: path.join(root, "portable/ComfyAPP-portable.zip") },
      root,
    );
    expect(files.map((f) => f.assetName)).toEqual([
      "ComfyAPP-portable.zip",
      "msi-ComfyAPP_0.1.0_x64_en-US.msi",
      "nsis-ComfyAPP_0.1.0_x64-setup.exe",
    ]);
    expect(files.every((f) => f.bytes > 0)).toBe(true);
    expect(files.find((f) => f.kind === "portable")?.assetName).toBe("ComfyAPP-portable.zip");
  });

  it("纯壳单文件从盘上真读，资产名固定、kind=shell、与完整成品分列", () => {
    const root = makeBundles();
    tempRoots.push(root);
    const shellRel = makeShell();
    const files = collectBundles(
      {
        bundleDir: root,
        portable: path.join(root, "portable/ComfyAPP-portable.zip"),
        shellExe: shellRel,
      },
      root,
    );
    const shell = files.find((f) => f.kind === "shell");
    expect(shell?.assetName).toBe(SHELL_ASSET_NAME);
    expect(shell?.bytes).toBe(5);
    /* 纯壳不在 bundle 目录里被当安装包收一遍：仍只有 nsis / msi 两个 installer。 */
    expect(files.filter((f) => f.kind === "installer")).toHaveLength(2);
    expect(files.filter((f) => f.kind === "shell")).toHaveLength(1);
  });

  it("纯壳缺席不补造、不抛：其余成品照收", () => {
    const root = makeBundles();
    tempRoots.push(root);
    const files = collectBundles(
      {
        bundleDir: root,
        portable: path.join(root, "portable/ComfyAPP-portable.zip"),
        shellExe: path.join(root, "nope/app.exe"),
      },
      root,
    );
    expect(files.some((f) => f.kind === "shell")).toBe(false);
    expect(files.length).toBe(3);
  });

  it("bundle 目录不存在时也认 portable（不抛）", () => {
    const root = makeBundles();
    tempRoots.push(root);
    const files = collectBundles(
      {
        bundleDir: path.join(root, "nope"),
        portable: path.join(root, "portable/ComfyAPP-portable.zip"),
      },
      root,
    );
    expect(files.map((f) => f.assetName)).toEqual(["ComfyAPP-portable.zip"]);
  });
});

describe("③ verify_url 拆解（CLI 明示的两个 path 参数来源）", () => {
  it("绝对 URL：拆出 token 与含斜杠的 asset_path", () => {
    const v =
      "https://api.cnb.cool/moon-read/comfy-app-t3/-/releases/77/asset-upload-confirmation/tk-abc/releases/77/x.zip";
    expect(parseVerifyUrl(v)).toEqual({ assetPath: "releases/77/x.zip", uploadToken: "tk-abc" });
  });

  it("相对路径也认", () => {
    const v = "/-/releases/77/asset-upload-confirmation/tok/a/b/c.exe";
    expect(parseVerifyUrl(v)).toEqual({ assetPath: "a/b/c.exe", uploadToken: "tok" });
  });

  it("空 / 缺尾段 / 缺 path ⇒ null（不猜）", () => {
    expect(parseVerifyUrl("")).toBeNull();
    expect(parseVerifyUrl("https://x/-/releases/77")).toBeNull();
    expect(parseVerifyUrl("/-/releases/77/asset-upload-confirmation/tok/")).toBeNull();
    expect(parseVerifyUrl("/-/releases/77/asset-upload-confirmation//path")).toBeNull();
  });
});

/** CNB 侧假 fetch：按 method + URL 分派，记录每一步，可让任一步失败。 */
function cnbFetch(
  opts: {
    badVerify?: boolean;
    fail?: "get" | "create" | "url" | "put" | "confirm";
    missingTargetCommitish?: boolean;
    releaseExists?: boolean;
  } = {},
) {
  const calls: Array<{ auth: string; body: unknown; method: string; url: string }> = [];
  const exists = opts.releaseExists ?? true;
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    await Promise.resolve();
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";
    const rawHeaders = init?.headers;
    let auth = "";
    if (rawHeaders instanceof Headers) {
      auth = rawHeaders.get("Authorization") ?? "";
    } else if (rawHeaders && !Array.isArray(rawHeaders) && typeof rawHeaders === "object") {
      const record: Record<string, unknown> = rawHeaders;
      auth = typeof record.Authorization === "string" ? record.Authorization : "";
    }
    const body = typeof init?.body === "string" ? init.body : init?.body;
    calls.push({ auth, body, method, url });
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        headers: { "content-type": "application/json" },
        status,
      });

    if (method === "GET" && url.includes("/releases/tags/")) {
      if (opts.fail === "get") return json({ errcode: 500 }, 500);
      if (!exists) return json({ errcode: 404, errmsg: "not found" }, 404);
      return json({ data: { id: "77" } });
    }
    if (method === "POST" && url.endsWith("/-/releases")) {
      if (opts.fail === "create") return json({ errcode: 403 }, 403);
      /* 服务端对 target_commitish 是硬必填（#3611 现场 400），假件按同一形状判。 */
      const raw = typeof body === "string" ? body : "{}";
      const parsed: unknown = JSON.parse(raw);
      const form = isRecord(parsed) ? parsed : {};
      if (opts.missingTargetCommitish) {
        return json({ errcode: 2_000_001, errmsg: "target_commitish is required" }, 400);
      }
      if (typeof form.target_commitish !== "string" || form.target_commitish === "") {
        return json({ errcode: 2_000_001, errmsg: "target_commitish is required" }, 400);
      }
      return json({ data: { id: "77" } }, 201);
    }
    if (method === "POST" && url.endsWith("/asset-upload-url")) {
      if (opts.fail === "url") return json({ errcode: 500 }, 500);
      return json(
        {
          data: {
            upload_url: "https://asset.cnb.cool/put/x",
            verify_url: opts.badVerify
              ? "https://asset.cnb.cool/no-marker"
              : `${CTX.endpoint}/${CTX.repo}/-/releases/77/asset-upload-confirmation/tk-abc/releases/77/x.zip`,
          },
        },
        201,
      );
    }
    if (method === "PUT") {
      if (opts.fail === "put") return new Response("no", { status: 500 });
      return new Response("", { status: 200 });
    }
    if (method === "POST" && url.includes("/asset-upload-confirmation/")) {
      if (opts.fail === "confirm") return json({ errcode: 500 }, 500);
      return new Response("", { status: 200 });
    }
    return new Response("not found", { status: 404 });
  };
  return { calls, fetchImpl };
}

describe("④ ensureRelease：复用已存在的 nightly，缺席才建", () => {
  it("已存在：只读 tag，不 POST /-/releases", async () => {
    const { calls, fetchImpl } = cnbFetch({ releaseExists: true });
    const { log } = lines();
    const r = await ensureRelease(
      { ctx: CTX, fetchImpl, log },
      { runId: "4242", sha: "a".repeat(40), targetCommitish: "master" },
    );
    expect(r).toEqual({ created: false, id: "77", ok: true });
    expect(calls.map((c) => c.method)).toEqual(["GET"]);
  });

  it("缺席：GET 404 ⇒ 建一份（prerelease + 滚动 tag），拿到 id", async () => {
    const { calls, fetchImpl } = cnbFetch({ releaseExists: false });
    const { log } = lines();
    const r = await ensureRelease(
      { ctx: CTX, fetchImpl, log },
      { runId: "4242", sha: "a".repeat(40), targetCommitish: "master" },
    );
    expect(r.ok).toBe(true);
    expect(r.ok && r.created).toBe(true);
    const create = calls.find((c) => c.method === "POST" && c.url.endsWith("/-/releases"));
    expect(create).toBeTruthy();
    const bodyText = typeof create?.body === "string" ? create.body : "{}";
    const parsed: unknown = JSON.parse(bodyText);
    const body = isRecord(parsed) ? parsed : {};
    expect(body.tag_name).toBe(RELEASE_TAG);
    expect(body.prerelease).toBe(true);
    expect(body.target_commitish).toBe("master");
  });

  it("GET 非 404 的失败不冒充「没有」接着建", async () => {
    const { calls, fetchImpl } = cnbFetch({ fail: "get" });
    const { log } = lines();
    const r = await ensureRelease(
      { ctx: CTX, fetchImpl, log },
      { runId: "", sha: "", targetCommitish: "master" },
    );
    expect(r.ok).toBe(false);
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  /* ISSUE #3611 现场：服务端对 target_commitish 是硬必填，漏带 ⇒ 400
   * {"errcode":2_000_001,"errmsg":"target_commitish is required"}。判据要在本地就
   * 把这一形拦下来 —— 旧假件对 create 无条件 201，正是缺口漏到真跑的原因。 */
  it("创建 payload 缺 target_commitish ⇒ 服务端 400 被如实传回，不吞、不判绿", async () => {
    const { fetchImpl } = cnbFetch({ missingTargetCommitish: true, releaseExists: false });
    const { log } = lines();
    const r = await ensureRelease(
      { ctx: CTX, fetchImpl, log },
      { runId: "4242", sha: "a".repeat(40), targetCommitish: "master" },
    );
    expect(r.ok).toBe(false);
    /* r.ok 为 true 时给一个不可能匹配的空串，让下面两条断言无条件跑、且必然红。 */
    const detail = r.ok ? "" : r.detail;
    expect(detail).toContain("HTTP 400");
    expect(detail).toContain("target_commitish is required");
  });

  it("resolveDesktopRelayContext：target_commitish 缺省 master、可由 CNB_RELEASE_TARGET 覆盖", () => {
    const base = resolveDesktopRelayContext(BASE_ENV);
    expect(base.ok && base.targetCommitish).toBe("master");
    const overridden = resolveDesktopRelayContext({
      ...BASE_ENV,
      CNB_RELEASE_TARGET: "release/1.0",
    });
    expect(overridden.ok && overridden.targetCommitish).toBe("release/1.0");
    /* 空串不算覆盖：回落到默认分支，不把空 target_commitish 发给服务端。 */
    const blank = resolveDesktopRelayContext({ ...BASE_ENV, CNB_RELEASE_TARGET: "  " });
    expect(blank.ok && blank.targetCommitish).toBe("master");
  });
});

describe("⑤ 上传链：取地址 → PUT → 确认，PUT 不带 auth", () => {
  /** 每个用例自建一棵临时树，absPath 指向真实文件（假 PUT 不消费正文也要能读）。 */
  function fileFixture() {
    const root = makeBundles();
    tempRoots.push(root);
    return {
      absPath: path.join(root, "nsis/ComfyAPP_0.1.0_x64-setup.exe"),
      assetName: "nsis-x.exe",
      bytes: 3,
      kind: "installer" as const,
    };
  }

  it("三步齐发：确认带 ttl=0，PUT 不带 Authorization", async () => {
    const file = fileFixture();
    const { calls, fetchImpl } = cnbFetch();
    const { log } = lines();
    const r = await uploadAsset({ ctx: CTX, fetchImpl, log }, "77", file);
    expect(r.ok).toBe(true);
    expect(calls.map((c) => c.method)).toEqual(["POST", "PUT", "POST"]);
    const put = calls[1];
    expect(put?.auth).toBe("");
    const confirm = calls[2];
    expect(confirm?.url).toContain("asset-upload-confirmation/tk-abc/releases/77/x.zip");
    expect(confirm?.url).toContain("ttl=0");
  });

  it("verify_url 拆不出 token/path ⇒ 失败，不发 PUT", async () => {
    const file = fileFixture();
    const { calls, fetchImpl } = cnbFetch({ badVerify: true });
    const { log } = lines();
    const r = await uploadAsset({ ctx: CTX, fetchImpl, log }, "77", file);
    expect(r.ok).toBe(false);
    expect(calls.map((c) => c.method)).toEqual(["POST"]);
  });

  it("取地址 / PUT / 确认 任一步失败 ⇒ 失败（不假装送达）", async () => {
    for (const fail of ["url", "put", "confirm"] as const) {
      const file = fileFixture();
      const { fetchImpl } = cnbFetch({ fail });
      const { log } = lines();
      // oxlint-disable-next-line no-await-in-loop -- 逐个失败档串行验，互不并发
      const r = await uploadAsset({ ctx: CTX, fetchImpl, log }, "77", file);
      expect(r.ok).toBe(false);
    }
  });

  it("putAsset 走 Buffer 正文 + octet-stream + 同源 Content-Length", async () => {
    const root = makeBundles();
    tempRoots.push(root);
    let seen: RequestInit | undefined;
    const fetchImpl: typeof fetch = (_u: RequestInfo | URL, init?: RequestInit) => {
      seen = init;
      return Promise.resolve(new Response("", { status: 200 }));
    };
    const r = await putAsset(
      { fetchImpl, log: () => undefined },
      {
        absPath: path.join(root, "nsis/ComfyAPP_0.1.0_x64-setup.exe"),
        assetName: "x.exe",
        bytes: 3,
        uploadUrl: "https://asset.cnb.cool/put",
      },
    );
    expect(r.ok).toBe(true);
    expect(seen?.method).toBe("PUT");
    expect(seen?.body).toBeInstanceOf(Buffer);
    const bodyBuffer = seen?.body;
    const byteLength = bodyBuffer instanceof Buffer ? bodyBuffer.byteLength : -1;
    const headers: Record<string, unknown> =
      seen?.headers && !Array.isArray(seen.headers) && !(seen.headers instanceof Headers)
        ? seen.headers
        : {};
    expect(headers["Content-Type"]).toBe("application/octet-stream");
    expect(headers["Content-Length"]).toBe(String(byteLength));
    expect(seen && "duplex" in seen ? seen.duplex : undefined).toBeUndefined();
  });

  /* ISSUE #3621：二进制 PUT 的墙钟按分钟级给，不用 JSON 请求的 30/60s 口径。 */
  it("PUT 墙钟是分钟级（>=300000ms），不是 cnbRequest 那档 60s", () => {
    expect(PUT_TIMEOUT_MS).toBeGreaterThanOrEqual(300_000);
    expect(PUT_MAX_ATTEMPTS).toBe(3);
  });

  it("超时 / 网络类失败重试到绿：假 sleep 不真等，重试送同一份 Buffer", async () => {
    const root = makeBundles();
    tempRoots.push(root);
    const absPath = path.join(root, "nsis/ComfyAPP_0.1.0_x64-setup.exe");
    let attempts = 0;
    const bodies: Buffer[] = [];
    const sleeps: number[] = [];
    const fetchImpl: typeof fetch = (_u: RequestInfo | URL, init?: RequestInit) => {
      attempts += 1;
      if (init?.body instanceof Buffer) bodies.push(init.body);
      if (attempts < 3) {
        /* 现场原话：AbortSignal.timeout 抛出的客户端掐断形。 */
        return Promise.reject(new Error("TimeoutError: The operation was aborted due to timeout"));
      }
      return Promise.resolve(new Response("", { status: 200 }));
    };
    const log = lines();
    const r = await putAsset(
      {
        fetchImpl,
        log: log.log,
        sleep: (ms) => {
          sleeps.push(ms);
          return Promise.resolve();
        },
      },
      { absPath, assetName: "x.exe", bytes: 3, uploadUrl: "https://asset.cnb.cool/put" },
    );
    expect(r.ok).toBe(true);
    expect(attempts).toBe(3);
    expect(sleeps).toEqual([5000, 10_000]);
    /* 整轮只读一次盘：三跳送的是同一份字节，Content-Length 与正文不分家。 */
    expect(bodies).toHaveLength(3);
    expect(bodies[0]).toBe(bodies[1]);
    expect(bodies[1]).toBe(bodies[2]);
    expect(log.out.join("\n")).toContain("后重试");
  });

  it("HTTP 应答（4xx/5xx）一次交账、不重发整份二进制", async () => {
    const root = makeBundles();
    tempRoots.push(root);
    const absPath = path.join(root, "nsis/ComfyAPP_0.1.0_x64-setup.exe");
    let attempts = 0;
    const fetchImpl: typeof fetch = () => {
      attempts += 1;
      return Promise.resolve(new Response("no", { status: 500 }));
    };
    const sleeps: number[] = [];
    const r = await putAsset(
      {
        fetchImpl,
        log: () => undefined,
        sleep: (ms) => {
          sleeps.push(ms);
          return Promise.resolve();
        },
      },
      { absPath, assetName: "x.exe", bytes: 3, uploadUrl: "https://asset.cnb.cool/put" },
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.detail).toContain("HTTP 500");
    expect(attempts).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it("网络类失败用尽尝试仍红：detail 带最后一次原话，不假装送达", async () => {
    const root = makeBundles();
    tempRoots.push(root);
    const absPath = path.join(root, "nsis/ComfyAPP_0.1.0_x64-setup.exe");
    let attempts = 0;
    const fetchImpl: typeof fetch = () => {
      attempts += 1;
      return Promise.reject(new Error("fetch failed"));
    };
    const r = await putAsset(
      {
        fetchImpl,
        log: () => undefined,
        sleep: () => Promise.resolve(),
      },
      { absPath, assetName: "x.exe", bytes: 3, uploadUrl: "https://asset.cnb.cool/put" },
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.detail).toContain("fetch failed");
    expect(attempts).toBe(PUT_MAX_ATTEMPTS);
  });
});

describe("⑥ 脱敏：令牌形状不回显", () => {
  it("精确令牌 / ghp_ / Bearer 尾段抹成 <redacted>", () => {
    const out = redact(
      "token=release-token ghp_abcdefghijklmnopqrstuvwxyz Bearer abc123def456",
      "release-token",
    );
    expect(out).not.toContain("release-token");
    expect(out).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz");
    expect(out).toContain("<redacted>");
  });
});

describe("⑦ dry-run：一条网络都不发", () => {
  it("前提齐 + 有成品时仍不发请求，退 0", async () => {
    const root = makeBundles();
    tempRoots.push(root);
    const { out, log } = lines();
    const code = await main({
      argv: ["--dry-run"],
      cwd: root,
      env: {
        ...BASE_ENV,
        DESKTOP_BUNDLE_DIR: root,
        DESKTOP_PORTABLE: path.join(root, "portable/ComfyAPP-portable.zip"),
      },
      fetchImpl: neverFetch,
      log,
    });
    expect(code).toBe(CODE.OK);
    expect(out.join("\n")).toContain("DRY-RUN");
  });
});

describe("⑧ 端到端：出口话术给 CNB 站内取包地", () => {
  it("main 全绿 ⇒ 念出 CNB release tag 链接，不是 GitHub", async () => {
    const root = makeBundles();
    tempRoots.push(root);
    const { calls, fetchImpl } = cnbFetch();
    const { out, log } = lines();
    const code = await main({
      argv: [],
      cwd: root,
      env: {
        ...BASE_ENV,
        DESKTOP_BUNDLE_DIR: root,
        DESKTOP_PORTABLE: path.join(root, "portable/ComfyAPP-portable.zip"),
      },
      fetchImpl,
      log,
    });
    expect(code).toBe(CODE.OK);
    const text = out.join("\n");
    expect(text).toContain("已搬到 CNB");
    expect(text).toContain("moon-read/comfy-app-t3/-/releases/download/nightly/");
    expect(text).not.toContain("github.com");
    /* 3 份完整成品：每份 3 步 = 9，加 1 次读 tag = 10。 */
    expect(calls.length).toBe(10);
  });

  /* #3607 纯壳那一半：连单文件壳一起回传，出口话术给出「放进检出根、dev server 照用」。 */
  it("带纯壳的端到端：4 份全绿，出口念出纯壳落点与 dev server 用法", async () => {
    const root = makeBundles();
    tempRoots.push(root);
    const shellRel = makeShell();
    const { calls, fetchImpl } = cnbFetch();
    const { out, log } = lines();
    const code = await main({
      argv: [],
      cwd: root,
      env: {
        ...BASE_ENV,
        DESKTOP_BUNDLE_DIR: root,
        DESKTOP_PORTABLE: path.join(root, "portable/ComfyAPP-portable.zip"),
        DESKTOP_SHELL_EXE: shellRel,
      },
      fetchImpl,
      log,
    });
    expect(code).toBe(CODE.OK);
    /* 4 份成品：每份 3 步 = 12，加 1 次读 tag = 13。 */
    expect(calls.length).toBe(13);
    const text = out.join("\n");
    expect(text).toContain(SHELL_ASSET_NAME);
    expect(text).toContain("src-tauri/target/release/app.exe");
    expect(text).toContain("dev server");
  });

  /* #3611 补的盲区：真实跑里 create 一挂，其后的「取地址 → PUT → 确认」三步从没
   * 在假件上连着跑过。这里让 nightly 首次创建（GET 404）走完整条链，坐实修完
   * create 之后不会在下一步又挂。 */
  it("nightly 首次创建：GET 404 ⇒ create 带 target_commitish ⇒ 3 份成品各走三步全绿", async () => {
    const root = makeBundles();
    tempRoots.push(root);
    const { calls, fetchImpl } = cnbFetch({ releaseExists: false });
    const { out, log } = lines();
    const code = await main({
      argv: [],
      cwd: root,
      env: {
        ...BASE_ENV,
        DESKTOP_BUNDLE_DIR: root,
        DESKTOP_PORTABLE: path.join(root, "portable/ComfyAPP-portable.zip"),
      },
      fetchImpl,
      log,
    });
    expect(code).toBe(CODE.OK);
    const create = calls.find((c) => c.method === "POST" && c.url.endsWith("/-/releases"));
    const form: unknown = JSON.parse(typeof create?.body === "string" ? create.body : "{}");
    expect(isRecord(form) && form.target_commitish).toBe("master");
    /* 读 tag(1) + create(1) + 3 份 × 3 步 = 11。 */
    expect(calls.length).toBe(11);
    expect(out.join("\n")).toContain("已搬到 CNB");
  });
});
