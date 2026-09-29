/**
 * 桌包 standalone 形态的判据（P3 §5 · ISSUE #1216，3-E2a）。
 *
 * 这一刀的每条判据都来自一次真跑，而且**每条失败的表现都是同一个**：用户双击桌包后
 * 窗口停在启动页，或页面 200 而接口全 500。桌包链路既不在 pre-commit 也不在 CI，
 * 构建期一片绿是常态——所以判据必须落在「跑得到、且改回去就红」的形态上：
 *   · 形态层（永远跑）：顶层白名单的默认拒绝、私有输入剔除、运行期 env 装配、
 *     首启建表，以及「装配 / 打包配置 / 产物层检查三者同形」。
 *   · 入口层：用**桩 server** 在临时目录里真起一次入口（不起真 Next），验 boot 行 /
 *     建表 / 退出码透传 / 缺件时大声失败。「文件名里的冒号」这类只有真跑才暴露的问题
 *     就是这么抓到的（本刀第一版栽在 Windows 非法文件名上）。
 * 真 Next server 那一跑（`/`、`/workspace`、`/api/health` 全 200）不在这里：它要一次
 * 全量构建。它的构建期等价物是 `scripts/build-desktop.mjs` §载荷实体化 的三条模块解析断言。
 */
import { DatabaseSync } from "node:sqlite";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { cpSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/**
 * 被测的两个模块是纯 Node 宿主模块（§18.4 第三类：既不加 `server-only` 也不是
 * `.server.ts`），TS 侧没有声明文件。这里**显式声明消费的这一小片面**而不是收 `any`：
 * 判据的形状必须由用例自己写清楚，否则模块改签名时用例会静默变宽。
 */
type StaticAllowModule = {
  isStaticPathAllowed: (rel: string) => boolean;
  pruneStaticToAllowList: (
    dir: string,
    onRemoved?: (name: string) => void,
  ) => string[];
  RUNTIME_SRC: string[];
  RUNTIME_SCRIPTS: string[];
  BUILT_RUNTIME_SCRIPTS: string[];
  PRIVATE_INPUTS: string[];
  stripPrivateInputs: (
    dir: string,
    onRemoved?: (name: string) => void,
  ) => string[];
};
type RuntimeEnvModule = {
  OAUTH_PLACEHOLDER: string;
  AUTH_SECRET_FILE_REL: string;
  readOrCreateAuthSecret: (appRoot: string) => string;
  standaloneDbFile: (appRoot: string) => string;
  buildStandaloneRuntimeEnv: (input: {
    appRoot: string;
    port: number;
    env?: NodeJS.ProcessEnv;
  }) => NodeJS.ProcessEnv;
  ensureStandaloneSchema: (input: { appRoot: string; dbFile?: string }) => {
    applied: boolean;
    tablesBefore: number;
    tablesAfter: number;
  };
};

const load = <T>(rel: string): Promise<T> =>
  import(pathToFileURL(path.join(ROOT, rel)).href) as Promise<T>;
const loadStatic = () =>
  load<StaticAllowModule>("scripts/standalone-private-inputs.mjs");
const loadEnv = () =>
  load<RuntimeEnvModule>("scripts/launcher-core/standalone-runtime-env.mjs");

/** 只含结构的最小 DDL（真实 DDL 由 §首启建表 每轮构建现生成）。 */
const FIXTURE_DDL = [
  "CREATE TABLE IF NOT EXISTS `probe_a` (`id` text PRIMARY KEY NOT NULL);",
  "CREATE TABLE IF NOT EXISTS `probe_b` (`id` text PRIMARY KEY NOT NULL);",
].join("\n");

/**
 * 运行期脚本的注册表（同一份清单也喂给 §10.2 与产物层检查）。桩载荷照它拷，于是
 * 「入口的 import 闭包里漏登记一条」会以 ERR_MODULE_NOT_FOUND 的形式红在这里，
 * 而不是等到桌包双击。
 */
const registry = await loadStatic();

let workdir = "";
beforeEach(() => {
  workdir = mkdtempSync(path.join(tmpdir(), "standalone-payload-"));
});
afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe("桌包载荷的顶层白名单（默认拒绝）", () => {
  it("Next 运行必需件放行，开发期内容与大目录拒绝", async () => {
    const { isStaticPathAllowed } = await loadStatic();
    for (const allow of [
      "server.js",
      "package.json",
      ".next",
      ".next/server",
      "node_modules",
      "public",
      "scripts",
      "splash.html",
      "index.html",
      "schema.sql",
    ]) {
      expect(isStaticPathAllowed(allow), allow).toBe(true);
    }
    // 这一组都是实测躺在 .next/standalone 里的：黑名单永远追不完，所以判据是默认拒绝。
    for (const deny of [
      "changelog.d",
      "docs",
      "tests",
      "e2e",
      "tools",
      "log",
      "temp",
      "run",
      "coverage",
      "data",
      "python-venv",
      "src-tauri",
      "Comfy APP.lnk",
      "next.config.js",
      "postcss.config.js",
      "build-launcher",
    ]) {
      expect(isStaticPathAllowed(deny), deny).toBe(false);
    }
  });

  it("src 只按逐文件清单放行（祖先放行到叶子，兄弟一律拒绝）", async () => {
    const { isStaticPathAllowed, RUNTIME_SRC } = await loadStatic();
    expect(RUNTIME_SRC).toContain("lib/process/kill-process-tree.ts");
    expect(isStaticPathAllowed("src")).toBe(true);
    expect(isStaticPathAllowed("src/lib")).toBe(true);
    expect(isStaticPathAllowed("src/lib/process/kill-process-tree.ts")).toBe(
      true,
    );
    expect(isStaticPathAllowed("src/lib/comfyui/host-runtime.ts")).toBe(false);
    expect(isStaticPathAllowed("src/server/db.ts")).toBe(false);
  });

  it("回收入口 import 的那份 TS 必须就在清单里（漏登记 = 桌包回收链静默断）", async () => {
    // reap-process.mjs 与 dev-launcher.mjs 都 `await import("../src/lib/process/…")`，
    // 而载荷里的 src/ 是默认拒绝的——清单与这两处说明符必须逐字相等。
    const specifiers = ["scripts/reap-process.mjs", "scripts/dev-launcher.mjs"]
      .flatMap((file) =>
        [...read(file).matchAll(/"\.\.\/src\/(lib\/[^"]+\.ts)"/g)].map(
          (m) => m[1],
        ),
      )
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .sort();
    expect(specifiers.length).toBeGreaterThan(0);
    const { RUNTIME_SRC } = await loadStatic();
    expect([...RUNTIME_SRC].sort()).toEqual(specifiers);
  });

  it("落盘兜底真的剪得动（不只是 filter 里一句判断）", async () => {
    const { pruneStaticToAllowList } = await loadStatic();
    mkdirSync(path.join(workdir, "src/lib/comfyui"), { recursive: true });
    mkdirSync(path.join(workdir, "src/lib/process"), { recursive: true });
    mkdirSync(path.join(workdir, "changelog.d"), { recursive: true });
    writeFileSync(path.join(workdir, "server.js"), "//", "utf8");
    writeFileSync(path.join(workdir, "src/lib/comfyui/x.ts"), "x", "utf8");
    writeFileSync(
      path.join(workdir, "src/lib/process/kill-process-tree.ts"),
      "k",
      "utf8",
    );
    writeFileSync(path.join(workdir, "changelog.d/1.md"), "m", "utf8");
    const removed = pruneStaticToAllowList(workdir);
    expect(removed).toContain("changelog.d");
    expect(existsSync(path.join(workdir, "changelog.d"))).toBe(false);
    expect(existsSync(path.join(workdir, "src/lib/comfyui"))).toBe(false);
    expect(
      existsSync(path.join(workdir, "src/lib/process/kill-process-tree.ts")),
    ).toBe(true);
    expect(existsSync(path.join(workdir, "server.js"))).toBe(true);
  });
});

