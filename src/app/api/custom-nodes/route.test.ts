/**
 * `/api/custom-nodes` 的判据：**POST 的 argv 闸门（台账 A6）+ GET 的只读侧（台账 E7 最后一格）**。
 *
 * POST 这一半：这个端点会把客户端传来的字符串**拼进 spawn 的 argv**（Python 解析器），所以它
 * 的危险不是 SQL 那种「查别人的行」，而是「让自己的命令行多出两个 token」：
 * 解析器本身写死了 `--out=<manifest>` / `--report-out=<report>`，一旦包名能带
 * `--out=...`，客户端就能把生成物写到机器上任意路径（任意文件覆写）。
 * 判据收在 `safeSpawnArg()`：flag 形态、空/超长、shell 元字符一律拒。
 *
 * 因此用例的分工是「**拒绝必须发生在 spawn 之前**」—— 只在响应码上打勾是不够的，
 * 请求已经发出去了就等于没拦住。正面一条（合法包名）同时钉住 argv 的形状：
 * `--only-pkgs` 永远是**一个**值、`--out` 的位置与内容不许被客户端挪动。
 *
 * GET 这一半判的是「磁盘上那份清单到底被读成了什么」：摘要按 `(size, mtime)` 指纹短路缓存、
 * 报告原样透传、冷/热两条返回形态（ndjson 流 vs 直接 JSON）。此前**零执行者**，
 * 于是「指纹不变 → 界面永远显示上一次解析的结果」这类洞没有任何东西能照出来。
 *
 * mock 边界：`node:child_process`（换成可编程的假子进程，绝不真起 Python）、
 * `~/server/auth/request-user`（鉴权两态）、`~/lib/app-settings/app-settings.server`
 * 与 `~/lib/envfile`（扫描根的推导口径 —— 这里只关心「有没有配过」）、
 * `node:fs`（**只包一层**：命中本文件显式管理的两个路径才给假内容，其余一律转调真实现 ——
 * 摘要与指纹的逻辑本身必须由被测代码真跑一遍，替它写一份就等于没测）。
 */
import path from "node:path";
import type * as nodeFs from "node:fs";
import type { PathLike } from "node:fs";
import type { NextRequest } from "next/server";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { customNodesManifestPath } from "~/lib/comfyui/custom-nodes-manifest.server";

type Cb = (...args: unknown[]) => void;
interface FakeChild {
  proc: Record<string, Cb[]>;
  out: Record<string, Cb[]>;
  err: Record<string, Cb[]>;
}

/**
 * 假文件系统的登记表（只覆盖下面这两个路径，其余转调真 `node:fs`）。
 *
 * 路径是开发机上「解析过一次就会长出来」的那两个，所以每条用例都**显式**登记自己那一档
 *（包括「不存在」）—— 否则同一个断言在解析过一次的机器上会与在干净检出上不同形。
 */
interface StubFile {
  /** 文件内容（字符串原文；`undefined` + `missing` 表示没有这个文件）。 */
  text?: string;
  size?: number;
  mtimeMs?: number;
  /** 存在但读不出来（IO 错），与「不存在」是两档。 */
  readFails?: boolean;
  /** 存在但 stat 失败 —— 指纹取不到时调用方**不许**缓存。 */
  statFails?: boolean;
  /** 连「在不在」都问不出来（挂载点失效 / 权限）—— 路由的 try/catch 就是为这一档写的。
   *  `"silent"` 表示抛的是一个**没有 message** 的 Error，用来判兜底文案那一格。 */
  existsFails?: boolean | "silent";
  missing?: boolean;
}

const { spawnMock, userMock, settingsMock, fsState } = vi.hoisted(() => {
  const files = new Map<string, StubFile>();
  const reads = new Map<string, number>();
  return {
    spawnMock: vi.fn(),
    userMock: vi.fn<() => Promise<{ id: string } | null>>(),
    settingsMock: vi.fn<() => { comfyuiPath: string }>(() => ({
      comfyuiPath: "C:/ComfyUI",
    })),
    fsState: { files, reads },
  };
});

vi.mock("node:child_process", () => ({ spawn: spawnMock }));
vi.mock("~/server/auth/request-user", () => ({
  requireRequestUser: userMock,
}));
vi.mock("~/lib/app-settings/app-settings.server", () => ({
  getSettingsSync: settingsMock,
  deriveComfyuiSubdir: (root: string, sub: string) =>
    root ? `${root}/${sub}` : "",
  deriveComfyuiWorkflowsDir: (root: string) =>
    root ? `${root}/workflows` : "",
}));
vi.mock("~/lib/envfile", () => ({ readEnvVar: () => undefined }));

/* `node:fs` 只包一层「命中登记表才作假」的薄壳：route 与指纹模块用的那三个方法
 * （`existsSync / readFileSync / statSync`）按登记表作答，其余方法与其余路径
 * 一律转调真实现 —— 摘要与指纹的逻辑本身必须由被测代码真跑一遍。 */
vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof nodeFs>();
  const keyOf = (p: unknown): string =>
    typeof p === "string"
      ? p
      : p instanceof URL
        ? p.href
        : (p as { toString(): string }).toString();
  const stub = {
    ...real,
    existsSync: (p: PathLike): boolean => {
      const hit = fsState.files.get(keyOf(p));
      if (hit) {
        /* 「在不在」都问不出来（挂载点失效 / 权限）是路由那层 try/catch 存在的理由，
         * 所以这一档要能造出来 —— 不能让假 fs 只会返回布尔值。 */
        if (hit.existsFails) {
          if (hit.existsFails === "silent") throw new Error("");
          throw Object.assign(
            new Error(`EACCES: permission denied, ${keyOf(p)}`),
            { code: "EACCES" },
          );
        }
        return !hit.missing;
      }
      return real.existsSync(p);
    },
    readFileSync: (p: PathLike, options?: unknown): unknown => {
      const k = keyOf(p);
      const hit = fsState.files.get(k);
      if (!hit) {
        return (real.readFileSync as (a: unknown, b: unknown) => unknown)(
          p,
          options,
        );
      }
      if (hit.missing || hit.readFails) {
        const e = new Error(
          hit.missing
            ? `ENOENT: no such file or directory, open '${k}'`
            : `EIO: i/o error, read '${k}'`,
        ) as NodeJS.ErrnoException;
        e.code = hit.missing ? "ENOENT" : "EIO";
        throw e;
      }
      fsState.reads.set(k, (fsState.reads.get(k) ?? 0) + 1);
      return hit.text ?? "";
    },
    statSync: (p: PathLike): unknown => {
      const k = keyOf(p);
      const hit = fsState.files.get(k);
      if (!hit) return (real.statSync as (a: unknown) => unknown)(p);
      if (hit.missing || hit.statFails) {
        const e = new Error(
          hit.missing
            ? `ENOENT: no such file or directory, stat '${k}'`
            : `EACCES: permission denied, stat '${k}'`,
        ) as NodeJS.ErrnoException;
        e.code = hit.missing ? "ENOENT" : "EACCES";
        throw e;
      }
      return {
        size: hit.size ?? (hit.text ?? "").length,
        mtimeMs: hit.mtimeMs ?? 0,
        isFile: () => true,
        isDirectory: () => false,
      };
    },
  };
  return { ...real, ...stub, default: stub };
});

import { GET, POST } from "./route";

/** 被测代码里那两个落点（与 `route.ts` 的常量同一算法，不是抄来的字面量）。 */
const MANIFEST = customNodesManifestPath();
const REPORT = path.join(
  process.cwd(),
  "src/generated/customNodes.report.json",
);

/** 每次 spawn 记录的 argv 与假子进程的事件袋（按调用顺序）。 */
const children: FakeChild[] = [];
/** 下一批假子进程要吐的 stdout；空串 = 「这个解释器没结果」，用于换解释器的路径。 */
let nextStdout = "";

function installFakeChild() {
  spawnMock.mockImplementation(() => {
    const child: FakeChild = { proc: {}, out: {}, err: {} };
    const reg = (bag: Record<string, Cb[]>) => (ev: string, cb: Cb) => {
      (bag[ev] ??= []).push(cb);
    };
    // `spawnCapture` 会先 `setEncoding("utf8")` 再挂 data —— 假流必须两样都有。
    const stream = (bag: Record<string, Cb[]>) => ({
      on: reg(bag),
      setEncoding: (): void => undefined,
      resume: (): void => undefined,
    });
    const handle = {
      on: reg(child.proc),
      stdout: stream(child.out),
      stderr: stream(child.err),
      kill: vi.fn(),
      pid: 4242,
    };
    children.push(child);
    /* 延后一拍再收尾：注册必须先于触发。stdout 为空时 `spawnCapture` 判成
     * 「这个解释器不行」，三个候选轮完返回空批 —— 用例因此不必等真实超时
     *（DISCOVER_TIMEOUT_MS × 3）。 */
    setTimeout(() => {
      if (nextStdout) for (const cb of child.out.data ?? []) cb(nextStdout);
      emitClose(child, 0);
    }, 0);
    return handle;
  });
}

/** 驱动假子进程收尾（discover 那条 await 它，不发 close 就永远挂着）。 */
function emitClose(child: FakeChild, code: number) {
  for (const cb of child.proc.close ?? []) cb(code);
}

async function post(body: unknown) {
  const req = new Request("http://127.0.0.1:3000/api/custom-nodes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    // body 允许是「不是 JSON」的原文 —— 畸形体这一路也在测
    body: typeof body === "string" ? body : JSON.stringify(body),
  }) as unknown as NextRequest;
  return POST(req);
}

