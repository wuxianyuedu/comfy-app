/**
 * standalone 运行时完整性护栏（ISSUE #489）
 * ===========================================================================
 *
 * 背景：`next build`（Turbopack）对 `require("next/dist/compiled/next-server/
 * <name>.runtime.prod.js")` 这类**动态 require 字符串**的追踪在早期构建链上是
 * **不完整的**。当时的实测：只有被 middleware 图命中的那一份（`app-page-turbo`）
 * 出现在 nft 清单里，`app-route-turbo` 一份都不在 —— 而所有 App Route（`route.js`）
 * 都在 require 它。
 *
 * 后果不是「少了个文件」，而是**所有 API 路由 500**：
 *
 * 报错形如：Failed to load external module
 *   缺的件形如 next/dist/compiled/next-server/app-route-turbo.runtime.prod.js
 *   跟一句 Cannot find module 报错
 *
 * 页面（RSC 渲染走 app-page-turbo）与 middleware 都还正常，于是呈现成
 * 「首页 200、接口全 500」—— 看起来像业务 bug，实际是产物缺口。
 *
 * **为什么单测拦不住、必须锁配置 + 数产物**：
 *   · 本仓库 `next start` 与 `output: standalone` 不兼容（Next 会打
 *     `"next start" does not work with "output: standalone"` 警告），也就是说
 *     **没有任何常规门禁会去启动 standalone 服务**；CI 只跑 `pnpm build`，
 *     构建期不会报错（缺口是运行时才暴露的）；
 *   · 所以这里做两件事：① 锁 `outputFileTracingIncludes` 条目还在（改坏了先红）；
 *     ② 产物存在时真去数那份文件在不在。
 *
 * 反向验证（早期构建链）：把 `outputFileTracingIncludes` 从 next.config.js 摘掉
 * 重新 build，`.next/standalone` 里 `app-route-turbo.runtime.prod.js` 消失，
 * 本文件的产物用例失败、`check-standalone-contents.cjs` 也报缺件。
 * ⚠️ 这句在**当前构建链上已复现不出**：A/B（同机同依赖）把那份条目整段注释掉后，
 * 两份产物逐字节同构（`next-server/` 都是整份 74 个文件）。原因是读这两个 tracing 键的
 * 只有 `collect-build-traces`，而它在 `bundler !== Turbopack` 的分支里整段跳过 ——
 * 也就是这份配置条目今天加不出任何东西。所以：本文件里**承重的是下面那组产物探针**，
 * 上面那组配置断言只守「意图没被人反向写成 excludes」，不许把它读成缺件的防线
 *（口径与依据见规范 §7.4）。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "./helpers/strip-comments";

/**
 * 读一份源文件并**剥掉注释**（唯一实现 `./helpers/strip-comments`，`{ trailing: true }` 连行尾一起去）。
 *
 * 为什么这批要动（ISSUE #2660 的第六批）：这一份文件原先自己写了一条链式剥注释 ——
 * 块注释一跳 + 「两个斜杠到行尾」全局替换那一跳，而**第二跳没有行首锚**，
 * 于是它会把字符串里的 `http:` 斜杠斜杠之后整截吃掉：那正是
 * `tests/strip-comments-single-source.test.ts` 的 NAIVE 一档点名的缺陷形状，
 * 而它躲过了那一条判据的**两根**特征串 —— 名字那一根要的是那份函数定义本身
 *（该判据把它的特征串拆开写出来，正是为了不让自己的文字把自己算成命中 —— 我这段说明
 *  第一版就是原样写了那个名字，被它当场点名"又多出 1 份本地实现"，一次自匹配的现行犯），
 * NAIVE 那一根写死了「方括号反斜杠 n 星号斜杠 g」那个字面形状，本文件这份换了一种同义写法。
 * ⇒ 见 ISSUE #2969（台账的面只认名字，十几份这种内联写法不在它面上）。
 *
 * ⚠️ 这段说明自己就示范了这条坑有多隐蔽：上一版我把两根特征串**原样**写进这段块注释，
 * 其中一根里的「星号紧跟斜杠」把这段注释提前关掉了 ⇒ 整份文件在 vitest 的 transform
 * 阶段就 `PARSE_ERROR`（不是红在断言上，是收不到用例）。写这段的人（我）本会话已在
 * `tests/helpers/strip-comments.ts` 上撞过一次同形，那次是 eslint 报的。
 *
 * **当场量具**（三种剥法对这份文件自扫那组的五条判语，逐个复算过）：
 * 无锚 3124 / 有锚 3155 / helper 3556 字符，五条判语**三者相同** ⇒ 这一换今天不改判决，
 * 它撤掉的是一个"被禁写法可以藏在引号后面"的形状，不是修一处现成的红。
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
 * 与 tests/turbopack-tracing-excludes.test.ts 同款写法（那里详细写了为什么
 * listFiles 的调用必须挂在判据之下、判据必须先求值再传进 skipIf —— 否则
 * 「产物缺失」会从「应当跳过」变成整份文件收不到用例）。
 */
