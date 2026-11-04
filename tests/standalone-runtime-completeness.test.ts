/**
 * standalone 运行时完整性护栏（ISSUE #489）：Turbopack 对动态 require 的 `next-server/*.runtime.prod.js`
 * 追踪不完整，缺 `app-route-turbo` 会让所有 App Route 500（首页 200、接口全 500）；`next start` 又不兼容
 * standalone，故没有常规门禁会启动它。做法：① 锁 `outputFileTracingIncludes` 条目（守意图）；② 产物在时数文件。
 * 当前构建链上该条目加不出东西（collect-build-traces 在 Turbopack 分支跳过），承重的是产物探针（§7.4）。 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "./helpers/strip-comments";

/**
 * 读源文件并剥注释（唯一实现 `./helpers/strip-comments`，`{ trailing: true }` 连行尾一起去）。ISSUE #2660 第六批
 * 换掉旧内联链式替换：第二跳没有行首锚，会把字符串里 `http:` 之后整截吃掉（`strip-comments-single-source`
 * 的 NAIVE 形状，见 ISSUE #2969）。注意正文别写「星号紧跟斜杠」——会提前关块注释，整份文件 PARSE_ERROR。
 */
const readCode = (rel: string): string =>
  stripComments(readFileSync(join(process.cwd(), rel), "utf8"), { trailing: true });

const config = readCode("next.config.js");

/** Next 自带的运行时脚本目录（相对产物根）。 */
const RUNTIME_DIR = "node_modules/next/dist/compiled/next-server";

/** 必须出现在产物里的运行时脚本（**逐个点名**，不用通配）。 */
const REQUIRED_RUNTIME_FILES = [
  // App Route（所有 route.ts）—— 缺口就是这一份
  "app-route-turbo.runtime.prod.js",
  // 页面（RSC）—— 被 middleware 图意外带上，但同样必须显式保证
  "app-page-turbo.runtime.prod.js",
  // middleware 自身
  "pages-turbo.runtime.prod.js",
];

describe("outputFileTracingIncludes：Next 自带运行时脚本必须显式包含", () => {
  it("键挂在顶层（挂 experimental 下等于不生效）", () => {
    expect(config).toMatch(/^\s{2}outputFileTracingIncludes:\s*\{/m);
  });

  it("包含 next/dist/compiled/next-server 的运行时脚本", () => {
    expect(
      config.includes("./node_modules/next/dist/compiled/next-server/*runtime.prod.js"),
      "缺口就在这里：`route.ts` 都要的 `app-route-turbo.runtime.prod.js` 是动态 " +
        "require 字符串，历史上确实漏追过（页面 200、接口全 500）。当前构建链上这条 " +
        "条目不承重（见文件头那段 A/B），真正判缺件的是下面的产物探针与 " +
        "check-standalone-contents.cjs",
    ).toBe(true);
  });

  it("不是用 excludes 反着写（excludes 只做减法，补不回缺失的文件）", () => {
    // 这条是方向性判据：曾经「修」这条的思路是往 excludes 里加东西，
    // 而 excludes 只会让产物更小。缺件只能靠 includes。
    expect(config).not.toMatch(/outputFileTracingExcludes:\s*\{[^}]*next-server[^}]*\}/);
  });
});

/* ── 产物级探针：真去数那份运行时脚本在不在 ────────────────────────────
 *
 * 写法同 tests/turbopack-tracing-excludes.test.ts：listFiles 的调用必须挂在判据之下、
 * 判据先求值再传进 skipIf，否则「产物缺失」会从「应当跳过」变成整份文件收不到用例。
 */
const standaloneDir = join(process.cwd(), ".next", "standalone");

/**
 * 产物根在，且 `node_modules/next` 够得着 —— 守卫须判两件事：standalone 的 `node_modules` 是指向 pnpm store 的
 * 符号链接（硬规则 17），一次 `pnpm install` 换掉哈希段就让旧产物悬空（根在、`RUNTIME_DIR` 数出 0 份）。只判根在
 * 会把「没重新构建」说成「产物有缺陷」；有无产物由 `scripts/.artifact-freshness.json` 档自证（§11.8 / §13.5.4）。
 */
const nextReachable = existsSync(join(standaloneDir, "node_modules", "next", "package.json"));
const artifactUsable = existsSync(standaloneDir) && nextReachable;

/** 列出运行时脚本目录（不存在时返回空数组，绝不裸调）。 */
function runtimeFiles(): Array<string> {
  const dir = join(standaloneDir, RUNTIME_DIR);
  return existsSync(dir) ? readdirSync(dir) : [];
}