/** 取 argv（spawn 的第二个入参）。 */
function argv(i = 0): string[] {
  return spawnMock.mock.calls[i]?.[1] as string[];
}

beforeEach(() => {
  vi.clearAllMocks();
  /* `clearAllMocks` 清的是调用记录，**不清 `mockImplementationOnce` 的队列** ——
   * 上一条用例排了没用完的假子进程会漏到下一条头上，表现是「换一条用例的顺序就红」。
   * 顺序敏感的用例不算商业级用例，所以三个替身都在每条用例前显式重置一遍。 */
  spawnMock.mockReset();
  userMock.mockReset();
  settingsMock.mockReset();
  children.length = 0;
  nextStdout = "";
  installFakeChild();
  userMock.mockResolvedValue({ id: "user-a" });
  settingsMock.mockReturnValue({ comfyuiPath: "C:/ComfyUI" });
  /* 两个落点默认「不存在」：开发机解析过一次就会留下真文件，那时同一条断言
   * 会读到开发机上那一份的内容 —— 用例必须在任何机器上判同一个结论。 */
  fsState.files.clear();
  fsState.files.set(MANIFEST, { missing: true });
  fsState.files.set(REPORT, { missing: true });
  fsState.reads.clear();
  armed = false;
});

afterEach(() => {
  nowSpy?.mockRestore();
  nowSpy = null;
});

