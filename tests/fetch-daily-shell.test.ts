/**
 * `scripts/devtools/fetch-daily-shell.mjs` 的判据（ISSUE #3722 / #3728）：规范落点、
 * 下载端点、401/404 失败出口、鉴权重试与成功落盘。该工具自上线起一直没有判据，
 * 落点与端点各改过一次都没有用例钉住，所以「目录还是旧的」「资产没产出」
 * 这两类误读要在这里被挡住。
 *
 * 下载端点必须是 CNB OpenAPI 的 api.cnb.cool（官方文档、与回传侧同源），不是网页站
 * cnb.cool：后者匿名 404、带令牌 400，曾把一次「打错主机」误读成「上游没产出」。
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BUILD_INFO_ASSET,
  DEFAULT_API_ENDPOINT,
  DEFAULT_ASSET,
  DEFAULT_OUT,
  RENAME_RETRY_DELAYS_MS,
  buildDownloadUrl,
  describeBuildInfo,
  describeRenameFailure,
  downloadToBuffer,
  findRunningProcessesByImage,
  MISSING_TOKEN_HINT,
  main,
  parseArgs,
  resolveEndpoint,
  resolveToken,
  usage,
  writeFileAtomic,
  writeTokenConfigFile,
} from "../scripts/devtools/fetch-daily-shell.mjs";

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
  /** 建于临时目录下的令牌文件候选（不传即用真实 homedir，本机可能已有真令牌）。 */
  configPaths?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  platform?: NodeJS.Platform;
  /** 注入落盘实现：用于让「下载成功但写不进去」在用例里确定性地发生。 */
  writeFile?: typeof writeFileAtomic;
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
        const key = String(p);
        if (!(key in files)) {
          throw new Error("ENOENT");
        }
        return files[key]!;
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
      /* USERPROFILE 一并给假的：脚本从**同一份 env** 取 home（令牌文件链的那一格），
       * 真机 `~` 下恰好有令牌文件时，「未检测到可用令牌」这一格的前提才不破。 */
      env: {
        NODE_ENV: "test",
        APPDATA: String.raw`C:\Users\u\AppData\Roaming`,
        USERPROFILE: String.raw`C:\Users\u`,
      },
      fetchImpl: () => Promise.resolve(respond(401, '{"errcode":16,"errmsg":"not logged in"}')),
      platform: "win32",
      configPaths: [path.join(dir, "comfy-app", "cnb-release-token")],
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