const standaloneDir = join(process.cwd(), ".next", "standalone");

/**
 * 产物根在，**且**里面那份 `next` 够得着 —— 守卫必须判两件事。
 *
 * 为什么要加后半截：standalone 的 `node_modules/<pkg>` 是指向 pnpm store 的符号链接
 * （硬规则 17 的减法正是靠「不穿链接」保住它们），而**任何一次 `pnpm install` 都会
 * 换掉 store 里那条路径的哈希段** —— 上一次构建留下的壳于是整体悬空：产物根仍然在，
 * `RUNTIME_DIR` 却数出 0 份。只判「根在」时，这 0 会被断言成
 * 「缺 `app-route-turbo.runtime.prod.js`，所有接口会 500」—— 那是把「这台机器很久没
 * 重新构建」说成「产物有缺陷」，而照着那句话去动 `outputFileTracingIncludes`
 * 只会把本来正确的配置改坏。本机实测就是这个形态（根在、`node_modules/next` 是悬链）。
 *
 * 与既有口径一致：产物档在没有产物的检出上**自行跳过**，而「有没有真的构建过」
 * 由 `scripts/.artifact-freshness.json` 那一档每日自证判（§11.8 / §13.5.4）——
 * 把「这台机器没构建」变成这里的红，只会让人去改判据而不是去跑构建。
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
 * `pnpm start` 的**入口那一边**：仓库检出里只有 `next start` 一个正确取值（ISSUE #1977）。
 *
 * 这里曾经反着写 —— 依据是启动时那句输出：
 *
 *   `"next start" does not work with "output: standalone" configuration.`
 *
 * 把它读成「Next 拒绝这对组合」，于是加了「盘上有 `.next/standalone/server.js` 就走它」
 * 的分支。**那是一句 `⚠` 警告**：实测 `next start` 照常起（`✓ Ready in 119ms`）、
 * 静态资源 200、`/api/health` 报 `db: "up"`。而换到 standalone 入口之后 E2E
 * **几乎全档红**，因为**仓库检出里的 standalone 载荷是不完整的**（它只由
 * `build-desktop.mjs` 组装成可分发的形态）：
 *
 *   · `.next/standalone/.next/static` 不存在 ⇒ `/_next/static/chunks/*` 全 404、
 *     MIME 是 `text/plain` ⇒ 浏览器拒绝执行 ⇒ **整个前端不 hydrate**，
 *     交互类断言全部 5s 超时；
 *   · `server.js` 启动即 `chdir(__dirname)` ⇒ `DATABASE_URL` 的 `./db.sqlite`
 *     落到 `.next/standalone/db.sqlite`（**空库**），而 23 张表在检出根
 *     ⇒ `/api/health` 报 `db: "empty"`。
 *
 * 所以这一组钉的是**反向**：`scripts/start.mjs` 不许带 standalone 入口那一支。
 * 两条各挡一个方向：换入口（`useStandalone` / `standaloneServer` 那套决策）与
 * 半途把环境交给桌包那份装配（`buildStandaloneRuntimeEnv`）—— 后者是**桌包链**
 * （`standalone-runtime.mjs`）的事，检出里它会把数据锚点指到空库那一侧。
 *
 * ⚠️ 判不了「服务真的起来了」（那要一份完整产物 + 库结构，是本文件上半的活）；
 * 也判不了「`next start` 与 standalone 只警告不拒绝」（那是 Next 的行为，
 * 上面那段实测读数与 `scripts/start.mjs` 里那条注释记着它）。
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