describe("POST /api/custom-nodes —— 鉴权与请求体", () => {
  it("未登录 → 401，且不起任何子进程", async () => {
    userMock.mockResolvedValueOnce(null);
    const res = await post({ action: "parse", packages: ["ComfyUI-foo"] });
    expect(res.status).toBe(401);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("畸形 JSON → 400（不再被静默当空对象走「unknown action」）", async () => {
    const res = await post("{ not json");
    expect(res.status).toBe(400);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("未知 action → 400，不起子进程", async () => {
    const res = await post({ action: "nope" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      ok: false,
      error: "unknown action",
    });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("saveSettings 已废弃：只回当前推导结果，绝不写 .env、不起子进程", async () => {
    const res = await post({
      action: "saveSettings",
      customNodesPath: "C:/Windows",
      localWorkflowsPath: "C:/Windows",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      paths: string[];
      localWorkflowPaths: string[];
    };
    expect(body.paths).toEqual(["C:/ComfyUI/custom_nodes"]);
    expect(body.localWorkflowPaths).toEqual(["C:/ComfyUI/workflows"]);
    expect(spawnMock).not.toHaveBeenCalled();
  });
});

describe("POST parse —— argv 注入闸门（台账 A6）", () => {
  it("合法包名 → 流式响应，argv 里 --out/--report-out 仍是服务端写死的那两条", async () => {
    const res = await post({
      action: "parse",
      packages: ["ComfyUI-Foo", "ComfyUI-Bar"],
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    const args = argv();
    const manifest = path.join(
      process.cwd(),
      "src/generated/customNodes.manifest.json",
    );
    expect(args.slice(0, 5)).toEqual([
      "-u",
      "scripts/parse_custom_nodes.py",
      "--out",
      manifest,
      "--report-out",
    ]);
    // 子集模式：只给 --only-pkgs，**不再**给 --paths（否则客户端能指定扫描根）
    expect(args).toEqual([
      "-u",
      "scripts/parse_custom_nodes.py",
      "--out",
      manifest,
      "--report-out",
      path.join(process.cwd(), "src/generated/customNodes.report.json"),
      "--only-pkgs",
      "ComfyUI-Foo,ComfyUI-Bar",
    ]);
  });

  it("把 `--out=` 伪装成包名 → 400，且在 spawn 之前就拦下", async () => {
    const evil = `--out=${path.join(process.cwd(), "..", "evil.json")}`;
    const res = await post({ action: "parse", packages: [evil] });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  /* 每一种「让 argv 多长出一个 token / 让 shell 多想一步」的形状都必须被拒。
     值形态取自真实注入面：前缀 -、等号、引号、分片符、命令替换、非字符串、空、超长。 */
  it.for([
    ["-u"],
    ["--only-pkgs"],
    ["a=b"],
    ["a;b"],
    ['a"b'],
    ["a'b"],
    ["a$b"],
    ["a`b"],
    ["a&b"],
    ["a|b"],
    ["a<b"],
    ["a>b"],
    ["a(b"],
    ["a)b"],
    ["a{b"],
    ["a}b"],
    [""],
    ["x".repeat(8193)],
    [123],
    [null],
    [{ a: 1 }],
  ])("拒绝形态 %j —— 不起子进程", async (token) => {
    const res = await post({ action: "parse", packages: [token] });
    expect(res.status).toBe(400);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("逗号不是漏洞：它只是 --only-pkgs 那**一个**值里的字符", async () => {
    /* 这条是判据的边界说明：`"a,--out"` 通不过 `=` 那一关吗？通过（没有 `=`）。
     * 但它进的是 `--only-pkgs` 的**单个** argv 元素，Python 侧按逗号切的是「值」，
     * 切完的东西不会变成进程的 flag —— 所以危险形状从来不是「有没有逗号」，
     * 而是「客户端能不能让 argv 多出一个 token」。这里钉住 argv 的元素数与位置。 */
    const res = await post({ action: "parse", packages: ["a,--out"] });
    expect(res.status).toBe(200);
    const args = argv();
    expect(args[args.indexOf("--only-pkgs") + 1]).toBe("a,--out");
    expect(args).toHaveLength(8);
  });

  it("未配置 ComfyUI 路径且没带包名 → 400 说明缺什么，不起子进程", async () => {
    settingsMock.mockReturnValue({ comfyuiPath: "" });
    const res = await post({ action: "parse" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("CUSTOM_NODES_PATH");
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("未配置但带了合法包名 → 子集解析不必先配路径", async () => {
    settingsMock.mockReturnValue({ comfyuiPath: "" });
    const res = await post({ action: "parse", packages: ["ComfyUI-Foo"] });
    expect(res.status).toBe(200);
    expect(argv()).toContain("--only-pkgs");
  });

  it("全量解析走 --paths（值是配置的扫描根，不是客户端给的）", async () => {
    const res = await post({ action: "parse", packages: [] });
    expect(res.status).toBe(200);
    const args = argv();
    expect(args).toContain("--paths");
    expect(args[args.indexOf("--paths") + 1]).toBe("C:/ComfyUI/custom_nodes");
  });
});

describe("POST discover —— parent 同样过闸门", () => {
  it("合法 parent → 探测结果原样回，argv 是 --discover-parent 的**单值**", async () => {
    nextStdout = JSON.stringify({
      packages: [{ name: "foo", path: "ComfyUI-Foo/foo" }],
    });
    const res = await post({ action: "discover", parents: ["ComfyUI-Foo"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      packages: [{ name: "foo", path: "ComfyUI-Foo/foo" }],
    });
    // 第一个解释器就出了结果 → 只起一次进程（不必轮 python3/python/py）
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(argv()).toEqual([
      "-u",
      "scripts/parse_custom_nodes.py",
      "--discover-parent",
      "ComfyUI-Foo",
    ]);
  });

  it("注入形态的 parent → 400，不起子进程", async () => {
    const res = await post({ action: "discover", parents: ["--out=x"] });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("parents 里有一个坏值就整批拒绝（不许静默丢掉一条继续扫）", async () => {
    const res = await post({
      action: "discover",
      parents: ["ComfyUI-Ok", "--paths"],
    });
    expect(res.status).toBe(400);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("parents 缺省 / 空数组 / 非数组 → 空批直接回，不去起解释器", async () => {
    for (const body of [
      { action: "discover" },
      { action: "discover", parents: [] },
      { action: "discover", parents: "ComfyUI-Foo" },
    ]) {
      const res = await post(body);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, packages: [] });
    }
    // 旧行为：空批照样按 python3 → python → py 轮三遍（各带一次超时与一次进程启动）
    expect(spawnMock).not.toHaveBeenCalled();
  });
});

/* ── GET 侧：磁盘上那份清单被读成了什么（台账 E7 最后一格）──────────────
 * 摘要按 `(size, mtime)` 指纹短路缓存，所以「判据不变 → 界面永远显示上一次的结果」
 * 是这一格最贵的失效形态；用例因此既判「读对」，也判「什么时候必须重读」。
 */

/** 基准 mtime（真时刻的量级，让「只改 mtime」这一档与真实写盘同形）。 */
const BASE_MTIME = 1_760_000_000_000;
/**
 * 每次登记自动 +1（`mtimeMs` 的最低位就足以让指纹不同 —— 判的是「换过一次内容」这件事）。
 *
 * **跨用例不清零**：摘要缓存也是模块级的、跟着被测实例活，而指纹是 `(size, mtime)` ——
 * 重置计数器会让后一条用例的「第一次读」撞上前一条留下的缓存，于是那一次读盘
 * 根本没发生，断言却照样绿（台账 E7 记的「有执行者 ≠ 走的是那条路」的同形）。
 */
let mtime = BASE_MTIME;
/** 每条 GET 用例自己的扫描根序号（见 `coldRoot`）。 */
let rootSeq = 0;
/** 本条用例是否已经指定过扫描根（没指定时 `getEvents` 自动补一条，避免跨用例串味）。 */
let armed = false;

/**
 * 给这一条用例一个**别人的父目录都不沾**的扫描根，返回推导出的父路径。
 *
 * `discoverCache` 挂在模块作用域上（同一份被测实例里跨用例存活，TTL 5 秒），
 * 沿用同一个父目录会让后来的用例不知不觉落进「全命中缓存」那条**热路径**分支：
 * 判的是 JSON 形态，而它想判的是流式形态 —— 又一种「看着像测过了，其实走的是另一条路」。
 */
function coldRoot(): string {
  rootSeq += 1;
  const root = `C:/ComfyUI-${rootSeq}`;
  settingsMock.mockReturnValue({ comfyuiPath: root });
  armed = true;
  return `${root}/custom_nodes`;
}

/** 记一次 Date.now 的替身（只在「缓存过期」那一档用）。 */
let nowSpy: { mockRestore(): void } | null = null;

/** 把清单登记成「存在且可读」，并按 `size` / `mtimeMs` 决定指纹。 */
function putManifest(value: unknown, over: StubFile = {}): void {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  fsState.files.set(MANIFEST, {
    text,
    size: text.length,
    mtimeMs: ++mtime,
    ...over,
  });
}

/** 把解析报告登记成「存在且可读」。 */
function putReport(value: unknown): void {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  fsState.files.set(REPORT, { text, size: text.length, mtimeMs: ++mtime });
}

/** 某个路径被真读了几次（缓存短路的判据就落在这里）。 */
function readsOf(p: string): number {
  return fsState.reads.get(p) ?? 0;
}

/** GET 的一次往返（流式形态会被读到底，返回按行解析出来的事件）。 */
async function getEvents(): Promise<Record<string, unknown>[]> {
  if (!armed) coldRoot();
  const res = await GET();
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("ndjson");
  return eventsOf(res);
}

function eventOf(
  events: Record<string, unknown>[],
  type: string,
): Record<string, unknown> {
  const hit = events.find((e) => e.type === type);
  if (!hit) {
    throw new Error(
      `事件流里没有 ${type}，实到：[${events.map((e) => String(e.type)).join(",")}]`,
    );
  }
  return hit;
}

/** 给假子进程排一批 stdout 行（逐行吐完再发 close），用于流式探测那几档。 */
function scriptDiscover(
  lines: string[],
  opts: { code?: number; spawnThrows?: boolean } = {},
): void {
  spawnMock.mockImplementationOnce(() => {
    if (opts.spawnThrows) {
      throw Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
    }
    const child: FakeChild = { proc: {}, out: {}, err: {} };
    const reg = (bag: Record<string, Cb[]>) => (ev: string, cb: Cb) => {
      (bag[ev] ??= []).push(cb);
    };
    const stream = (bag: Record<string, Cb[]>) => ({
      on: reg(bag),
      setEncoding: (): void => undefined,
    });
    const handle = {
      on: reg(child.proc),
      stdout: stream(child.out),
      stderr: stream(child.err),
      kill: vi.fn(),
      pid: 7,
    };
    children.push(child);
    setTimeout(() => {
      for (const cb of child.out.data ?? []) {
        for (const line of lines) cb(Buffer.from(`${line}\n`));
      }
      emitClose(child, opts.code ?? 0);
    }, 0);
    return handle;
  });
}

/** 一份「解析过一次」的完整清单，字段取界面上真会显示的那几样。 */
const FULL_MANIFEST = {
  generatedAt: "2026-10-01T10:00:00",
  sources: ["/tmp/custom_nodes"],
  nodes: { FooAdd: {}, FooMul: {} },
  packages: {
    "ComfyUI-Foo": {
      path: "/tmp/custom_nodes/ComfyUI-Foo",
      nodeCount: 2,
      nodeTypes: ["FooAdd", "FooMul"],
      status: "ok",
      errors: [],
      contentHash: "abc123",
      parsedAt: "2026-10-01T09:59:59",
      parsedFileCount: 7,
    },
  },
  parseErrors: [],
};

/** 摘要事件里的 `summary` 字段（冷/热两种返回形态都走这一个口子取）。 */
async function summaryOf(): Promise<Record<string, unknown> | null> {
  const payload = await payloadOf();
  return payload.summary as Record<string, unknown> | null;
}

/**
 * 取这一次 GET 的载荷本体。
 *
 * 两种形态必须给同一个答案：冷路径是 ndjson 流（摘要挂在 `summary` 事件上），
 * 热路径是直接 JSON（摘要挂在顶层）。所以取摘要不能假定形态 —— 只判 JSON 那一档
 * 就等于「测过了」而流式那一档一个字都没判。
 */
async function payloadOf(): Promise<Record<string, unknown>> {
  if (!armed) coldRoot();
  const res = await GET();
  expect(res.status).toBe(200);
  if ((res.headers.get("content-type") ?? "").includes("ndjson")) {
    return eventOf(await eventsOf(res), "summary");
  }
  return (await res.json()) as Record<string, unknown>;
}

/** 把流式响应读到底，按行解析成事件数组。 */
async function eventsOf(res: Response): Promise<Record<string, unknown>[]> {
  const text = await res.text();
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("GET /api/custom-nodes —— 鉴权与错误信封", () => {
  it("未登录 → 401，一次盘都不读、一个进程都不起", async () => {
    putManifest(FULL_MANIFEST);
    userMock.mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({
      error: { code: "auth.required", message: "未登录或会话已失效" },
    });
    expect(readsOf(MANIFEST)).toBe(0);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("目录状态读取失败 → 500 带 code，而不是让 Next 吐一个不带 settings 的错误体", async () => {
    /* `existsSync` 抛错正是路由注释里点名的那一档（挂载点失效 / 权限）。
       此前它会把整个请求炸成 Next 的默认错误页，前端崩在
       「读取 undefined 的 paths 属性」上，真实原因反而看不见（硬规则 4）。 */
    fsState.files.set(MANIFEST, { text: "{}", existsFails: true });
    const res = await GET();
    expect(res.status).toBe(500);
    const body = (await res.json()) as {
      error?: { code?: string; message?: string };
    };
    expect(body.error?.code).toBe("custom_nodes.read_failed");
    // 详情取到了就说清是哪一步取不到：错误原文本身已经指名了机制（EACCES）。
    expect(body.error?.message).toContain("EACCES");
  });

  it("抛上来的东西没有可读详情 → 兜底成「读取配置失败」，而不是空文案或 undefined", async () => {
    fsState.files.set(MANIFEST, { text: "{}", existsFails: "silent" });
    const res = await GET();
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error?: { message?: string } };
    expect(body.error?.message).toBe("读取配置失败");
  });

  it("500 的信封里只有 error —— 消费方靠「没有 settings」判失败，形状不许偷偷加字段", async () => {
    fsState.files.set(MANIFEST, { text: "{}", existsFails: true });
    const res = await GET();
    expect(Object.keys((await res.json()) as Record<string, unknown>)).toEqual([
      "error",
    ]);
  });
});

describe("GET 摘要：清单的六种坏法", () => {
  it("还没有清单 → 200 + settings（paths 是推导出来的那一条），summary 为 null", async () => {
    const parent = coldRoot();
    const events = await getEvents();
    const summary = eventOf(events, "summary");
    expect(summary.summary).toBeNull();
    const settings = summary.settings as {
      paths: string[];
      localWorkflowPaths: string[];
    };
    // 两个伴随字段都得指向**同一个安装根**（对话框靠它们在同一屏里配对显示）。
    expect(settings.paths).toEqual([parent]);
    expect(path.dirname(settings.localWorkflowPaths[0] ?? "")).toBe(
      path.dirname(parent),
    );
    expect(settings.localWorkflowPaths[0]).toMatch(/workflows$/);
  });

  it.for(["42", '"一段字符串"', "[1,2]", "null", "true"])(
    "标量 JSON %s 不许当成清单（旧实现会在这里抛 TypeError）",
    async (text) => {
      putManifest(text);
      await expect(summaryOf()).resolves.toBeNull();
    },
  );

  it("清单不是合法 JSON → null，但不影响同一次响应里的其它字段", async () => {
    putManifest("{ generatedAt: 这不是 JSON,");
    putReport({ totalNodes: 3 });
    const events = await getEvents();
    const summary = eventOf(events, "summary");
    expect(summary.summary).toBeNull();
    expect(summary.lastReport).toEqual({ totalNodes: 3 });
  });

  it("包条目不是对象时逐字段回落，但 name 仍取键名（界面不能出现无名包）", async () => {
    putManifest({ packages: { "ComfyUI-Broken": 3 } });
    const summary = await summaryOf();
    expect(summary?.packages).toEqual([
      {
        name: "ComfyUI-Broken",
        path: "",
        nodeCount: 0,
        nodeTypes: [],
        status: "ok",
        errors: [],
        contentHash: "",
        parsedAt: null,
        parsedFileCount: 0,
        generatedAt: null,
      },
    ]);
  });

  it("nodes / sources / parseErrors 缺省时给零值而不是崩", async () => {
    putManifest({ packages: {} });
    const summary = await summaryOf();
    expect(summary).toMatchObject({
      totalNodes: 0,
      sources: [],
      parseErrors: [],
      packages: [],
    });
  });

  it("nodes 写成数组时不许把元素个数当节点数（那是坏清单，不是「有 N 个节点」）", async () => {
    putManifest({ nodes: ["FooAdd", "FooMul"], packages: {} });
    const summary = await summaryOf();
    expect(summary).toMatchObject({ totalNodes: 0 });
  });

  it("完整清单逐列对上：totalNodes 数的是 nodes 的键，不是包数", async () => {
    putManifest(FULL_MANIFEST);
    const summary = await summaryOf();
    expect(summary).toEqual({
      generatedAt: "2026-10-01T10:00:00",
      totalNodes: 2,
      packages: [
        {
          name: "ComfyUI-Foo",
          path: "/tmp/custom_nodes/ComfyUI-Foo",
          nodeCount: 2,
          nodeTypes: ["FooAdd", "FooMul"],
          status: "ok",
          errors: [],
          contentHash: "abc123",
          parsedAt: "2026-10-01T09:59:59",
          parsedFileCount: 7,
          /* 包级 generatedAt 拿的是**清单根**的时间戳：解析器只写根上那一份
           *（`parse_custom_nodes.py` 的 `existing["generatedAt"]`），
           * 改成读包条目自己会得到恒 null —— 那不是更对，那是更空。 */
          generatedAt: "2026-10-01T10:00:00",
        },
      ],
      missingPaths: [],
      parseErrors: [],
      sources: ["/tmp/custom_nodes"],
    });
  });

  it("清单里的未知字段不往外透（摘要是一层白名单投影，不是原样转发）", async () => {
    putManifest({
      ...FULL_MANIFEST,
      secretDiagnostics: { token: "keep-off-the-wire" },
    });
    const summary = await summaryOf();
    expect(Object.keys(summary ?? {})).toEqual([
      "generatedAt",
      "totalNodes",
      "packages",
      "missingPaths",
      "parseErrors",
      "sources",
    ]);
  });
});

describe("GET 摘要缓存：按 (size, mtime) 指纹短路", () => {
  it("同一份文件连读两次 → 只读盘一次（几百 KB 的清单不必每次重解析）", async () => {
    putManifest(FULL_MANIFEST);
    await summaryOf();
    expect(readsOf(MANIFEST)).toBe(1);
    await summaryOf();
    expect(readsOf(MANIFEST)).toBe(1);
  });

  it("写盘后 size 变了 → 必须重读，并且给出新内容（旧实现会一直回上一版）", async () => {
    putManifest(FULL_MANIFEST);
    await summaryOf();
    const grown = {
      ...FULL_MANIFEST,
      nodes: { ...FULL_MANIFEST.nodes, FooNew: {} },
    };
    putManifest(grown);
    const summary = await summaryOf();
    expect(readsOf(MANIFEST)).toBe(2);
    expect(summary?.totalNodes).toBe(3);
  });

  it("只改 mtime（size 相同）→ 同样要重读：指纹少用一半就等于漏失效", async () => {
    const same = JSON.stringify({ ...FULL_MANIFEST, generatedAt: "T-A" });
    fsState.files.set(MANIFEST, {
      text: same,
      size: same.length,
      mtimeMs: 1000,
    });
    expect((await summaryOf())?.generatedAt).toBe("T-A");
    const rewritten = JSON.stringify({ ...FULL_MANIFEST, generatedAt: "T-B" });
    // 字节数刻意一致，只有时间戳前进 —— 这正是「解析器原地重写」的形态。
    expect(rewritten.length).toBe(same.length);
    fsState.files.set(MANIFEST, {
      text: rewritten,
      size: rewritten.length,
      mtimeMs: 2000,
    });
    expect((await summaryOf())?.generatedAt).toBe("T-B");
    expect(readsOf(MANIFEST)).toBe(2);
  });

  it("stat 取不到指纹时不许缓存：每次都得真读一次，也不许拿旧内容冒充新内容", async () => {
    putManifest(FULL_MANIFEST, { statFails: true });
    expect((await summaryOf())?.totalNodes).toBe(2);
    expect((await summaryOf())?.totalNodes).toBe(2);
    expect(readsOf(MANIFEST)).toBe(2);
  });

  it("上一次读不到（指纹为空）不许把 null 缓存住：清单出现后立刻要能读到", async () => {
    // 第一条 GET：还没有清单（stamp 也取不到）→ 返回 null，且不许留下「以后都是 null」的缓存。
    expect(await summaryOf()).toBeNull();
    putManifest(FULL_MANIFEST);
    expect((await summaryOf())?.totalNodes).toBe(2);
  });
});

describe("GET 的 lastReport：原样透传，读不出来时按 null", () => {
  it("报告不存在 → null（与「报告是空的」不同形）", async () => {
    const events = await getEvents();
    expect(eventOf(events, "summary").lastReport).toBeNull();
  });

  it("报告是坏 JSON → null，且不影响摘要那一半", async () => {
    putManifest(FULL_MANIFEST);
    putReport("{ 半截");
    const events = await getEvents();
    expect(eventOf(events, "summary").lastReport).toBeNull();
    expect(
      (eventOf(events, "summary").summary as Record<string, unknown>)
        ?.totalNodes,
    ).toBe(2);
  });

  it("报告有效时逐字段原样透（视图侧要读 mode / addedNodes 这些增量字段）", async () => {
    const report = {
      generatedAt: "2026-10-01T10:00:01",
      mode: "subset",
      totalNodes: 12,
      addedNodes: 2,
      packages: [{ name: "ComfyUI-Foo", error: 0 }],
    };
    putReport(report);
    const events = await getEvents();
    expect(eventOf(events, "summary").lastReport).toEqual(report);
  });
});

describe("GET 的两种返回形态：冷路径流式、热路径直接 JSON", () => {
  it("冷路径 → x-ndjson，事件顺序是 start / queue / 进度 / done / summary / done", async () => {
    const parent = coldRoot();
    putManifest(FULL_MANIFEST);
    scriptDiscover([
      "PROGRESS::scan|msg=🔎 扫描中|discovered=3",
      "一行普通日志",
      JSON.stringify({
        packages: [{ name: "Foo", path: "/tmp/custom_nodes/foo" }],
      }),
    ]);
    const res = await GET();
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    expect(res.headers.get("cache-control")).toBe("no-cache, no-transform");
    const text = await res.text();
    const events = text
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(events.map((e) => e.type)).toEqual([
      "discover_start",
      "progress",
      "progress",
      "progress",
      "discover_done",
      "summary",
      "done",
    ]);
    expect(events[0]).toMatchObject({ parents: [parent], total: 1 });
    expect(events[1]).toMatchObject({ phase: "queue" });
    expect(events[2]).toMatchObject({
      phase: "scan",
      msg: "🔎 扫描中",
      discovered: 3,
    });
    expect(events[4]).toMatchObject({
      cached: false,
      packages: [{ name: "Foo" }],
    });
  });

  it("父目录都在 5s 缓存里 → 第二次 GET 不必再探测，直接回 JSON 带 discoveredByParent", async () => {
    const parent = coldRoot();
    putManifest(FULL_MANIFEST);
    scriptDiscover([JSON.stringify({ packages: [{ name: "Foo" }] })]);
    await getEvents();
    expect(spawnMock).toHaveBeenCalledTimes(1);

    const res = await GET();
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as Record<string, unknown>;
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(body.discoveredByParent).toEqual({ [parent]: [{ name: "Foo" }] });
    expect((body.summary as Record<string, unknown>).totalNodes).toBe(2);
    expect(body.settings).toMatchObject({ paths: [parent] });
  });

  it("缓存过期（>5s）→ 回到流式并重新起进程（不许把过期探测当热路径）", async () => {
    coldRoot();
    putManifest(FULL_MANIFEST);
    scriptDiscover([JSON.stringify({ packages: [] })]);
    await getEvents();
    scriptDiscover([JSON.stringify({ packages: [] })]);
    const advanced = Date.now() + 6000;
    nowSpy = vi.spyOn(Date, "now").mockImplementation(() => advanced);
    const events = await getEvents();
    expect(events[0]?.type).toBe("discover_start");
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  it("一个扫描根都没配 → 仍走流式但 total 为 0、零进程，摘要照样送到", async () => {
    coldRoot();
    settingsMock.mockReturnValue({ comfyuiPath: "" });
    putManifest(FULL_MANIFEST);
    const events = await getEvents();
    expect(events.map((e) => e.type)).toEqual([
      "discover_start",
      "summary",
      "done",
    ]);
    expect(events[0]).toMatchObject({ parents: [], total: 0 });
    expect(spawnMock).not.toHaveBeenCalled();
    expect(
      (eventOf(events, "summary").summary as Record<string, unknown>)
        .totalNodes,
    ).toBe(2);
  });

  it("流内部起进程失败 → 出一条 error 事件并把流收尾，不是半截挂着", async () => {
    scriptDiscover([], { spawnThrows: true });
    const events = await getEvents();
    expect(events.map((e) => e.type)).toEqual([
      "discover_start",
      "progress",
      "error",
    ]);
    expect(events[2]).toMatchObject({ type: "error" });
    expect(String((events[2] as { message?: string }).message ?? "")).not.toBe(
      "",
    );
  });

  it("byPath 把同一个目录的两种写法归一到同一个键（界面上「已载入/已过期」靠它）", async () => {
    putManifest({
      packages: {
        A: { path: "/tmp/Custom_Nodes/Foo" },
        B: { path: "/tmp/custom_nodes/foo" },
      },
    });
    scriptDiscover([JSON.stringify({ packages: [] })]);
    const events = await getEvents();
    const byPath = eventOf(events, "summary").byPath as Record<string, unknown>;
    expect(Object.keys(byPath)).toHaveLength(1);
    const key = Object.keys(byPath)[0] ?? "";
    expect(key).toBe(key.toLowerCase());
    expect(key.split(path.sep).join("/")).toContain("custom_nodes/foo");
  });
});
