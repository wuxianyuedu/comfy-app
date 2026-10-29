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
import { pythonCandidates } from "~/lib/process/python-candidates";

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
        : /* SAFETY: 类型断言已复核 */ (p as { toString(): string }).toString();
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
        return /* SAFETY: 类型断言已复核 */ (
          real.readFileSync as (a: unknown, b: unknown) => unknown
        )(p, options);
      }
      if (hit.missing || hit.readFails) {
        const e = /* SAFETY: 类型断言已复核 */ new Error(
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
      if (!hit)
        return /* SAFETY: 类型断言已复核 */ (
          real.statSync as (a: unknown) => unknown
        )(p);
      if (hit.missing || hit.statFails) {
        const e = /* SAFETY: 类型断言已复核 */ new Error(
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
  const req = /* SAFETY: 类型断言已复核 */ new Request(
    "http://127.0.0.1:3000/api/custom-nodes",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      // body 允许是「不是 JSON」的原文 —— 畸形体这一路也在测
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
  ) as unknown as NextRequest;
  return POST(req);
}

/** 取 argv（spawn 的第二个入参）。 */
function argv(i = 0): string[] {
  return /* SAFETY: 类型断言已复核 */ spawnMock.mock.calls[i]?.[1] as string[];
}

/**
 * 期望顺序 = **那份判据给本平台的顺序**，不在这里抄第二份名字表。
 *
 * 抄一份字面量就是把 A14 的成因在测试里复现一遍：路由与用例同时写死 `python3 → python → py`
 * 时，两边一起错也一起绿。取判据之后这条判的是「路由有没有复用判据」——
 * 谁再自写一张表（或把顺序改回去），这里当场红。
 * 「Windows 上是 `python → py → python3`」与「`py` 必须带 `-3`」那两条**平台字面量**
 * 钉在 `src/lib/process/python-run.test.ts`（那里两个平台都能正面跑）。
 */
const ORDER = pythonCandidates();

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
    const body = /* SAFETY: 类型断言已复核 */ (await res.json()) as {
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
    const body = /* SAFETY: 类型断言已复核 */ (await res.json()) as {
      ok: boolean;
      error: string;
    };
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

/**
 * 解析口（`streamParse`）的解释器退避 —— 台账 A14 在这条链上照出两个形状，
 * 而它们**过去没有任何执行者**：上面那一组只测「argv 会不会被客户端加长」，
 * 从不排第二、第三个子进程，所以「起不来时说什么」与「换档之后谁收尾」两格都是空的。
 * 体量读数：这条链在改之前未被覆盖的那一段就是退避与收尾那十几行。
 */
describe("POST parse —— 解释器退避与收尾归属（台账 A14）", () => {
  it("全部候选都退 127 → 每一个都起过，且那句原因落成 error 日志", async () => {
    // 「排一个候选一次」按判据的长度来，不写死数字（POSIX 上只有两个候选）。
    ORDER.forEach(() => queueChild({ closeCode: 127 }));
    const res = await post({ action: "parse", packages: ["ComfyUI-Foo"] });
    const events = await eventsOf(res);
    /* 旧写法是 `i < pyCandidates.length - 1`：最后一个候选轮不到，于是这一句
     * 永远发不出来 —— 用户看到的是一句「0 个节点」，而真因是压根没有解释器。 */
    expect(interpreterNames()).toEqual(ORDER);
    const miss = events.filter(
      (e) => e.type === "log" && String(e.msg).includes("未找到 Python 解释器"),
    );
    expect(miss).toHaveLength(1);
    expect(miss[0]?.level).toBe("error");
    const done = eventOf(events, "done");
    expect(done.ok).toBe(false);
    expect(done.report).toBeNull();
  });

  it("第一个候选 ENOENT（真形状：error 之后还有一次 close）→ 收尾归第二个候选", async () => {
    putReport({ mode: "full", packages: {} });
    queueChild({ error: { code: "ENOENT" }, closeCode: null });
    queueChild({ closeCode: 0 });
    const res = await post({ action: "parse", packages: ["ComfyUI-Foo"] });
    const events = await eventsOf(res);
    expect(interpreterNames()).toEqual(ORDER.slice(0, 2));
    const done = eventOf(events, "done");
    /* `exitCode` 才是「谁收的尾」的读数：少了 `handedOff` 那一层守卫，第一个**压根没起来**
     * 的进程随后那次 `close(null)` 会先定案 —— 于是这一格是 `null`，第二档真跑完的输出
     * 全被丢掉（而报告文件在盘上其实存在，所以 `ok` 照样可能是 true，看不出来）。 */
    expect(done.exitCode).toBe(0);
    expect(done.ok).toBe(true);
  });

  it("非缺解释器的失败（EACCES）不换档，原因透成 error 并收尾", async () => {
    queueChild({ error: { code: "EACCES", message: "spawn EACCES" } });
    queueChild({ closeCode: 0 });
    const res = await post({ action: "parse", packages: ["ComfyUI-Foo"] });
    const events = await eventsOf(res);
    expect(interpreterNames()).toEqual(ORDER.slice(0, 1));
    expect(JSON.stringify(events)).toContain("EACCES");
    expect(eventOf(events, "done").ok).toBe(false);
  });

  it("起 `py` 那一档时 argv 首位是 -3（这条链同样不许裸起 py）", async () => {
    // 「排一个候选一次」按判据的长度来，不写死数字（POSIX 上只有两个候选）。
    ORDER.forEach(() => queueChild({ closeCode: 127 }));
    const res = await post({ action: "parse", packages: ["ComfyUI-Foo"] });
    await eventsOf(res);
    /* 逐候选对账，而不是只盯 `calls[2]`：位置由判据给，写死下标就等于在这里
     * 又抄一份顺序（POSIX 上根本没有 `py` 这一档，那条断言会莫名其妙地空过）。 */
    for (const [command, args] of spawnMock.mock.calls) {
      if (String(command) !== "py") continue;
      expect(/* SAFETY: 类型断言已复核 */ (args as string[])[0]).toBe("-3");
    }
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
  return /* SAFETY: 类型断言已复核 */ payload.summary as Record<
    string,
    unknown
  > | null;
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
  return /* SAFETY: 类型断言已复核 */ (await res.json()) as Record<
    string,
    unknown
  >;
}

/** 把流式响应读到底，按行解析成事件数组。 */
async function eventsOf(res: Response): Promise<Record<string, unknown>[]> {
  const text = await res.text();
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map(
      (line) =>
        /* SAFETY: 类型断言已复核 */ JSON.parse(line) as Record<
          string,
          unknown
        >,
    );
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
    const body = /* SAFETY: 类型断言已复核 */ (await res.json()) as {
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
    const body = /* SAFETY: 类型断言已复核 */ (await res.json()) as {
      error?: { message?: string };
    };
    expect(body.error?.message).toBe("读取配置失败");
  });

  it("500 的信封里只有 error —— 消费方靠「没有 settings」判失败，形状不许偷偷加字段", async () => {
    fsState.files.set(MANIFEST, { text: "{}", existsFails: true });
    const res = await GET();
    expect(
      Object.keys(
        /* SAFETY: 类型断言已复核 */ (await res.json()) as Record<
          string,
          unknown
        >,
      ),
    ).toEqual(["error"]);
  });
});

describe("GET 摘要：清单的六种坏法", () => {
  it("还没有清单 → 200 + settings（paths 是推导出来的那一条），summary 为 null", async () => {
    const parent = coldRoot();
    const events = await getEvents();
    const summary = eventOf(events, "summary");
    expect(summary.summary).toBeNull();
    const settings = /* SAFETY: 类型断言已复核 */ summary.settings as {
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
      /* SAFETY: 类型断言已复核 */ (
        eventOf(events, "summary").summary as Record<string, unknown>
      )?.totalNodes,
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
      .map(
        (l) =>
          /* SAFETY: 类型断言已复核 */ JSON.parse(l) as Record<string, unknown>,
      );
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
    const body = /* SAFETY: 类型断言已复核 */ (await res.json()) as Record<
      string,
      unknown
    >;
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(body.discoveredByParent).toEqual({ [parent]: [{ name: "Foo" }] });
    expect(
      /* SAFETY: 类型断言已复核 */ (body.summary as Record<string, unknown>)
        .totalNodes,
    ).toBe(2);
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
      /* SAFETY: 类型断言已复核 */ (
        eventOf(events, "summary").summary as Record<string, unknown>
      ).totalNodes,
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
    expect(
      String(
        /* SAFETY: 类型断言已复核 */ (events[2] as { message?: string })
          .message ?? "",
      ),
    ).not.toBe("");
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
    const byPath = /* SAFETY: 类型断言已复核 */ eventOf(events, "summary")
      .byPath as Record<string, unknown>;
    expect(Object.keys(byPath)).toHaveLength(1);
    const key = Object.keys(byPath)[0] ?? "";
    expect(key).toBe(key.toLowerCase());
    expect(key.split(path.sep).join("/")).toContain("custom_nodes/foo");
  });
});

/**
 * 流式探测那一支的**进程协议**（`runDiscoverStreaming`）。
 *
 * 上面那批用例把结果读对了，但**失败与进度的来源**基本没人跑过：
 * 唯一那条「流内部起进程失败」把 `spawnMock` 排成**同步 throw**，走的是外层 catch，
 * 而真机上 `spawn("python3")` 缺解释器时**不 throw**，是**异步 `error` 事件（ENOENT）**——
 * 那个事件才是 `python3 → python → py` 退避链的驱动者，Windows 上这是主路径。
 * 同族还没执行者的：`close` 码 127 也要换解释器、非 ENOENT 的 error **不许**继续换、
 * `stderr` 每一行都要转成进度、`PROGRESS::` 那行语法的四个分支（`hash` 的 done/total、
 * 没有 `msg=` 的旧格式、不成形的行跳过、**一行被 chunk 切断**），
 * 以及「最后一行 JSON 才算结果」「收尾 JSON 坏了要带退出码」。
 *
 * 夹具形状：`queueChild()` 排的是**真形状的事件**（`error` 走 `cp.on("error")`、
 * `close` 带退出码、data 可以只给半行），一次可排多个子进程 —— 解释器退避链的判据
 * 就是「第 N 个子进程是谁、argv 落在哪个候选上」。
 */
type ChildPlan = {
  /** 逐行吐（自动补 `\n`），与 `scriptDiscover` 同义。 */
  lines?: string[];
  /** 逐 chunk 原样吐（**不**补换行）—— 用来造「一行被切断」。 */
  chunks?: string[];
  errChunks?: string[];
  /** 异步 `error` 事件（真机上缺解释器就是这一形）。给了它默认不再发 close。 */
  error?: { code: string; message?: string };
  closeCode?: number | null;
  /** 显式要求发 close（配合 `error` 用）。 */
  noClose?: boolean;
};

function queueChild(plan: ChildPlan): void {
  spawnMock.mockImplementationOnce(() => {
    const child: FakeChild = { proc: {}, out: {}, err: {} };
    const reg = (bag: Record<string, Cb[]>) => (ev: string, cb: Cb) => {
      (bag[ev] ??= []).push(cb);
    };
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
      pid: 9,
    };
    children.push(child);
    const fire = (
      bag: Record<string, Cb[]>,
      ev: string,
      arg: unknown,
    ): void => {
      for (const cb of bag[ev] ?? []) cb(arg);
    };
    /* 延后一拍：注册必须先于触发（与被测代码同步挂监听这一段配对）。 */
    setTimeout(() => {
      for (const c of plan.chunks ?? [])
        fire(child.out, "data", Buffer.from(c));
      for (const l of plan.lines ?? [])
        fire(child.out, "data", Buffer.from(`${l}\n`));
      for (const e of plan.errChunks ?? [])
        fire(child.err, "data", Buffer.from(e));
      if (plan.error) {
        fire(
          child.proc,
          "error",
          Object.assign(
            new Error(plan.error.message ?? `spawn ${plan.error.code}`),
            {
              code: plan.error.code,
            },
          ),
        );
      }
      if (!plan.noClose && (!plan.error || plan.closeCode !== undefined)) {
        /* `closeCode: null` 是**真机那一形**（spawn 失败时 Node 给的是 null，不是 0），
         * 所以这里不能写 `?? 0` —— 那样 `null` 会被折成 0，「退出码为空」这一档
         * 在夹具里就永远造不出来了。 */
        fire(
          child.proc,
          "close",
          plan.closeCode === undefined ? 0 : plan.closeCode,
        );
      }
    }, 0);
    return handle;
  });
}

const ONE_PKG_LINE = JSON.stringify({
  packages: [{ name: "Foo", path: "/tmp/custom_nodes/foo" }],
});

/** 事件里那句人读文案（不是对象时才当字符串读，`unknown` 不许直接进 String）。 */
function msgOf(ev: Record<string, unknown>): string {
  return typeof ev.msg === "string" ? ev.msg : "";
}

/**
 * 从进度事件里挑含 `substr` 的那一条。
 *
 * 不能取「第一条 progress」：外层流自己会先吐一条 `📂 [1/1] <扫描根>`，
 * 拿第一条会把外层那条当成解析器发来的进度（实测就是这四条一开始红的原因）。
 */
function progressWith(
  events: Record<string, unknown>[],
  substr: string,
): Record<string, unknown> {
  const hit = events.find(
    (e) => e.type === "progress" && msgOf(e).includes(substr),
  );
  if (!hit) {
    throw new Error(
      `进度事件里没有含 "${substr}" 的那条，实到的进度：` +
        JSON.stringify(events.filter((e) => e.type === "progress")),
    );
  }
  return hit;
}

/** 本次起的每个子进程用的是哪个解释器候选（按调用顺序）。 */
function interpreterNames(): string[] {
  return spawnMock.mock.calls.map((call) => String(call[0]));
}

describe("流式探测的进程协议：解释器退避、stderr、PROGRESS 行语法", () => {
  it("第一个候选缺位（异步 ENOENT）→ 退到第二个，结果仍然落地", async () => {
    coldRoot();
    queueChild({ error: { code: "ENOENT" } });
    queueChild({ lines: [ONE_PKG_LINE] });
    const events = await getEvents();
    expect(interpreterNames()).toEqual(ORDER.slice(0, 2));
    const done = eventOf(events, "discover_done");
    expect(done.packages).toHaveLength(1);
    expect(done.cached).toBe(false);
    /* 退避成功时不许把「未找到解释器」那句念出来 —— 那是全部候选都失败那一档的话。 */
    expect(JSON.stringify(events)).not.toContain("未找到 Python 解释器");
  });

  it("全部候选都 ENOENT → 每一个都得起过，最后一个的原因当场透出来", async () => {
    coldRoot();
    ORDER.forEach(() => queueChild({ error: { code: "ENOENT" } }));
    const events = await getEvents();
    /* 「全失败」这一档的真形状是**每个候选都起过**：少起一个就是退避链断了，
     * 而界面只显示「没有节点」，没人知道是解释器没找着。 */
    expect(interpreterNames()).toEqual(ORDER);
    /* 最后一个候选之后必须仍然给出**一句读得懂的原因** —— 这一句在修可达性之前不可达
     * （两条退避都写成 `i < pyCandidates.length - 1`，`i` 最大只到 2 就地 resolve），
     * 真机没装 Python 时界面只剩「0 个节点」。 */
    expect(
      events.filter((e) => msgOf(e).includes("未找到 Python 解释器")),
    ).toHaveLength(1);
    expect(events.map((e) => e.type).slice(-1)[0]).toBe("done");
    /* 全失败**不许**回一个像成功的空收尾：没有解释器就没有 discover_done 这一步事实。 */
    expect(events.some((e) => e.type === "discover_done")).toBe(false);
  });

  it("全部候选都以 127 退出 → 同一句「未找到 Python 解释器」，与 ENOENT 那一档同答案", async () => {
    coldRoot();
    // 「排一个候选一次」按判据的长度来，不写死数字（POSIX 上只有两个候选）。
    ORDER.forEach(() => queueChild({ closeCode: 127 }));
    const events = await getEvents();
    expect(interpreterNames()).toEqual(ORDER);
    expect(
      events.filter((e) => msgOf(e).includes("未找到 Python 解释器")),
    ).toHaveLength(1);
    expect(events.map((e) => e.type).slice(-1)[0]).toBe("done");
    expect(events.some((e) => e.type === "discover_done")).toBe(false);
  });

  it("非 ENOENT 的 error（EACCES）不再换解释器，原因当场透成进度", async () => {
    coldRoot();
    queueChild({ error: { code: "EACCES", message: "spawn EACCES" } });
    /* 后面这一份**不该被用到**：继续退避到下一个候选才是这条要拦的错法。 */
    queueChild({ lines: [ONE_PKG_LINE] });
    const events = await getEvents();
    expect(spawnMock.mock.calls).toHaveLength(1);
    expect(interpreterNames()).toEqual(ORDER.slice(0, 1));
    const progress = events.filter((e) => e.type === "progress");
    expect(JSON.stringify(progress)).toContain("EACCES");
    expect(events.map((e) => e.type).slice(-1)[0]).toBe("done");
  });

  it("退出码 127（命令不存在）也要换下一个解释器", async () => {
    coldRoot();
    queueChild({ closeCode: 127 });
    queueChild({ lines: [ONE_PKG_LINE] });
    const events = await getEvents();
    expect(interpreterNames()).toEqual(ORDER.slice(0, 2));
    expect(eventOf(events, "discover_done").packages).toHaveLength(1);
  });

  it("缺解释器那一档的真形状是 error 之后**再来一次 close**：那次 close 不许定案", async () => {
    /* 真机上 `spawn` 一个不存在的命令，Node 先报 `error`（ENOENT），随后**仍然发一次
     * `close`**。上面那两条退避用例的夹具刻意不发这次 close —— 于是「换到第二个候选
     * 并且第二个真跑成」这一条路，在加了这个守卫之前从来没有执行者：第一个（压根没起来
     * 的）进程的 close 会先走到收尾分支，把「0 个节点」定成答案并置 `resolved`，
     * 第二个真跑成的那一档随后被 `if (resolved) return` 丢掉。
     * 这一条要的就是**第二个候选的结果落地**，不是「有个 discover_done 就行」。 */
    coldRoot();
    queueChild({ error: { code: "ENOENT" }, closeCode: null });
    queueChild({ lines: [ONE_PKG_LINE] });
    const events = await getEvents();
    expect(interpreterNames()).toEqual(ORDER.slice(0, 2));
    expect(eventOf(events, "discover_done").packages).toHaveLength(1);
    /* 空结果只许出现这一次：真答案被顶掉时这里是 `[]`。 */
    expect(JSON.stringify(events)).not.toContain("未找到 Python 解释器");
  });

  it("解析器写 stderr 的每一行都转成进度，前面带 ⚠️（警告在界面上要看得见）", async () => {
    coldRoot();
    queueChild({
      errChunks: ["SyntaxWarning: pip is old\n"],
      lines: [ONE_PKG_LINE],
    });
    const events = await getEvents();
    const hit = events.find((e) => msgOf(e).includes("SyntaxWarning"));
    expect(
      hit,
      `事件流里没有那句 stderr 警告：${JSON.stringify(events)}`,
    ).toBeTruthy();
    expect(hit ? msgOf(hit) : "").toContain("⚠️");
    expect(hit?.phase).toBe("scan");
  });

  it("PROGRESS::hash 的 done 与 total 两个计数都要在（界面靠它填进度条，不解析中文）", async () => {
    coldRoot();
    queueChild({
      lines: ["PROGRESS::hash|msg=算哈希|done=7|total=20", ONE_PKG_LINE],
    });
    const events = await getEvents();
    expect(progressWith(events, "算哈希")).toMatchObject({
      phase: "hash",
      done: 7,
      total: 20,
    });
  });

  it("旧格式（没有 msg=）整段当文案透出去，不许把事件丢掉", async () => {
    coldRoot();
    queueChild({
      lines: ["PROGRESS::scan|正在扫 /tmp/Custom_Nodes", ONE_PKG_LINE],
    });
    const events = await getEvents();
    expect(progressWith(events, "正在扫").msg).toBe("正在扫 /tmp/Custom_Nodes");
  });

  it("不成形的 PROGRESS:: 行被跳过，但后面的结果行仍然算数", async () => {
    coldRoot();
    queueChild({ lines: ["PROGRESS::weird-line", ONE_PKG_LINE] });
    const events = await getEvents();
    expect(JSON.stringify(events)).not.toContain("weird-line");
    expect(eventOf(events, "discover_done").packages).toHaveLength(1);
  });

  it("一行被 chunk 切断也要拼回来（一次 data 不等于一行）", async () => {
    coldRoot();
    queueChild({
      chunks: ["PROGRESS::scan|msg=前半", "后半段\n", `${ONE_PKG_LINE}\n`],
    });
    const events = await getEvents();
    expect(progressWith(events, "前半后半段").msg).toBe("前半后半段");
    expect(eventOf(events, "discover_done").packages).toHaveLength(1);
  });

  it("以最后一行 JSON 为准（解析器中途吐过的 JSON 行不许当结果）", async () => {
    coldRoot();
    queueChild({
      lines: [
        JSON.stringify({ packages: [{ name: "Old", path: "/tmp/a" }] }),
        ONE_PKG_LINE,
      ],
    });
    const events = await getEvents();
    const packages = /* SAFETY: 类型断言已复核 */ eventOf(
      events,
      "discover_done",
    ).packages as {
      name: string;
    }[];
    expect(packages.map((p) => p.name)).toEqual(["Foo"]);
  });

  it("收尾时最后一行不是合法 JSON → 失败进度里带退出码，流不挂着", async () => {
    coldRoot();
    queueChild({ lines: ["{not json at all"], closeCode: 3 });
    const events = await getEvents();
    const hit = events.find((e) => msgOf(e).includes("解析失败"));
    expect(
      hit,
      `没有那句带退出码的失败进度：${JSON.stringify(events)}`,
    ).toBeTruthy();
    expect(hit ? msgOf(hit) : "").toContain("3");
    expect(events.map((e) => e.type).slice(-1)[0]).toBe("done");
  });
});