describe("开发机私有输入：data 下的密钥与设置不许随包", () => {
  it("PRIVATE_INPUTS 覆盖那两份，且真的被删掉", async () => {
    const { PRIVATE_INPUTS, stripPrivateInputs } = await loadStatic();
    expect(PRIVATE_INPUTS).toContain("data/llm-secret.key");
    expect(PRIVATE_INPUTS).toContain("data/app-settings.json");
    // 首启写进载荷根的会话密钥：重装后直接 bundle（不重装配）也会一起带出去。
    expect(PRIVATE_INPUTS).toContain("data/runtime-secret.json");
    mkdirSync(path.join(workdir, "data"), { recursive: true });
    writeFileSync(
      path.join(workdir, "data/llm-secret.key"),
      "SECRET-ISH",
      "utf8",
    );
    writeFileSync(path.join(workdir, ".env"), "A=1", "utf8");
    const removed = stripPrivateInputs(workdir);
    expect(removed).toContain("data/llm-secret.key");
    expect(removed).toContain(".env");
    expect(existsSync(path.join(workdir, "data/llm-secret.key"))).toBe(false);
  });
});

describe("入口的运行期环境装配（分发产物不含 .env）", () => {
  it("少 PORT / 坏 PORT 都大声失败：缺省端口等于让 server 与壳各认一个", async () => {
    const { buildStandaloneRuntimeEnv } = await loadEnv();
    expect(() =>
      buildStandaloneRuntimeEnv({ appRoot: workdir, port: Number.NaN }),
    ).toThrow(/PORT/);
    expect(() =>
      buildStandaloneRuntimeEnv({ appRoot: workdir, port: 0 }),
    ).toThrow(/PORT/);
  });

  it("必填项逐个给值，数据库是绝对路径，回环是 127.0.0.1", async () => {
    const { buildStandaloneRuntimeEnv } = await loadEnv();
    const env = buildStandaloneRuntimeEnv({ appRoot: workdir, port: 4123 });
    for (const key of [
      "BETTER_AUTH_SECRET",
      "BETTER_AUTH_GITHUB_CLIENT_ID",
      "BETTER_AUTH_GITHUB_CLIENT_SECRET",
      "BETTER_AUTH_URL",
      "DATABASE_URL",
      "PORT",
      "HOSTNAME",
      "SKIP_ENV_VALIDATION",
    ]) {
      expect(typeof env[key], key).toBe("string");
      expect(String(env[key]).length, key).toBeGreaterThan(0);
    }
    expect(env.DATABASE_URL).toBe(`file:${path.join(workdir, "db.sqlite")}`);
    expect(env.HOSTNAME).toBe("127.0.0.1");
    expect(env.BETTER_AUTH_URL).toBe("http://127.0.0.1:4123");
  });

  it("NODE_ENV 必须是 production，并且盖掉继承来的 development", async () => {
    const { buildStandaloneRuntimeEnv } = await loadEnv();
    // 载荷**就是**生产构建（Next 的 standalone `server.js` 自己会设这一项），但宿主
    // 是独立进程、不经过 server.js。留在 development 的后果实测过：`src/lib/core/logger.ts`
    // 会选 pino-pretty 的 worker transport，而那是 devDependency、不在载荷里，宿主在
    // 模块加载阶段就 `unable to determine transport target for "pino-pretty"` 退出 1。
    const env = buildStandaloneRuntimeEnv({
      appRoot: workdir,
      port: 4127,
      env: { NODE_ENV: "development" },
    });
    expect(env.NODE_ENV).toBe("production");
  });

  it("BETTER_AUTH_SECRET 跨调用稳定（变了等于把用户登出）", async () => {
    const { buildStandaloneRuntimeEnv, AUTH_SECRET_FILE_REL } = await loadEnv();
    const first = String(
      buildStandaloneRuntimeEnv({ appRoot: workdir, port: 4124 })
        .BETTER_AUTH_SECRET,
    );
    const again = String(
      buildStandaloneRuntimeEnv({ appRoot: workdir, port: 4124 })
        .BETTER_AUTH_SECRET,
    );
    expect(again).toBe(first);
    expect(first.length).toBeGreaterThanOrEqual(32);
    expect(existsSync(path.join(workdir, AUTH_SECRET_FILE_REL))).toBe(true);
  });

  it("密钥文件坏掉时报错，不悄悄换一把", async () => {
    const { readOrCreateAuthSecret } = await loadEnv();
    mkdirSync(path.join(workdir, "data"), { recursive: true });
    writeFileSync(
      path.join(workdir, "data/runtime-secret.json"),
      "{ not json",
      "utf8",
    );
    expect(() => readOrCreateAuthSecret(workdir)).toThrow(/not valid JSON/);
    writeFileSync(
      path.join(workdir, "data/runtime-secret.json"),
      JSON.stringify({ betterAuthSecret: "abc" }),
      "utf8",
    );
    expect(() => readOrCreateAuthSecret(workdir)).toThrow(/too short/);
  });

  it("OAuth 占位值只有一份定义（两份字面量迟早分叉，且两侧都能起来 = 没人报红）", async () => {
    const { OAUTH_PLACEHOLDER } = await loadEnv();
    expect(OAUTH_PLACEHOLDER.length).toBeGreaterThan(0);
    const init = read("scripts/env-init.mjs");
    expect(init).toContain("standalone-runtime-env.mjs");
    expect(init).toContain("OAUTH_PLACEHOLDER");
    expect(init).not.toMatch(/const OAUTH_PLACEHOLDER\s*=/);
  });
});

