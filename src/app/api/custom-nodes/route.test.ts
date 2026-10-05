/**
 * `/api/custom-nodes` POST 的闸门用例（台账 A6）。
 *
 * 这个端点会把客户端传来的字符串**拼进 spawn 的 argv**（Python 解析器），所以它
 * 的危险不是 SQL 那种「查别人的行」，而是「让自己的命令行多出两个 token」：
 * 解析器本身写死了 `--out=<manifest>` / `--report-out=<report>`，一旦包名能带
 * `--out=...`，客户端就能把生成物写到机器上任意路径（任意文件覆写）。
 * 判据收在 `safeSpawnArg()`：flag 形态、空/超长、shell 元字符一律拒。
 *
 * 因此用例的分工是「**拒绝必须发生在 spawn 之前**」—— 只在响应码上打勾是不够的，
 * 请求已经发出去了就等于没拦住。正面一条（合法包名）同时钉住 argv 的形状：
 * `--only-pkgs` 永远是**一个**值、`--out` 的位置与内容不许被客户端挪动。
 *
 * mock 边界：`node:child_process`（换成可编程的假子进程，绝不真起 Python）、
 * `~/server/auth/request-user`（鉴权两态）、`~/lib/app-settings/app-settings.server`
 * 与 `~/lib/envfile`（扫描根的推导口径 —— 这里只关心「有没有配过」）。
 */
import path from "node:path";
import type { NextRequest } from "next/server";
import { describe, expect, it, vi, beforeEach } from "vitest";

type Cb = (...args: unknown[]) => void;
interface FakeChild {
  proc: Record<string, Cb[]>;
  out: Record<string, Cb[]>;
  err: Record<string, Cb[]>;
}

const { spawnMock, userMock, settingsMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  userMock: vi.fn<() => Promise<{ id: string } | null>>(),
  settingsMock: vi.fn<() => { comfyuiPath: string }>(() => ({
    comfyuiPath: "C:/ComfyUI",
  })),
}));

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

import { POST } from "./route";

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
  children.length = 0;
  nextStdout = "";
  installFakeChild();
  userMock.mockResolvedValue({ id: "user-a" });
  settingsMock.mockReturnValue({ comfyuiPath: "C:/ComfyUI" });
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