describe("用户级令牌文件（ISSUE #3917）", () => {
  it("这些路径缺省都不存在，无令牌时把候选清单与存在状态念出来", async () => {
    const dir = makeTmpDir();
    const result = await captureMain({
      argv: ["--dry-run"],
      cwd: dir,
      env: { NODE_ENV: "test", HOME: dir },
      platform: "linux",
    });
    expect(result.out).toContain("鉴权：无（直连）");
    expect(result.out).toContain("cnb-release-token（不存在）");
    expect(result.out).toContain("--config --token");
  });

  it("缺令牌时日志逐字念出要执行的那一条命令（ISSUE #3917）", async () => {
    const dir = makeTmpDir();
    const result = await captureMain({
      argv: ["--dry-run"],
      cwd: dir,
      env: { NODE_ENV: "test", HOME: dir },
      platform: "linux",
    });
    // 这一行是「下一步做什么」的唯一形状：命令行里得能直接照抄。
    expect(result.out).toContain(`缺令牌，先执行：${MISSING_TOKEN_HINT}`);
    expect(MISSING_TOKEN_HINT).toBe(
      "pnpm fetch:daily-shell --config --token <你的CNB_RELEASE_TOKEN>",
    );
    // 预演阶段就是补齐令牌的最后时机：缺令牌退 2（走 stderr），不许静默退 0 冒充「可以跑了」。
    expect(result.code).toBe(2);
    expect(result.err).toContain(MISSING_TOKEN_HINT);
  });

  it("有令牌时 --dry-run 不加缺令牌提示、照常退 0", async () => {
    const dir = makeTmpDir();
    const result = await captureMain({
      argv: ["--dry-run"],
      cwd: dir,
      env: { NODE_ENV: "test", CNB_RELEASE_TOKEN: "tok", HOME: dir },
      platform: "linux",
    });
    expect(result.code).toBe(0);
    expect(result.out).toContain("鉴权：CNB_RELEASE_TOKEN");
    expect(result.out).not.toContain(MISSING_TOKEN_HINT);
    expect(result.err).not.toContain(MISSING_TOKEN_HINT);
  });

  it("401 且无令牌时，失败出口同样给出那条命令", async () => {
    const dir = makeTmpDir();
    const result = await captureMain({
      argv: [],
      cwd: dir,
      env: { NODE_ENV: "test", HOME: dir },
      fetchImpl: () => Promise.resolve(respond(401, '{"errcode":16}')),
      platform: "linux",
      configPaths: [path.join(dir, "comfy-app", "cnb-release-token")],
    });
    expect(result.code).toBe(1);
    expect(result.err).toContain(MISSING_TOKEN_HINT);
    /* 目标路径只作补充说明（这里念的是候选清单第一个，不是注入的 configPaths ——
     * 那是「脚本自己会写哪儿」，不是「这一跑读过哪儿」），命令本身仍是可照抄的那一条。 */
    expect(result.err).toContain(path.join(dir, ".config", "comfy-app", "cnb-release-token"));
    expect(result.err).toContain("令牌将写入候选清单第一个");
  });

  it("--config 把令牌写进候选路径里的第一个，且只写令牌本体", async () => {
    const dir = makeTmpDir();
    const result = await captureMain({
      argv: ["--config", "--token", "tok-from-flag"],
      cwd: dir,
      env: { NODE_ENV: "test", HOME: dir },
      platform: "linux",
    });
    expect(result.code).toBe(0);
    const target = path.join(dir, ".config", "comfy-app", "cnb-release-token");
    expect(result.out).toContain(target);
    expect(fs.readFileSync(target, "utf8")).toBe("tok-from-flag\n");
    // 写完之后下载链就能取到它 —— 这条是「本地没有这个路径」的完整闭环。
    expect(resolveToken({ HOME: dir }, "", { platform: "linux" })).toEqual({
      token: "tok-from-flag",
      from: path.normalize(target),
    });
    // 令牌本体不许回显到输出里。
    expect(result.out).not.toContain("tok-from-flag");
    expect(result.err).not.toContain("tok-from-flag");
  });

  it("--config 可显式给目标路径，取值像旗标时不吞", async () => {
    const dir = makeTmpDir();
    const crafted = path.join(dir, "custom", "tok.txt");
    const ok = await captureMain({
      argv: ["--config", crafted, "--token", "t"],
      cwd: dir,
      env: { NODE_ENV: "test", HOME: dir },
      platform: "linux",
    });
    expect(ok.code).toBe(0);
    expect(fs.readFileSync(crafted, "utf8")).toBe("t\n");
    // `--config --token x` 的 --config 是无值形态：不许把「--token」当成目标路径。
    expect(parseArgs(["--config", "--token", "x"]).config).toBeNull();
    expect(parseArgs(["--config", "--token", "x"]).configOnly).toBe(true);
    expect(fs.existsSync(path.join(dir, "--token"))).toBe(false);
  });

  it("--config 缺令牌值退 2，不写空文件", async () => {
    const dir = makeTmpDir();
    const result = await captureMain({
      argv: ["--config"],
      cwd: dir,
      env: { NODE_ENV: "test", HOME: dir },
      platform: "linux",
    });
    expect(result.code).toBe(2);
    expect(result.err).toContain("--token");
    expect(fs.existsSync(path.join(dir, ".config"))).toBe(false);
  });

  it("writeTokenConfigFile 自动建父目录", () => {
    const dir = makeTmpDir();
    const target = path.join(dir, "a", "b", "tok");
    expect(writeTokenConfigFile({ token: " t ", target })).toBe(path.normalize(target));
    expect(fs.readFileSync(target, "utf8")).toBe("t\n");
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

/**
 * 构建信息附件（ISSUE #4056）：取壳的人要能答出「这份 exe 是什么时候、哪一笔构建的」。
 * 假 fetch 按 URL 分流：exe 与构建信息附件各回各的正文。
 */
describe("构建信息：取壳时同取、展示并对账（ISSUE #4056）", () => {
  const EXE = "shell-bytes";
  const EXE_SHA = createHash("sha256").update(EXE).digest("hex");

  /** 按资产名分流的假 fetch。 */
  function routeFetch(info: { body: string; status?: number }): typeof fetch {
    return (url: string | URL | Request) => {
      const target = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
      if (target.endsWith(`/${BUILD_INFO_ASSET}`)) {
        return Promise.resolve(respond(info.status ?? 200, info.body));
      }
      return Promise.resolve(respond(200, EXE));
    };
  }

  function infoBody(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
      asset: DEFAULT_ASSET,
      built_at: "2026-11-16T02:41:12Z",
      commit: "a".repeat(40),
      run_id: "4242",
      sha256: EXE_SHA,
      size: EXE.length,
      tag: "nightly",
      ...overrides,
    });
  }

  it("附件在场：展示构建时间 / commit / run，且 sha256 与大小对账一致", async () => {
    const dir = makeTmpDir();
    const result = await captureMain({
      argv: [],
      cwd: dir,
      env: { NODE_ENV: "test" },
      fetchImpl: routeFetch({ body: infoBody() }),
      platform: "linux",
    });
    expect(result.code).toBe(0);
    expect(fs.readFileSync(path.join(dir, DEFAULT_OUT), "utf8")).toBe(EXE);
    expect(result.out).toContain("构建信息：构建时间 2026-11-16T02:41:12Z");
    expect(result.out).toContain(`commit ${"a".repeat(12)}`);
    expect(result.out).toContain("run 4242");
    expect(result.out).toContain("校验：sha256 一致 · 大小一致（11 字节）");
  });

  it("sha256 / 大小与清单对不上 ⇒ stderr 明说（nightly 滚动覆盖不同批），壳照常到手", async () => {
    const dir = makeTmpDir();
    const result = await captureMain({
      argv: [],
      cwd: dir,
      env: { NODE_ENV: "test" },
      fetchImpl: routeFetch({ body: infoBody({ sha256: "0".repeat(64), size: 1 }) }),
      platform: "linux",
    });
    expect(result.code).toBe(0);
    expect(fs.readFileSync(path.join(dir, DEFAULT_OUT), "utf8")).toBe(EXE);
    expect(result.err).toContain("sha256 与构建信息不一致");
    expect(result.err).toContain("大小与构建信息不一致");
  });

  it("附件 404（功能上线前的旧包）⇒ 降级指到 Release 页，不影响取壳", async () => {
    const dir = makeTmpDir();
    const result = await captureMain({
      argv: [],
      cwd: dir,
      env: { NODE_ENV: "test" },
      fetchImpl: routeFetch({ body: "", status: 404 }),
      platform: "linux",
    });
    expect(result.code).toBe(0);
    expect(fs.readFileSync(path.join(dir, DEFAULT_OUT), "utf8")).toBe(EXE);
    expect(result.out).toContain("没带构建信息附件");
    expect(result.out).toContain("Release 页为准");
  });

  it("附件读不到（非 404）⇒ 同样降级，不装作读过", async () => {
    const dir = makeTmpDir();
    const result = await captureMain({
      argv: [],
      cwd: dir,
      env: { NODE_ENV: "test" },
      fetchImpl: routeFetch({ body: "boom", status: 500 }),
      platform: "linux",
    });
    expect(result.code).toBe(0);
    expect(result.out).toContain("构建信息读不到（HTTP 500）");
  });

  it("describeBuildInfo：非 JSON / 空对象都降级，不抛", () => {
    const actual = { exeBytes: EXE.length, exeSha256: EXE_SHA };
    const bad = describeBuildInfo(Buffer.from("not-json"), actual);
    expect(bad.info).toContain("不是合法 JSON");
    expect(bad.warn).toBe("");
    const empty = describeBuildInfo(Buffer.from("{}"), actual);
    expect(empty.info).toContain("没有可读字段");
  });
});

/**
 * 落盘被占用（ISSUE #4484）：Windows 上目标 app.exe 被运行中的进程或杀软扫描锁住时，
 * rename 以 EPERM 失败、临时文件残留在 target 里。这里钉住三层行为：退避重试能跨过
 * 短暂占用；耗尽后清临时文件并给出「先关应用」的可执行提示；main 把它转成退码 1。
 */
describe("落盘被占用：退避重试与可执行提示（ISSUE #4484）", () => {
  const mkOut = (dir: string): string =>
    path.join(dir, "src-tauri", "target", "release", "app.exe");

  /** 造一个带指定 code 的 rename 失败。 */
  function renameError(code: string): Error {
    return Object.assign(new Error(`${code}: operation not permitted, rename`), { code });
  }

  /** 断言目录里没有 `.tmp-` 残留（残留会一直躺在 target/release 里）。 */
  function expectNoTempLeft(dir: string): void {
    const targetDir = path.join(dir, "src-tauri", "target", "release");
    const leftovers = fs.readdirSync(targetDir).filter((f) => f.includes(".tmp-"));
    expect(leftovers).toEqual([]);
  }

  it("rename 被占用（EPERM）时按退避间隔重试，恢复后落位成功且覆盖旧文件", async () => {
    const dir = makeTmpDir();
    const out = mkOut(dir);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, "old-shell");
    const realRename = fs.renameSync.bind(fs);
    let calls = 0;
    const renameSpy = vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      calls += 1;
      if (calls <= 2) {
        throw renameError("EPERM");
      }
      realRename(from, to);
    });
    const delays: number[] = [];
    await writeFileAtomic(out, Buffer.from("new-shell"), {
      sleep: (ms) => {
        delays.push(ms);
        return Promise.resolve();
      },
    });
    renameSpy.mockRestore();
    expect(fs.readFileSync(out, "utf8")).toBe("new-shell");
    expect(delays).toEqual(RENAME_RETRY_DELAYS_MS.slice(0, 2));
    expectNoTempLeft(dir);
  });

  it("重试耗尽：清掉临时文件，抛出带占用提示的错误并保留原始错误为 cause", async () => {
    const dir = makeTmpDir();
    const out = mkOut(dir);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const renameSpy = vi.spyOn(fs, "renameSync").mockImplementation(() => {
      throw renameError("EPERM");
    });
    const sleeps: number[] = [];
    const spawnStub = () => ({
      status: 0,
      stdout: '"app.exe","4242","Console","1","4096"\r\n',
    });
    const err = await writeFileAtomic(out, Buffer.from("x"), {
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      platform: "win32",
      spawnImpl: spawnStub,
    }).then(
      () => null,
      (error: Error) => error,
    );
    renameSpy.mockRestore();
    expect(err).toBeInstanceOf(Error);
    expect(err?.message).toContain("无法把下载的壳落位到");
    expect(err?.message).toContain("检测到同名进程正在运行");
    expect(err?.message).toContain("app.exe(PID 4242)");
    expect(err?.message).toContain("先退出 Comfy APP");
    expect(err).toHaveProperty("cause.code", "EPERM");
    expect(sleeps).toEqual(RENAME_RETRY_DELAYS_MS);
    expectNoTempLeft(dir);
  });

  it("查不到同名进程：提示关应用 / 杀软扫描，而不是一行裸 EPERM", async () => {
    const dir = makeTmpDir();
    const out = mkOut(dir);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const renameSpy = vi.spyOn(fs, "renameSync").mockImplementation(() => {
      throw renameError("EPERM");
    });
    const spawnStub = () => ({
      status: 0,
      stdout: "INFO: No tasks are running which match the specified criteria.\r\n",
    });
    const err = await writeFileAtomic(out, Buffer.from("x"), {
      sleep: () => Promise.resolve(),
      platform: "win32",
      spawnImpl: spawnStub,
    }).then(
      () => null,
      (error: Error) => error,
    );
    renameSpy.mockRestore();
    expect(err?.message).toContain("先关闭应用");
    expect(err?.message).toContain("杀毒软件");
    expectNoTempLeft(dir);
  });

  it("非占用类错误（EIO）不重试、不包装占用提示，清理临时文件后原样抛出", async () => {
    const dir = makeTmpDir();
    const out = mkOut(dir);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const renameSpy = vi.spyOn(fs, "renameSync").mockImplementation(() => {
      throw renameError("EIO");
    });
    let sleeps = 0;
    const err = await writeFileAtomic(out, Buffer.from("x"), {
      sleep: () => {
        sleeps += 1;
        return Promise.resolve();
      },
    }).then(
      () => null,
      (error: Error) => error,
    );
    renameSpy.mockRestore();
    expect(err?.message).toContain("EIO");
    expect(err?.message).not.toContain("先关闭应用");
    expect(sleeps).toBe(0);
    expectNoTempLeft(dir);
  });

  it("findRunningProcessesByImage：解析 CSV 行、大小写不敏感；非 win32 与失败都返回空", () => {
    const rows =
      '"app.exe","123","Console","1","4096"\r\n"Other.exe","456","Console","1","4096"\r\n';
    const ok = () => ({ status: 0, stdout: rows });
    expect(findRunningProcessesByImage("APP.exe", { platform: "win32", spawnImpl: ok })).toEqual([
      { name: "app.exe", pid: 123 },
    ]);
    const noSpawn = vi.fn();
    expect(
      findRunningProcessesByImage("app.exe", { platform: "linux", spawnImpl: noSpawn }),
    ).toEqual([]);
    expect(noSpawn).not.toHaveBeenCalled();
    const throwing = () => {
      throw new Error("no tasklist");
    };
    expect(
      findRunningProcessesByImage("app.exe", { platform: "win32", spawnImpl: throwing }),
    ).toEqual([]);
    const failed = () => ({ status: 1, stdout: "" });
    expect(
      findRunningProcessesByImage("app.exe", { platform: "win32", spawnImpl: failed }),
    ).toEqual([]);
  });

  it("describeRenameFailure：把原始错误与下一步提示拼成一段", () => {
    const target = String.raw`X:\out\app.exe`;
    const msg = describeRenameFailure(renameError("EPERM"), target, {
      platform: "linux",
    });
    expect(msg).toContain(target);
    expect(msg).toContain("（EPERM）");
    expect(msg).toContain("先关闭应用");
  });

  it("main：落盘失败退 1，stderr 念出提示与原始堆栈，且不再往下补快捷方式", async () => {
    const dir = makeTmpDir();
    const boom = new Error("无法把下载的壳落位到位（EPERM）。请先关闭应用。");
    boom.cause = renameError("EPERM");
    const result = await captureMain({
      argv: [],
      cwd: dir,
      env: { NODE_ENV: "test" },
      fetchImpl: () => Promise.resolve(respond(200, "shell-bytes")),
      platform: "linux",
      writeFile: () => Promise.reject(boom),
    });
    expect(result.code).toBe(1);
    expect(result.err).toContain("写入落点失败");
    expect(result.err).toContain("请先关闭应用");
    expect(result.err).toContain("EPERM: operation not permitted, rename");
    expect(result.out).not.toContain("快捷方式");
    expect(fs.existsSync(path.join(dir, DEFAULT_OUT))).toBe(false);
  });
});