describe("首启建表（载荷里没有 drizzle-kit）", () => {
  it("零表 + 有 DDL ⇒ 建出来；再跑一次 ⇒ 不动已有表", async () => {
    const { ensureStandaloneSchema, standaloneDbFile } = await loadEnv();
    writeFileSync(path.join(workdir, "schema.sql"), FIXTURE_DDL, "utf8");
    const first = ensureStandaloneSchema({ appRoot: workdir });
    expect(first.applied).toBe(true);
    expect(first.tablesBefore).toBe(0);
    expect(first.tablesAfter).toBe(2);
    const second = ensureStandaloneSchema({ appRoot: workdir });
    expect(second.applied).toBe(false);
    expect(second.tablesAfter).toBe(2);

    const db = new DatabaseSync(standaloneDbFile(workdir));
    expect(
      db
        .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'")
        .get(),
    ).toMatchObject({ n: 2 });
    db.close();
  });

  it("已有用户的表 + 缺 DDL ⇒ 不报错（重装/升级不该被首启判据拦住，也不许重建库）", async () => {
    const { ensureStandaloneSchema } = await loadEnv();
    const db = new DatabaseSync(path.join(workdir, "db.sqlite"));
    db.exec("CREATE TABLE `keepme` (`id` text PRIMARY KEY NOT NULL)");
    db.exec("INSERT INTO `keepme` VALUES ('row')");
    db.close();
    const result = ensureStandaloneSchema({ appRoot: workdir });
    expect(result.applied).toBe(false);
    expect(result.tablesBefore).toBe(1);
    const check = new DatabaseSync(path.join(workdir, "db.sqlite"));
    expect(
      check.prepare("SELECT COUNT(*) AS n FROM `keepme`").get(),
    ).toMatchObject({
      n: 1,
    });
    check.close();
  });

  it("零表且缺 DDL ⇒ 大声失败并指回装配步", async () => {
    const { ensureStandaloneSchema } = await loadEnv();
    expect(() => ensureStandaloneSchema({ appRoot: workdir })).toThrow(
      /build-desktop/,
    );
  });
});

