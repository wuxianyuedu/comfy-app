/**
 * 宿主的产物化判据（P3 §5 ADR §13 的 3-E1，ISSUE #1169）。
 *
 * 这一刀做的事：把宿主运行时图从「tsx 加载 src/lib/** 的 TS 源」换成「构建期预编译
 * 一个文件，运行期按内容决定用哪份图」。判据分两层——
 *   ① 配置/形态层（永远跑）：构建链顺序、external 清单、`require` 垫片、入口的加载
 *      判据。这几条各对应一次实测踩到的坑，缺任何一条的表现都是「产物里设 host 起
 *      不来」，而构建期一声不响。
 *   ② 真产物层（有 `.next/standalone` 才跑）：真在产物目录里起一次宿主进程。
 *
 * 为什么不止靠 ②：`pnpm build` 不在 pre-commit 也不在 CI（CI 只跑 lint/tsc/test），
 * 只留真产物那一条就等于「改了构建链没人立刻知道」；而 ① 里的每一条都是从 ② 抓不
 * 到的方向（顺序写反、垫片被删、入口长出第二条加载路径）先在源码上就红。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const buildScript = read("scripts/build-executor-host.mjs");
const smokeScript = read("scripts/smoke-executor-host-standalone.mjs");
const hostEntry = read("scripts/executor-host.mjs");
const runtimeGraph = read("src/lib/comfyui/host-runtime.ts");
const privateInputs = read("scripts/standalone-private-inputs.mjs");
const buildDesktop = read("scripts/build-desktop.mjs");
const pkg = JSON.parse(read("package.json")) as {
  scripts: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

describe("构建链顺序：预编译 → 剪枝 → 冒烟", () => {
  const steps = (pkg.scripts.build ?? "").split("&&").map((s) => s.trim());
  const at = (needle: string) => steps.findIndex((s) => s.includes(needle));

  it("next build 最先，产物根存在才有东西可加", () => {
    expect(steps[0], pkg.scripts.build).toContain("next build");
  });

  /** 反序的表现不是报错而是「产物里静默没有宿主件」：剪枝在白名单之外一律删，
   *  预编译件如果先写后被剪，就什么都剩不下。 */
  it("预编译在剪枝之前，冒烟在最后", () => {
    const bundle = at("build-executor-host.mjs");
    const strip = at("standalone-private-inputs.mjs");
    const smoke = at("smoke-executor-host-standalone.mjs");
    expect(bundle, "build 脚本里没有跑预编译").toBeGreaterThan(-1);
    expect(smoke, "build 脚本里没有跑冒烟").toBeGreaterThan(-1);
    expect(bundle).toBeLessThan(strip);
    expect(strip).toBeLessThan(smoke);
  });

  /** `tsx` / `esbuild` 只能待在 devDependencies：产物化要解决的正是「发行包里
   *  带一个 TS 加载器」，一旦它们挪到 dependencies，问题会以更隐蔽的方式回来
   *  （产物变大、且没人再记得为什么不带）。 */
  it("tsx 与 esbuild 都是构建期依赖，不是运行期依赖", () => {
    expect(pkg.devDependencies?.tsx).toBeTruthy();
    expect(pkg.dependencies?.tsx).toBeUndefined();
    expect(pkg.devDependencies?.esbuild).toBeTruthy();
    expect(pkg.dependencies?.esbuild).toBeUndefined();
  });
});

