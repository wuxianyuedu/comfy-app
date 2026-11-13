/**
 * `scripts/fetch-daily-shell.mjs` 的判据（ISSUE #3722 / #3728）：规范落点、
 * 下载端点、401/404 失败出口、鉴权重试与成功落盘。该工具自上线起一直没有判据，
 * 落点与端点各改过一次都没有用例钉住，所以「目录还是旧的」「资产没产出」
 * 这两类误读要在这里被挡住。
 *
 * 下载端点必须是 CNB OpenAPI 的 api.cnb.cool（官方文档、与回传侧同源），不是网页站
 * cnb.cool：后者匿名 404、带令牌 400，曾把一次「打错主机」误读成「上游没产出」。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_API_ENDPOINT,
  DEFAULT_ASSET,
  DEFAULT_OUT,
  buildDownloadUrl,
  downloadToBuffer,
  main,
  parseArgs,
  resolveEndpoint,
  resolveToken,
  usage,
} from "../scripts/fetch-daily-shell.mjs";

const tmpDirs: Array<string> = [];

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-daily-shell-"));
  tmpDirs.push(dir);
  return dir;
}

/** 造一份 HTTP 响应桩；404 的正文就是平台回话的形状，成功侧用字符串当二进制内容。 */
function respond(status: number, body: string): Response {
  return new Response(body, { status });
}

/** 捕获 main() 两路输出，避免用例把日志打进 vitest 自己的输出。 */
async function captureMain(io: {
  argv?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  platform?: NodeJS.Platform;
}): Promise<{ code: number; err: string; out: string }> {
  const outChunks: Array<string> = [];
  const errChunks: Array<string> = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    outChunks.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    errChunks.push(String(chunk));
    return true;
  });
  const code = await main(io);
  return { code, err: errChunks.join(""), out: outChunks.join("") };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

describe("fetch-daily-shell 默认形态", () => {
  it("默认落点是规范 target/release，帮助文本不残留旧目录", () => {
    expect(DEFAULT_OUT).toBe(path.join("src-tauri", "target", "release", "app.exe"));
    expect(usage()).toContain("src-tauri/target/release/app.exe");
    expect(usage()).not.toContain("默认 src-tauri/release/app.exe");
    expect(parseArgs([]).out).toBe(DEFAULT_OUT);
  });

  it("下载 URL 走 CNB OpenAPI 端点，与回传侧同一形态", () => {
    expect(DEFAULT_API_ENDPOINT).toBe("https://api.cnb.cool");
    expect(
      buildDownloadUrl({ asset: DEFAULT_ASSET, repo: "moon-read/comfy-app-t3", tag: "nightly" }),
    ).toBe(
      "https://api.cnb.cool/moon-read/comfy-app-t3/-/releases/download/nightly/ComfyAPP-shell.exe",
    );
  });

  it("端点可由 CNB_API_ENDPOINT 覆盖，尾斜杠不重复拼", () => {
    expect(resolveEndpoint({})).toBe(DEFAULT_API_ENDPOINT);
    expect(resolveEndpoint({ CNB_API_ENDPOINT: "https://cnb.example/" })).toBe(
      "https://cnb.example",
    );
    expect(
      buildDownloadUrl({
        asset: DEFAULT_ASSET,
        endpoint: "https://cnb.example/",
        repo: "moon-read/comfy-app-t3",
        tag: "nightly",
      }),
    ).toBe(
      "https://cnb.example/moon-read/comfy-app-t3/-/releases/download/nightly/ComfyAPP-shell.exe",
    );
  });

  it("令牌按显式 → 三个环境变量 → 用户级令牌文件的顺序取", () => {
    expect(resolveToken({}, "", { configPaths: [] }).from).toBe("");
    expect(resolveToken({ CNB_TOKEN: "t" }, "", { configPaths: [] }).from).toBe("CNB_TOKEN");
    expect(
      resolveToken({ CNB_RELEASE_TOKEN: "r", CNB_TOKEN: "t" }, "", { configPaths: [] }).from,
    ).toBe("CNB_RELEASE_TOKEN");
    expect(resolveToken({ CNB_TOKEN: "t" }, "x", { configPaths: [] }).from).toBe("--token");

    const files: Record<string, string> = { "/cfg/token": "  file-token\r\n" };
    const fromFile = resolveToken({}, "", {
      configPaths: ["/cfg/missing", "/cfg/token"],
      readFileSync: (p) => {
        if (!(p in files)) {
          throw new Error("ENOENT");
        }
        return files[p]!;
      },
    });
    expect(fromFile.token).toBe("file-token");
    expect(fromFile.from).toBe(path.normalize("/cfg/token"));

    const envWins = resolveToken({ CNB_ISSUE_TOKEN: "env-token" }, "", {
      configPaths: ["/cfg/token"],
      readFileSync: () => "file-token",
    });
    expect(envWins).toEqual({ token: "env-token", from: "CNB_ISSUE_TOKEN" });
  });
});