describe("入口真起一次（桩 server：验 boot / 建表 / 退出码 / 大声失败）", () => {
  /** 组一个最小载荷：入口与注册表里的运行期脚本都在，`server.js` 用桩替。
   *  `host` 给字符串 = 用这份桩覆盖 `scripts/executor-host.mjs`（注册表会把真入口
   *  拷进来，不覆盖就会真起一个宿主）；给 `null` = 载荷里**没有**宿主入口。 */
  function stagePayload(serverBody: string, host?: string | null) {
    for (const name of registry.RUNTIME_SCRIPTS) {
      if (registry.BUILT_RUNTIME_SCRIPTS.includes(name)) continue; // 构建期产物，桩里没有
      const src = path.join(ROOT, "scripts", name);
      if (!existsSync(src)) continue; // 缺源由 §10.2 的断言负责，不在这里判
      const dest = path.join(workdir, "scripts", name);
      mkdirSync(path.dirname(dest), { recursive: true });
      cpSync(src, dest);
    }
    writeFileSync(path.join(workdir, "schema.sql"), FIXTURE_DDL, "utf8");
    // 回收入口运行期 `await import` 的那份 TS 也要在（真载荷由 build-desktop 按
    // `RUNTIME_SRC` 逐文件放行）。缺它 `reap-process.mjs` 会报「无法加载进程树回收
    // 模块」，于是「收了两棵树」那类断言验的就不是回收，而是假出来的载荷。
    for (const rel of registry.RUNTIME_SRC) {
      const dest = path.join(workdir, "src", rel);
      mkdirSync(path.dirname(dest), { recursive: true });
      cpSync(path.join(ROOT, "src", rel), dest);
    }
    if (serverBody !== "") {
      writeFileSync(path.join(workdir, "server.js"), serverBody, "utf8");
    }
    const hostPath = path.join(workdir, "scripts", "executor-host.mjs");
    if (host === null) rmSync(hostPath, { force: true });
    else if (host !== undefined) writeFileSync(hostPath, host, "utf8");
  }

  const entryPath = () =>
    path.join(workdir, "scripts", "standalone-runtime.mjs");
  const runWith = (port: string, extraEnv: Record<string, string> = {}) =>
    spawnSync(process.execPath, [entryPath()], {
      encoding: "utf8",
      env: { ...process.env, PORT: port, ...extraEnv },
      timeout: 90_000,
    });
  const both = (r: { stdout?: string; stderr?: string }) =>
    `${r.stdout ?? ""}${r.stderr ?? ""}`;
  /** 宿主自己的输出通道内容（入口把这两份路径写在 `host pid=` 那一行里）。 */
  function hostStdout() {
    const dir = path.join(workdir, "log", "services");
    if (!existsSync(dir)) return "";
    return readdirSync(dir)
      .filter((n) => n.startsWith("executor-host-stdout-"))
      .map((n) => readFileSync(path.join(dir, n), "utf8"))
      .join("");
  }

  it("boot 行 + 首启建表 + 按次命名的日志（文件名里没有冒号与空格）", () => {
    stagePayload("console.log('stub server up'); process.exit(0);\n");
    const out = runWith("4210");
    const text = both(out);
    expect(out.status, text).toBe(0);
    expect(text).toMatch(/boot pid=\d+ server=\d+ port=4210/);
    expect(text).toMatch(/schema bootstrap tables=0->2/);
    expect(text).toMatch(/closing \(server exited code=0/);
    const dir = path.join(workdir, "log", "nextjs");
    const names = readdirSync(dir);
    // 本刀第一版用了带冒号与空格的日志行时间戳，Windows 上直接 ENOENT：钉住文件名形态。
    for (const name of names) {
      expect(name, name).not.toMatch(/[: ]/);
    }
    const stdoutName = names.find((n) =>
      n.startsWith("standalone-server-stdout-"),
    );
    expect(stdoutName, names.join(",")).toBeTruthy();
    expect(readFileSync(path.join(dir, String(stdoutName)), "utf8")).toContain(
      "stub server up",
    );
    // 库与日志都落在载荷根，而不是调用者的 cwd。
    expect(existsSync(path.join(workdir, "db.sqlite"))).toBe(true);
  });

  it("桩 server 退 3 ⇒ 入口也退 3（壳据此写它的失败出口）", () => {
    stagePayload("process.exit(3);\n");
    const out = runWith("4211");
    expect(out.status).toBe(3);
    expect(both(out)).toMatch(/server exited code=3/);
  });

  it("载荷缺 server.js ⇒ 大声失败，不退化成「静默没起来」", () => {
    stagePayload("");
    const out = runWith("4212");
    expect(out.status).toBe(1);
    expect(both(out)).toMatch(/no server\.js/);
  });

  it("没给 PORT ⇒ 大声失败（走的是真实入口路径，不只是函数单测）", () => {
    stagePayload("process.exit(0);\n");
    const out = runWith("");
    expect(out.status).toBe(1);
    expect(both(out)).toMatch(/PORT/);
  });

  /* ── 宿主半边（3-E2b，ISSUE #1216 收口的那一半）───────────────────────────
   *
   * 判据都落在**真跑**上：桩宿主把自己的 env 打到 stdout（入口已把它重定向到
   * `log/services/executor-host-stdout-*.log`），于是「开关有没有读到、库是不是同一份、
   * boot id 有没有串起来」都是看得见的字，而不是对源码文本的想象。 */

  const STUB_HOST_ALIVE =
    "process.stdout.write(`HOST exec=${process.env.COMFY_EXECUTOR} " +
    "db=${process.env.DATABASE_URL} boot=${process.env.COMFYAPP_HOST_BOOT_ID} " +
    "node=${process.env.NODE_ENV}\\n`);\n" +
    "setInterval(() => {}, 500);\n";

  it("COMFY_EXECUTOR=host ⇒ 起宿主，env 带着归一化值 / 绝对库 / boot id，退出时收两棵树", () => {
    stagePayload(
      "console.log('stub server up'); process.exit(0);\n",
      STUB_HOST_ALIVE,
    );
    const out = runWith("4220", { COMFY_EXECUTOR: "host" });
    const text = both(out);
    expect(out.status, text).toBe(0);
    expect(text).toMatch(/executor mode=host/);
    const hostPid = /host pid=(\d+)/.exec(text)?.[1];
    expect(hostPid, text).toBeTruthy();
    // 桩宿主的输出：三项都必须落在同一个值上
    const echoed = hostStdout();
    expect(echoed).toContain("exec=host");
    // 绝对路径：宿主与 server 读同一个库文件，靠的就是这一条（相对路径 = 赌两侧锚点一致）
    expect(echoed).toMatch(/db=file:[A-Za-z]:[\\/]/);
    // 子进程真的拿到 production（不是只在单测里成立）：pino 在别值时去找 pino-pretty，
    // 而那份 devDependency 不在载荷里 —— 桌包宿主退出 1 的现场就是这条。
    expect(echoed).toContain("node=production");
    const stamp = /executor-host-stdout-(\S+?)\.log/.exec(text)?.[1];
    expect(stamp, `入口没打出宿主输出通道：${text}`).toBeTruthy();
    expect(
      echoed,
      `boot id 必须与本次日志同名（跨进程 grep 的唯一线索）：${echoed}`,
    ).toContain(`boot=${stamp}`);
    // 退出时先收宿主（server 已自己退了，不该出现它的假 reap）
    expect(text).toContain(`reap pid=${hostPid}`);
    expect(text).not.toMatch(/reap FAILED/);
  });

  it("不设开关 ⇒ 明确写出 mode=inline，且一个宿主进程都不起", () => {
    stagePayload("process.exit(0);\n", STUB_HOST_ALIVE);
    const out = runWith("4221");
    const text = both(out);
    expect(out.status, text).toBe(0);
    expect(text).toMatch(/executor mode=inline/);
    expect(text).not.toMatch(/host pid=/);
    expect(existsSync(path.join(workdir, "log", "services"))).toBe(false);
  });

  it("设了 host 而载荷里没有宿主入口 ⇒ 大声说明并留在 host 归属，不偷偷降级", () => {
    stagePayload("console.log('stub server up'); process.exit(0);\n", null);
    const out = runWith("4222", { COMFY_EXECUTOR: "host" });
    const text = both(out);
    expect(out.status, text).toBe(0);
    expect(text).toMatch(/host SKIPPED/);
    // 降级（改判 inline）会把已经写成 host 归属的行变成没人领的孤儿 —— 明令不许。
    expect(text).not.toMatch(/mode=inline/);
  });

  it("宿主中途退出 ⇒ 大声一行、server 继续跑、退出码仍由 server 定，且不再补刀", () => {
    stagePayload(
      "setTimeout(() => process.exit(0), 1500);\n",
      "process.exit(7);\n",
    );
    const out = runWith("4223", { COMFY_EXECUTOR: "host" });
    const text = both(out);
    expect(out.status, text).toBe(0);
    expect(text).toMatch(/host exited code=7/);
    // 已经退掉的宿主不许再补一刀（那会在日志里留一行假的 reap FAILED）
    const hostPid = /host pid=(\d+)/.exec(text)?.[1];
    expect(hostPid, text).toBeTruthy();
    expect(text).not.toContain(`reap pid=${hostPid}`);
  });

  it("开关值两侧同判据：带空格的 host 仍起宿主，认不出的值按 inline 起并回显原值", () => {
    stagePayload("process.exit(0);\n", STUB_HOST_ALIVE);
    const padded = both(runWith("4224", { COMFY_EXECUTOR: " host " }));
    expect(padded).toMatch(/executor mode=host/);
    expect(padded).toMatch(/host pid=\d+/);

    stagePayload("process.exit(0);\n", STUB_HOST_ALIVE);
    const weird = both(runWith("4225", { COMFY_EXECUTOR: "weird" }));
    expect(weird).toMatch(/executor mode=inline unknown="weird"/);
    expect(weird).not.toMatch(/host pid=/);
  });
});

describe("装配、打包配置与产物判据三者同形", () => {
  it("tauri.conf.json 声明的 resources 落点 == 壳拼的载荷根", () => {
    const conf = read("src-tauri/tauri.conf.json").replace(/\s+/g, "");
    expect(conf).toContain('"resources":["static/"]');
    const shell = read("src-tauri/src/lib.rs");
    expect(shell).toContain('let app_root = res_dir.join("static");');
    // sidecar 由打包器落在资源根（剥三元组后缀），壳不许再拼 binaries/ 子目录。
    expect(shell).toContain("res_dir.join(sidecar_binary_name())");
    expect(shell).not.toContain('res_dir.join("binaries")');
  });

  it("build-desktop 里三条实测判据都还在", () => {
    const bd = read("scripts/build-desktop.mjs");
    // ① 载荷实体化后必须真去解析模块（软链摊平不是「拷完就算」）
    expect(bd).toContain("桌包载荷解析不到这些运行期模块");
    expect(bd).toContain("@swc/helpers/_/_interop_require_default");
    // ② DDL 只许建结构，不许带数据（硬规则 17）
    expect(bd).toMatch(/INSERT INTO/);
    // ③ 顶层默认拒绝，而不是黑名单逐条追
    expect(bd).toContain("pruneStaticToAllowList(staticDir)");
    expect(bd).toContain("isStaticPathAllowed");
  });

  it("产物层检查认识桌包载荷必备件（standalone 层没有它们才是常态，所以只查 static）", () => {
    const checker = read("scripts/check-standalone-contents.cjs");
    for (const needle of [
      "REQUIRED_PAYLOAD_FILES",
      '"schema.sql"',
      '"scripts/standalone-runtime.mjs"',
      'label === "static"',
    ]) {
      expect(checker, needle).toContain(needle);
    }
  });

  it("入口与其环境模块登记进两侧白名单（漏一侧 = 被剪掉，或检查瞎掉）", () => {
    for (const name of [
      "standalone-runtime.mjs",
      "launcher-core/standalone-runtime-env.mjs",
    ]) {
      expect(registry.RUNTIME_SCRIPTS, name).toContain(name);
      expect(read("scripts/check-standalone-contents.cjs"), name).toContain(
        name,
      );
    }
  });

  it("tsc 不许把载荷副本当源码检查（tauri 会把资源摆到 exe 旁边）", () => {
    // 实测：声明 bundle.resources 之后 target/release/static/** 里含应用的 TS 源，
    // tsc 于是开始检查一份**构建产物副本**，报出来的类型错误指向没人维护的地方。
    expect(read("tsconfig.json")).toContain('"src-tauri/target"');
  });
});