describe("预编译的形态判据", () => {
  /** 只留三类件 external：带原生/可选二进制的、以及必须与 server 同实例的。
   *  反过来 `drizzle-orm` / `zod` / `@paralleldrive/cuid2` 是纯 JS，但 standalone
   *  的 node_modules 顶层**没有**它们（Next 把它们编进 server chunk 了），留
   *  external 就是运行期 ERR_MODULE_NOT_FOUND —— 实测数过产物目录才定下的清单。 */
  it("外部件清单是显式白名单，且不含纯 JS 的那三个", () => {
    const externals = /const EXTERNAL_PACKAGES = \[([\s\S]*?)\];/.exec(
      buildScript,
    )?.[1];
    expect(externals, "找不到 EXTERNAL_PACKAGES").toBeTruthy();
    for (const keep of ["@libsql/client", "ws", "pino"]) {
      expect(externals).toContain(keep);
    }
    for (const pure of ["drizzle-orm", "zod", "@paralleldrive/cuid2"]) {
      expect(externals).not.toContain(pure);
    }
  });

  /** 实测坑：ESM 产物里被打进来的 CJS（pino / drizzle 内部）会走 esbuild 的
   *  `__require` 垫片，而垫片只在「作用域里有 require」时可用，否则运行期抛
   *  `Dynamic require of "node:crypto" is not supported` —— 类型与单测全绿。 */
  it("banner 里给了真的 require（createRequire），否则产物起不来", () => {
    expect(buildScript).toContain("createRequire");
    expect(buildScript).toMatch(/banner:\s*\{[\s\S]*?const require = /);
  });

  /** 反向判据：`server-only` 不能变成 external。变 external 会被提到产物顶层，
   *  于是宿主一加载就抛（那几个 barrel 原本只在「动态 import + catch」里出现）。
   *  只比数组字面量自身——整份文件里 "server-only" 这个词还会出现多次。 */
  it("server-only 走内联抛错桩，且不在外部件清单里", () => {
    expect(buildScript).toMatch(/filter:\s*\/\^server-only\$\//);
    expect(buildScript).toContain("SERVER_ONLY_STUB");
    const externals = /const EXTERNAL_PACKAGES = \[([\s\S]*?)\];/.exec(
      buildScript,
    )?.[1];
    expect(externals).not.toContain("server-only");
  });

  it("图本体不在源码里 import server-only（它只是被兜底路径间接拉到的）", () => {
    expect(runtimeGraph).not.toContain('import "server-only"');
    expect(runtimeGraph).toContain('from "./executor-dispatch"');
  });
});

describe("宿主入口的加载判据（内容，不是 env）", () => {
  it("按预编译件在不在决定加载哪份图", () => {
    expect(hostEntry).toContain("executor-host.runtime.mjs");
    expect(hostEntry).toMatch(/fs\.existsSync\(RUNTIME_BUNDLE\)/);
    // dev 分支仍然装着 tsx 钩子：桌包之外的开发路径一字不改地能跑
    expect(hostEntry).toContain('import("tsx/esm/api")');
    expect(hostEntry).toContain('import("../src/lib/comfyui/host-runtime.ts")');
  });

  /** 防的是「过一阵又长回第二条加载路径」：入口里再出现逐个 `../src/lib/**.ts`
   *  的 import，产物形态就会悄悄依赖 TS 源（3-E 之前的形状）。 */
  it("入口不再逐个 import src/lib 的 TS 源（图只在 host-runtime 一处声明）", () => {
    const stragglers = [...hostEntry.matchAll(/\.\.\/src\/lib\/[^\s"']+/g)]
      .map((m) => m[0])
      .filter((s) => !s.endsWith("host-runtime.ts"));
    expect(stragglers).toEqual([]);
  });

  it("出厂第一跑没有 task 表也要能起来（扫表过 isSchemaReady 守卫）", () => {
    // 编排器的 schema 同步排在拉起宿主之后，裸扫表抛错会把注入链判成 boot FAILED
    expect(hostEntry).toMatch(/graph\.isSchemaReady\(dbUrl\)/);
    expect(hostEntry).toContain("schema-not-ready");
  });
});

describe("白名单两侧与桌包断言", () => {
  it("BUILT_RUNTIME_SCRIPTS 是 RUNTIME_SCRIPTS 的子集（否则剪枝照删）", () => {
    const runtime = privateInputs.slice(
      privateInputs.indexOf("export const RUNTIME_SCRIPTS"),
      privateInputs.indexOf("export const BUILT_RUNTIME_SCRIPTS"),
    );
    const built = /export const BUILT_RUNTIME_SCRIPTS = \[([\s\S]*?)\];/.exec(
      privateInputs,
    )?.[1];
    expect(built, "找不到 BUILT_RUNTIME_SCRIPTS").toBeTruthy();
    for (const name of [...built!.matchAll(/"([^"]+)"/g)].map((m) => m[1])) {
      expect(
        runtime,
        `产物件 ${name} 没登记进 RUNTIME_SCRIPTS，会被剪枝删掉`,
      ).toContain(name);
    }
  });

  it("build-desktop 跳过按源文件拷贝、改在组装后断言存在", () => {
    expect(buildDesktop).toContain(
      "BUILT_RUNTIME_SCRIPTS.includes(launcherFile)",
    );
    expect(buildDesktop).toContain("桌包缺件");
  });
});

describe("冒烟判据本身有效", () => {
  /** 冒烟最危险的失效形态是「没产物 → 静默通过」。对空目录必须报缺 server.js，
   *  这条不需要真产物，所以它总是跑。 */
  it("目录里没有 server.js 时报错，而不是当成通过", async () => {
    const { smokeExecutorHostArtifact } =
      await import("../scripts/smoke-executor-host-standalone.mjs");
    const empty = join(
      (await import("node:os")).tmpdir(),
      `comfyapp-empty-${Date.now()}`,
    );
    const result = smokeExecutorHostArtifact(empty);
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toContain("server.js");
  });

  it("冒烟读的是构建清单里的 externals，而不是再猜一份", () => {
    expect(smokeScript).toContain("executor-host.build.json");
    expect(smokeScript).toMatch(/manifest\.externals/);
    expect(smokeScript).toContain("runtime inject-ok");
  });
});

/** 真产物层：有 `.next/standalone` 才跑（与 `standalone-runtime-completeness`
 *  同一条 skip 口径——产物不存在的机器上「跳过」比「假红」有用，但 CI 跑过
 *  `pnpm build` 之后这一条是真判据）。 */
const ARTIFACT = join(ROOT, ".next", "standalone");
const artifactSuite = existsSync(join(ARTIFACT, "server.js")) ? it : it.skip;

describe("产物里真的起得来宿主", () => {
  artifactSuite(
    "在 .next/standalone 内跑 executor-host --once：exit 0 且注入链完成",
    async () => {
      const { smokeExecutorHostArtifact } =
        await import("../scripts/smoke-executor-host-standalone.mjs");
      const result = smokeExecutorHostArtifact(ARTIFACT);
      expect(
        result,
        `detail: ${result.detail.join(" | ")}\nproblems: ${result.problems.join("\n")}`,
      ).toMatchObject({ ok: true });
    },
    180_000,
  );
});