describe("401 / 404 失败出口（ISSUE #3728）", () => {
  it("404 只指向资产名/tag/repo，不再念成上游未产出，也不引向改路径", async () => {
    const dir = makeTmpDir();
    const result = await captureMain({
      argv: [],
      cwd: dir,
      env: { NODE_ENV: "test" },
      fetchImpl: () => Promise.resolve(respond(404, '{"errcode":404,"errmsg":"Not Found"}')),
      platform: "linux",
    });
    expect(result.code).toBe(1);
    expect(result.err).toContain("下载失败（HTTP 404）");
    expect(result.err).toContain("该地址下没有");
    expect(result.err).toContain("不要改落点");
    expect(result.err).toContain("build-tauri-release.ps1");
    expect(result.err).not.toContain("上游资产尚未产出");
    expect(result.out).toContain("https://api.cnb.cool/");
    expect(result.out).toContain(DEFAULT_OUT);
    expect(fs.existsSync(path.join(dir, DEFAULT_OUT))).toBe(false);
  });

  it("401 明确要求登录态与 repo-release:r，并给出令牌文件配置引导", async () => {
    const dir = makeTmpDir();
    const result = await captureMain({
      argv: [],
      cwd: dir,
      env: { NODE_ENV: "test", APPDATA: String.raw`C:\Users\u\AppData\Roaming` },
      fetchImpl: () => Promise.resolve(respond(401, '{"errcode":16,"errmsg":"not logged in"}')),
      platform: "win32",
    });
    expect(result.code).toBe(1);
    expect(result.err).toContain("下载失败（HTTP 401）");
    expect(result.err).toContain("repo-release:r");
    expect(result.err).toContain("CNB_RELEASE_TOKEN");
    expect(result.err).toContain("cnb-release-token");
    expect(result.err).toContain("未检测到可用令牌");
    expect(result.err).not.toContain("该地址下没有");
  });
});

describe("下载与落盘", () => {
  it("匿名 401 且有令牌时，第二次带 Authorization 才成功", async () => {
    const authFlags: Array<boolean> = [];
    const responses = [respond(401, "unauthorized"), respond(200, "ok")];
    const fetchStub = (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      authFlags.push(Object.keys(init?.headers ?? {}).includes("Authorization"));
      return Promise.resolve(responses.shift() ?? respond(500, "no more"));
    };
    const result = await downloadToBuffer("https://example.invalid/asset", {
      fetchImpl: fetchStub,
      token: "tok",
    });
    expect(result.ok).toBe(true);
    expect(authFlags).toEqual([false, true]);
  });

  it("下载成功后写到规范落点，非 Windows 跳过快捷方式", async () => {
    const dir = makeTmpDir();
    const payload = "shell-bytes";
    const result = await captureMain({
      argv: [],
      cwd: dir,
      env: { NODE_ENV: "test" },
      fetchImpl: () => Promise.resolve(respond(200, payload)),
      platform: "linux",
    });
    expect(result.code).toBe(0);
    expect(fs.readFileSync(path.join(dir, DEFAULT_OUT), "utf8")).toBe(payload);
    expect(result.out).toContain("已下载");
    expect(result.out).toContain("非 Windows 平台");
  });
});