describe.skipIf(!artifactUsable)(".next/standalone 里的 Next 运行时脚本不得缺件", () => {
  const files = artifactUsable ? runtimeFiles() : [];

  it("探针自身不空跑（确实数到了运行时脚本目录）", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.for(REQUIRED_RUNTIME_FILES)("%s 在产物里", (name) => {
    expect(
      files,
      `缺少 ${name}：所有 App Route 运行时都会 ` +
        `Failed to load external module 并返回 500（页面正常，接口全挂）`,
    ).toContain(name);
  });
});

/* ── 守卫自身的可运行性 ────────────────────────────────────────────────
 * 与上面那组同源：runtimeFiles() 不得在收集期被裸调。这里用结构断言而不是
 * 「再跑一遍 vitest」—— 后者需要完整最小检出，仓库结构一变就先坏在无关处。
 */
describe("产物缺失时的跳过逻辑（守卫自身的可运行性）", () => {
  const code = readCode(join("tests", "standalone-runtime-completeness.test.ts"));

  /* 自扫描的前置断言：这一组读的是**本文件自己**。读错路径 / 剥成空文时，
   * 下面那条 `toHaveLength(0)`（一个"不许出现"的形状）会在不判任何东西的情况下绿，
   * 而 `toMatch(/const artifactUsable =/)` 那两条只要文件里还有这两个字面量就也绿 ——
   * 所以必须先钉住"确实读到的是这份文件、而且里面还有代码"。 */
  it("自扫描读到的就是本文件，且剥完不是空文", () => {
    expect(code.trim(), "本文件剥完注释是空文 ⇒ 下面三条结构断言全在判空").not.toHaveLength(0);
    // 被搜串**拼接**写出：本文件自己在扫描面上，原样写着的被搜串会把自己算成命中
    //（同一族的标本是 `strip-comments-single-source.test.ts` 里的 `DEFINITION_MARK`）。
    const declarationMarker = "function runtime" + "Files(";
    expect(
      code,
      "自扫描的接收者里没有 `runtimeFiles` 的声明 —— 读到的不是这份文件本体" +
        "（路径漂了），那么「裸调 = 0 次」会在一个没有对象的地方绿",
    ).toContain(declarationMarker);
  });

  it("runtimeFiles 的调用必须挂在「产物存在」判据之下，不得裸调", () => {
    expect(code.match(/=\s*runtimeFiles\(\)/g) ?? []).toHaveLength(0);
  });

  it("跳过判据先求值成常量再传入 describe.skipIf", () => {
    expect(code).toMatch(/const\s+artifactUsable\s*=/);
    expect(code).toMatch(/describe\.skipIf\(!artifactUsable\)/);
  });

  it("守卫要同时判「产物根在」与「那份 next 够得着」（悬壳不许被读成缺件）", () => {
    /* 这条判的是**守卫自己的形状**，所以在任何机器上都该跑（不随产物在不在 skip）：
     * 少了 `nextReachable` 那一半时，一份 store 链接已悬掉的旧壳会走进断言、
     * 数出 0 份运行时脚本，然后报「缺 `app-route-turbo`，所有接口会 500」——
     * 一个把「没重新构建」冒充成「产物有缺陷」的判据，下一次会被当成真红去查，
     * 或者被人整个绕开（§11.18.4「会误报的判据活不过一次评审」）。 */
    expect(code).toMatch(
      /const\s+nextReachable\s*=\s*existsSync\(\s*join\(\s*standaloneDir,\s*"node_modules",\s*"next",\s*"package\.json"/,
    );
    expect(code).toMatch(
      /const\s+artifactUsable\s*=\s*existsSync\(standaloneDir\)\s*&&\s*nextReachable/,
    );
  });
});

/**
 * `pnpm start` 的入口（ISSUE #1977）：检出里只有 `next start` 正确；曾把 "next start" does not work with
 * "output: standalone" 那句警告读成拒绝而加了 standalone 分支，实测照常起、换入口后 E2E 几乎全红（检出里
 * standalone 载荷不完整：缺 .next/static ⇒ 前端不 hydrate，server.js chdir ⇒ 空库）。故 `scripts/start.mjs` 不许带该分支。
 */
describe("`pnpm start` 的入口：仓库检出里必须走 `next start`（不换 standalone 入口）", () => {
  const source = readCode("scripts/start.mjs");

  it("用的是 `next start`（经 pnpm 可执行形态判据，不是裸名字）", () => {
    expect(source).toMatch(/"next",\s*\n?\s*"start"/);
    expect(source).toMatch(/pnpmInvocation\(\[/);
  });

  it("**不许**出现「盘上有 server.js 就走 standalone 入口」那套决策", () => {
    /* 反向复算：把 `7b2ce3a5` 那一段贴回去，这条当场点名。 */
    expect(source).not.toMatch(/useStandalone\s*=\s*existsSync\(/);
    expect(source).not.toMatch(/args:\s*\[standaloneServer\]/);
  });

  it("**不许**把运行期环境交给桌包那份装配（那是 standalone 载荷才成立的口径）", () => {
    expect(source).not.toMatch(/buildStandaloneRuntimeEnv\(/);
  });
});
